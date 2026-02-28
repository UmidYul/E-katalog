from __future__ import annotations

import json
import secrets
import re
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routers.auth import (
    _create_user,
    _get_user_by_email,
    _hash_password,
    _now_iso,
    _patch_auth_user_fields,
    _send_auth_email,
)
from app.core.config import settings
from app.repositories.b2b import B2BRepository


STAFF_ROLES = {"admin", "moderator", "seller_support"}


def _public_url(path: str) -> str:
    base = str(settings.next_public_app_url or "http://localhost").strip().rstrip("/")
    normalized = str(path or "/").strip()
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return f"{base}{normalized}"


def _issue_partner_temp_password() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*+-_"
    return "".join(secrets.choice(alphabet) for _ in range(16))


def _display_name(contact_name: str, company_name: str) -> str:
    normalized_contact = str(contact_name or "").strip()
    if normalized_contact:
        return normalized_contact[:120]
    normalized_company = str(company_name or "").strip()
    if normalized_company:
        return normalized_company[:120]
    return "Seller Partner"


def _slugify(value: str, *, fallback: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    if not normalized:
        normalized = fallback
    return normalized[:120]


async def _ensure_seller_user(
    *,
    redis: Redis,
    db: AsyncSession,
    updated: dict[str, Any],
) -> tuple[dict[str, Any], str | None]:
    email = str(updated.get("email") or "").strip().lower()
    user = await _get_user_by_email(redis, email, db)
    temp_password: str | None = None

    if user is None:
        temp_password = _issue_partner_temp_password()
        user = await _create_user(
            redis,
            db=db,
            email=email,
            full_name=_display_name(str(updated.get("contact_name") or ""), str(updated.get("company_name") or "")),
            password_hash=_hash_password(temp_password),
            role="seller",
            extra_fields={"email_confirmed": "1", "email_confirmed_at": _now_iso()},
        )
        return user, temp_password

    current_role = str(user.get("role") or "").strip().lower().replace("-", "_")
    if current_role not in STAFF_ROLES and current_role != "seller":
        await _patch_auth_user_fields(
            redis,
            db,
            user_id=int(user["id"]),
            fields={"role": "seller", "updated_at": _now_iso()},
        )
        await db.commit()
        refreshed = await _get_user_by_email(redis, email, db)
        if refreshed is not None:
            user = refreshed
    return user, temp_password


async def apply_partner_lead_status_actions(
    *,
    lead_id: str,
    status_value: str,
    review_note: str | None,
    updated: dict[str, Any],
    current_user_id: str,
    repo: B2BRepository,
    redis: Redis,
    db: AsyncSession,
) -> dict[str, Any]:
    normalized_status = str(status_value or "").strip().lower()

    if normalized_status == "approved":
        user, temp_password = await _ensure_seller_user(redis=redis, db=db, updated=updated)
        user_uuid = str(user.get("uuid") or "").strip()
        if not user_uuid:
            failed = await repo.mark_partner_lead_provisioning_failed(
                lead_uuid=lead_id,
                error_message="failed to resolve user uuid for approved partner lead",
            )
            if failed:
                return failed
            return updated

        try:
            provisioned = await repo.provision_partner_lead_approval(
                lead_uuid=lead_id,
                owner_user_uuid=user_uuid,
                reviewer_uuid=current_user_id,
            )
            if provisioned:
                updated = provisioned
        except Exception as exc:  # noqa: BLE001
            failed = await repo.mark_partner_lead_provisioning_failed(lead_uuid=lead_id, error_message=str(exc))
            if failed:
                return failed
            return updated

        org_uuid = str(updated.get("provisioned_org_id") or "").strip().lower()
        if org_uuid and user_uuid:
            await db.execute(
                text(
                    """
                    insert into seller_shops (
                        org_uuid,
                        owner_user_uuid,
                        slug,
                        shop_name,
                        status,
                        website_url,
                        contact_email,
                        contact_phone,
                        metadata
                    )
                    values (
                        cast(:org_uuid as uuid),
                        cast(:owner_user_uuid as uuid),
                        :slug,
                        :shop_name,
                        'active',
                        :website_url,
                        :contact_email,
                        :contact_phone,
                        cast(:metadata as jsonb)
                    )
                    on conflict (org_uuid) do update
                    set
                        owner_user_uuid = excluded.owner_user_uuid,
                        slug = excluded.slug,
                        shop_name = excluded.shop_name,
                        website_url = excluded.website_url,
                        contact_email = excluded.contact_email,
                        contact_phone = excluded.contact_phone,
                        updated_at = now()
                    """
                ),
                {
                    "org_uuid": org_uuid,
                    "owner_user_uuid": user_uuid,
                    "slug": _slugify(
                        str(updated.get("company_name") or ""),
                        fallback=f"seller-{org_uuid.split('-')[0] if org_uuid else secrets.token_hex(3)}",
                    ),
                    "shop_name": str(updated.get("company_name") or "Seller Shop")[:255],
                    "website_url": updated.get("website_url"),
                    "contact_email": str(updated.get("email") or "").strip().lower() or "unknown@example.local",
                    "contact_phone": str(updated.get("phone") or "").strip() or "+998000000000",
                    "metadata": json.dumps(
                        {
                            "seeded_from": "partner_lead_approval",
                            "lead_id": str(lead_id),
                        }
                    ),
                },
            )
            await db.commit()

        subject = "Seller partner application approved"
        lines = [
            f"Hello, {str(updated.get('contact_name') or '').strip() or 'partner'}!",
            "",
            f"Your application for {str(updated.get('company_name') or 'your company')} is approved.",
            f"Login: {_public_url('/login?next=/dashboard/seller')}",
        ]
        if temp_password:
            lines.extend(
                [
                    f"Temporary password: {temp_password}",
                    "Please sign in and change password immediately in profile settings.",
                ]
            )
        else:
            lines.append("Your existing account now has seller workspace access.")
        lines.extend(
            [
                f"Seller panel: {_public_url('/dashboard/seller')}",
                f"Lead status page: {_public_url(f'/partners/status?lead={lead_id}')}",
            ]
        )
        sent, error_message = await _send_auth_email(
            recipient=str(updated.get("email") or "").strip().lower(),
            subject=subject,
            text_value="\n".join(lines),
        )
        if sent:
            await repo.mark_partner_lead_welcome_email_sent(lead_uuid=lead_id)
            updated["welcome_email_sent_at"] = _now_iso()
        elif error_message:
            updated["notification_error"] = error_message

    if normalized_status == "rejected":
        message_body = [
            f"Hello, {str(updated.get('contact_name') or '').strip() or 'partner'}!",
            "",
            f"Your application for {str(updated.get('company_name') or 'your company')} was rejected.",
            str(review_note or "Please contact support for additional details."),
        ]
        sent, error_message = await _send_auth_email(
            recipient=str(updated.get("email") or "").strip().lower(),
            subject="Seller partner application update",
            text_value="\n".join(message_body),
        )
        if not sent and error_message:
            updated["notification_error"] = error_message

    return updated
