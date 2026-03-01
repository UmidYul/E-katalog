from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.utils.time import UTC


class B2BRepository:
    def __init__(self, session: AsyncSession, *, cursor_secret: str) -> None:
        self.session = session
        self.cursor_secret = cursor_secret

    @staticmethod
    def _uuid(value: str) -> str:
        return str(value or "").strip().lower()

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    @staticmethod
    def _iso(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            item = value if value.tzinfo else value.replace(tzinfo=UTC)
            return item.astimezone(UTC).isoformat()
        text_value = str(value).strip()
        if not text_value:
            return None
        try:
            parsed = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
        except ValueError:
            return text_value
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).isoformat()

    @staticmethod
    def _to_float(value: Any, default: float = 0.0) -> float:
        if value is None:
            return default
        if isinstance(value, Decimal):
            return float(value)
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return float(str(value))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _to_int(value: Any, default: int = 0) -> int:
        if value is None:
            return default
        try:
            return int(float(str(value)))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _to_str_list(value: Any, *, max_items: int = 40, max_len: int = 120) -> list[str]:
        if not isinstance(value, list):
            return []
        rows: list[str] = []
        for item in value:
            text_value = str(item or "").strip()
            if not text_value:
                continue
            rows.append(text_value[:max_len])
            if len(rows) >= max(1, int(max_items)):
                break
        return rows

    @staticmethod
    def _issue_tracking_token() -> str:
        return secrets.token_urlsafe(24)

    @staticmethod
    def _hash_tracking_token(token: str) -> str:
        return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()

    @staticmethod
    def _slugify(value: str, *, max_len: int = 80) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower())
        normalized = normalized.strip("-")
        if not normalized:
            normalized = f"seller-{secrets.token_hex(3)}"
        return normalized[:max(8, int(max_len))].strip("-")

    @staticmethod
    def _country_currency(country_code: str) -> str:
        normalized = str(country_code or "").strip().upper()
        if normalized == "KZ":
            return "KZT"
        if normalized == "RU":
            return "RUB"
        if normalized == "US":
            return "USD"
        return "UZS"

    @staticmethod
    def _domain_from_url(value: str | None) -> str | None:
        raw = str(value or "").strip()
        if not raw:
            return None
        target = raw if "://" in raw else f"https://{raw}"
        try:
            parsed = urlparse(target)
        except Exception:
            return None
        host = str(parsed.netloc or "").strip().lower()
        if not host:
            return None
        return host[:255]

    async def resolve_org_id(self, org_ref: str) -> int | None:
        value = (
            await self.session.execute(
                text("select id from b2b_organizations where uuid = cast(:value as uuid)"),
                {"value": self._uuid(org_ref)},
            )
        ).scalar_one_or_none()
        return int(value) if value is not None else None

    async def resolve_store_id(self, store_ref: str) -> int | None:
        value = (
            await self.session.execute(
                text("select id from catalog_stores where uuid = cast(:value as uuid)"),
                {"value": self._uuid(store_ref)},
            )
        ).scalar_one_or_none()
        return int(value) if value is not None else None

    async def resolve_feed_id(self, feed_ref: str) -> int | None:
        value = (
            await self.session.execute(
                text("select id from b2b_feed_sources where uuid = cast(:value as uuid)"),
                {"value": self._uuid(feed_ref)},
            )
        ).scalar_one_or_none()
        return int(value) if value is not None else None

    async def resolve_campaign_id(self, campaign_ref: str) -> int | None:
        value = (
            await self.session.execute(
                text("select id from b2b_campaigns where uuid = cast(:value as uuid)"),
                {"value": self._uuid(campaign_ref)},
            )
        ).scalar_one_or_none()
        return int(value) if value is not None else None

    async def resolve_invoice_id(self, invoice_ref: str) -> int | None:
        value = (
            await self.session.execute(
                text("select id from b2b_invoices where uuid = cast(:value as uuid)"),
                {"value": self._uuid(invoice_ref)},
            )
        ).scalar_one_or_none()
        return int(value) if value is not None else None

    async def resolve_ticket_id(self, ticket_ref: str) -> int | None:
        value = (
            await self.session.execute(
                text("select id from b2b_support_tickets where uuid = cast(:value as uuid)"),
                {"value": self._uuid(ticket_ref)},
            )
        ).scalar_one_or_none()
        return int(value) if value is not None else None

    async def get_membership(self, *, org_id: int, user_uuid: str) -> dict[str, Any] | None:
        row = (
            await self.session.execute(
                text(
                    """
                    select
                        m.uuid as membership_uuid,
                        m.user_uuid,
                        m.role,
                        m.status,
                        o.uuid as org_uuid,
                        o.name as org_name
                    from b2b_org_memberships m
                    join b2b_organizations o on o.id = m.org_id
                    where m.org_id = :org_id
                      and m.user_uuid = cast(:user_uuid as uuid)
                    limit 1
                    """
                ),
                {"org_id": org_id, "user_uuid": self._uuid(user_uuid)},
            )
        ).mappings().first()
        return dict(row) if row else None

    async def list_user_orgs(self, *, user_uuid: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        rows = (
            await self.session.execute(
                text(
                    """
                    select
                        m.uuid as membership_uuid,
                        m.user_uuid,
                        m.role,
                        m.status as membership_status,
                        m.created_at as membership_created_at,
                        m.updated_at as membership_updated_at,
                        o.uuid as org_uuid,
                        o.slug,
                        o.name,
                        o.legal_name,
                        o.tax_id,
                        o.status as org_status,
                        o.country_code,
                        o.default_currency,
                        o.website_url,
                        o.created_at as org_created_at,
                        o.updated_at as org_updated_at
                    from b2b_org_memberships m
                    join b2b_organizations o on o.id = m.org_id
                    where m.user_uuid = cast(:user_uuid as uuid)
                    order by m.created_at asc
                    """
                ),
                {"user_uuid": self._uuid(user_uuid)},
            )
        ).mappings().all()

        memberships: list[dict[str, Any]] = []
        organizations: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in rows:
            memberships.append(
                {
                    "id": str(row["membership_uuid"]),
                    "org_id": str(row["org_uuid"]),
                    "user_id": str(row["user_uuid"]),
                    "role": str(row["role"]),
                    "status": str(row["membership_status"]),
                    "created_at": self._iso(row.get("membership_created_at")),
                    "updated_at": self._iso(row.get("membership_updated_at")),
                }
            )
            org_uuid = str(row["org_uuid"])
            if org_uuid in seen:
                continue
            seen.add(org_uuid)
            organizations.append(
                {
                    "id": org_uuid,
                    "slug": str(row["slug"]),
                    "name": str(row["name"]),
                    "legal_name": row.get("legal_name"),
                    "tax_id": row.get("tax_id"),
                    "status": str(row["org_status"]),
                    "country_code": str(row.get("country_code") or "UZ"),
                    "default_currency": str(row.get("default_currency") or "UZS"),
                    "website_url": row.get("website_url"),
                    "created_at": self._iso(row.get("org_created_at")),
                    "updated_at": self._iso(row.get("org_updated_at")),
                }
            )
        return memberships, organizations

    async def get_onboarding_status_by_org(self, *, org_uuids: list[str]) -> dict[str, str]:
        if not org_uuids:
            return {}
        rows = (
            await self.session.execute(
                text(
                    """
                    with latest as (
                        select
                            oa.org_id,
                            oa.status,
                            row_number() over (partition by oa.org_id order by oa.updated_at desc, oa.id desc) as rn
                        from b2b_onboarding_applications oa
                        join b2b_organizations o on o.id = oa.org_id
                        where o.uuid = any(cast(:org_uuids as uuid[]))
                    )
                    select o.uuid as org_uuid, l.status
                    from latest l
                    join b2b_organizations o on o.id = l.org_id
                    where l.rn = 1
                    """
                ),
                {"org_uuids": [self._uuid(item) for item in org_uuids]},
            )
        ).mappings().all()
        return {str(row["org_uuid"]): str(row["status"]) for row in rows}

    async def get_billing_status_by_org(self, *, org_uuids: list[str]) -> dict[str, str]:
        if not org_uuids:
            return {}
        rows = (
            await self.session.execute(
                text(
                    """
                    with latest as (
                        select
                            s.org_id,
                            s.status,
                            row_number() over (partition by s.org_id order by s.updated_at desc, s.id desc) as rn
                        from b2b_subscriptions s
                        join b2b_organizations o on o.id = s.org_id
                        where o.uuid = any(cast(:org_uuids as uuid[]))
                    )
                    select o.uuid as org_uuid, l.status
                    from latest l
                    join b2b_organizations o on o.id = l.org_id
                    where l.rn = 1
                    """
                ),
                {"org_uuids": [self._uuid(item) for item in org_uuids]},
            )
        ).mappings().all()
        return {str(row["org_uuid"]): str(row["status"]) for row in rows}

    async def create_org(
        self,
        *,
        name: str,
        slug: str,
        legal_name: str | None,
        tax_id: str | None,
        website_url: str | None,
        user_uuid: str,
    ) -> dict[str, Any]:
        org = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_organizations (
                        slug,
                        name,
                        legal_name,
                        tax_id,
                        website_url,
                        status,
                        country_code,
                        default_currency,
                        created_by_user_uuid
                    ) values (
                        :slug,
                        :name,
                        :legal_name,
                        :tax_id,
                        :website_url,
                        'active',
                        'UZ',
                        'UZS',
                        cast(:user_uuid as uuid)
                    )
                    returning id, uuid, slug, name, legal_name, tax_id, status, country_code, default_currency, website_url, created_at, updated_at
                    """
                ),
                {
                    "slug": slug,
                    "name": name,
                    "legal_name": legal_name,
                    "tax_id": tax_id,
                    "website_url": website_url,
                    "user_uuid": self._uuid(user_uuid),
                },
            )
        ).mappings().one()
        member = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_org_memberships (org_id, user_uuid, role, status, invited_by_user_uuid)
                    values (:org_id, cast(:user_uuid as uuid), 'owner', 'active', cast(:user_uuid as uuid))
                    returning uuid, user_uuid, role, status, created_at, updated_at
                    """
                ),
                {"org_id": int(org["id"]), "user_uuid": self._uuid(user_uuid)},
            )
        ).mappings().one()
        await self.session.execute(
            text(
                """
                insert into b2b_org_audit_events (org_id, actor_user_uuid, action, entity_type, entity_id, payload)
                values (
                    :org_id,
                    cast(:actor_user_uuid as uuid),
                    'org.create',
                    'organization',
                    cast(:entity_id as text),
                    cast(:payload as jsonb)
                )
                """
            ),
            {
                "org_id": int(org["id"]),
                "actor_user_uuid": self._uuid(user_uuid),
                "entity_id": str(org["uuid"]),
                "payload": json.dumps({"name": name, "slug": slug}),
            },
        )
        await self.session.commit()
        return {
            "organization": {
                "id": str(org["uuid"]),
                "slug": str(org["slug"]),
                "name": str(org["name"]),
                "legal_name": org.get("legal_name"),
                "tax_id": org.get("tax_id"),
                "status": str(org["status"]),
                "country_code": str(org["country_code"]),
                "default_currency": str(org["default_currency"]),
                "website_url": org.get("website_url"),
                "created_at": self._iso(org.get("created_at")),
                "updated_at": self._iso(org.get("updated_at")),
            },
            "membership": {
                "id": str(member["uuid"]),
                "org_id": str(org["uuid"]),
                "user_id": str(member["user_uuid"]),
                "role": str(member["role"]),
                "status": str(member["status"]),
                "created_at": self._iso(member.get("created_at")),
                "updated_at": self._iso(member.get("updated_at")),
            },
        }

    async def create_org_invite(
        self,
        *,
        org_id: int,
        email: str,
        role: str,
        expires_in_days: int,
        invited_by_user_uuid: str,
    ) -> dict[str, Any]:
        token = secrets.token_urlsafe(24)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        row = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_org_invites (
                        org_id,
                        email,
                        role,
                        token_hash,
                        status,
                        invited_by_user_uuid,
                        expires_at
                    ) values (
                        :org_id,
                        :email,
                        :role,
                        :token_hash,
                        'pending',
                        cast(:invited_by_user_uuid as uuid),
                        :expires_at
                    )
                    returning uuid, email, role, status, expires_at
                    """
                ),
                {
                    "org_id": org_id,
                    "email": email.strip().lower(),
                    "role": role,
                    "token_hash": token_hash,
                    "invited_by_user_uuid": self._uuid(invited_by_user_uuid),
                    "expires_at": self._now() + timedelta(days=max(1, int(expires_in_days))),
                },
            )
        ).mappings().one()
        org_uuid = (
            await self.session.execute(text("select uuid from b2b_organizations where id = :org_id"), {"org_id": org_id})
        ).scalar_one()
        await self.session.commit()
        return {
            "id": str(row["uuid"]),
            "org_id": str(org_uuid),
            "email": str(row["email"]),
            "role": str(row["role"]),
            "status": str(row["status"]),
            "expires_at": self._iso(row.get("expires_at")),
            "invite_token": token,
        }

    async def patch_member(
        self,
        *,
        org_id: int,
        membership_uuid: str,
        role: str | None,
        status: str | None,
        actor_user_uuid: str,
    ) -> dict[str, Any] | None:
        assignments: list[str] = []
        params: dict[str, Any] = {"org_id": org_id, "membership_uuid": self._uuid(membership_uuid)}
        if role is not None:
            assignments.append("role = :role")
            params["role"] = role
        if status is not None:
            assignments.append("status = :status")
            params["status"] = status
        if not assignments:
            return None
        assignments.append("updated_at = now()")
        row = (
            await self.session.execute(
                text(
                    f"""
                    update b2b_org_memberships
                    set {", ".join(assignments)}
                    where org_id = :org_id
                      and uuid = cast(:membership_uuid as uuid)
                    returning uuid, user_uuid, role, status, created_at, updated_at
                    """
                ),
                params,
            )
        ).mappings().first()
        if not row:
            await self.session.rollback()
            return None
        org_uuid = (
            await self.session.execute(text("select uuid from b2b_organizations where id = :org_id"), {"org_id": org_id})
        ).scalar_one()
        await self.session.execute(
            text(
                """
                insert into b2b_org_audit_events (org_id, actor_user_uuid, action, entity_type, entity_id, payload)
                values (
                    :org_id,
                    cast(:actor_user_uuid as uuid),
                    'membership.patch',
                    'membership',
                    cast(:entity_id as text),
                    cast(:payload as jsonb)
                )
                """
            ),
            {
                "org_id": org_id,
                "actor_user_uuid": self._uuid(actor_user_uuid),
                "entity_id": self._uuid(membership_uuid),
                "payload": json.dumps({"role": role, "status": status}),
            },
        )
        await self.session.commit()
        return {
            "id": str(row["uuid"]),
            "org_id": str(org_uuid),
            "user_id": str(row["user_uuid"]),
            "role": str(row["role"]),
            "status": str(row["status"]),
            "created_at": self._iso(row.get("created_at")),
            "updated_at": self._iso(row.get("updated_at")),
        }

    async def create_partner_lead(
        self,
        *,
        payload: dict[str, Any],
        submitted_ip: str,
        submitted_user_agent: str,
    ) -> dict[str, Any]:
        categories = self._to_str_list(payload.get("categories"), max_items=40, max_len=80)
        marketplaces = self._to_str_list(payload.get("marketplaces"), max_items=40, max_len=80)
        monthly_orders = self._to_int(payload.get("monthly_orders"), default=0)
        warehouses_count = self._to_int(payload.get("warehouses_count"), default=0)
        avg_order_value = self._to_float(payload.get("avg_order_value"), default=0.0)
        tracking_token = self._issue_tracking_token()
        tracking_token_hash = self._hash_tracking_token(tracking_token)

        row = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_partner_leads (
                        status,
                        company_name,
                        legal_name,
                        brand_name,
                        tax_id,
                        website_url,
                        contact_name,
                        contact_role,
                        email,
                        phone,
                        telegram,
                        country_code,
                        city,
                        categories,
                        monthly_orders,
                        avg_order_value,
                        feed_url,
                        logistics_model,
                        warehouses_count,
                        marketplaces,
                        returns_policy,
                        goals,
                        notes,
                        tracking_token_hash,
                        provisioning_status,
                        submitted_ip,
                        submitted_user_agent
                    ) values (
                        'submitted',
                        :company_name,
                        :legal_name,
                        :brand_name,
                        :tax_id,
                        :website_url,
                        :contact_name,
                        :contact_role,
                        :email,
                        :phone,
                        :telegram,
                        :country_code,
                        :city,
                        cast(:categories as jsonb),
                        :monthly_orders,
                        :avg_order_value,
                        :feed_url,
                        :logistics_model,
                        :warehouses_count,
                        cast(:marketplaces as jsonb),
                        :returns_policy,
                        :goals,
                        :notes,
                        :tracking_token_hash,
                        'pending',
                        :submitted_ip,
                        :submitted_user_agent
                    )
                    returning
                        uuid,
                        status,
                        company_name,
                        legal_name,
                        brand_name,
                        tax_id,
                        website_url,
                        contact_name,
                        contact_role,
                        email,
                        phone,
                        telegram,
                        country_code,
                        city,
                        categories,
                        monthly_orders,
                        avg_order_value,
                        feed_url,
                        logistics_model,
                        warehouses_count,
                        marketplaces,
                        returns_policy,
                        goals,
                        notes,
                        review_note,
                        reviewed_at,
                        provisioning_status,
                        provisioned_user_uuid,
                        provisioned_org_uuid,
                        onboarding_application_uuid,
                        provisioned_at,
                        provisioning_error,
                        welcome_email_sent_at,
                        created_at,
                        updated_at
                    """
                ),
                {
                    "company_name": str(payload.get("company_name") or "").strip(),
                    "legal_name": str(payload.get("legal_name") or "").strip() or None,
                    "brand_name": str(payload.get("brand_name") or "").strip() or None,
                    "tax_id": str(payload.get("tax_id") or "").strip() or None,
                    "website_url": str(payload.get("website_url") or "").strip() or None,
                    "contact_name": str(payload.get("contact_name") or "").strip(),
                    "contact_role": str(payload.get("contact_role") or "").strip() or None,
                    "email": str(payload.get("email") or "").strip().lower(),
                    "phone": str(payload.get("phone") or "").strip(),
                    "telegram": str(payload.get("telegram") or "").strip() or None,
                    "country_code": (str(payload.get("country_code") or "UZ").strip().upper() or "UZ")[:2],
                    "city": str(payload.get("city") or "").strip() or None,
                    "categories": json.dumps(categories),
                    "monthly_orders": monthly_orders if monthly_orders > 0 else None,
                    "avg_order_value": avg_order_value if avg_order_value > 0 else None,
                    "feed_url": str(payload.get("feed_url") or "").strip() or None,
                    "logistics_model": str(payload.get("logistics_model") or "own_warehouse").strip().lower() or "own_warehouse",
                    "warehouses_count": warehouses_count if warehouses_count > 0 else None,
                    "marketplaces": json.dumps(marketplaces),
                    "returns_policy": str(payload.get("returns_policy") or "").strip() or None,
                    "goals": str(payload.get("goals") or "").strip() or None,
                    "notes": str(payload.get("notes") or "").strip() or None,
                    "tracking_token_hash": tracking_token_hash,
                    "submitted_ip": str(submitted_ip or "").strip()[:128] or None,
                    "submitted_user_agent": str(submitted_user_agent or "").strip()[:512] or None,
                },
            )
        ).mappings().one()
        await self.session.commit()

        return {
            "id": str(row["uuid"]),
            "status": str(row["status"]),
            "company_name": str(row["company_name"]),
            "legal_name": row.get("legal_name"),
            "brand_name": row.get("brand_name"),
            "tax_id": row.get("tax_id"),
            "website_url": row.get("website_url"),
            "contact_name": str(row["contact_name"]),
            "contact_role": row.get("contact_role"),
            "email": str(row["email"]),
            "phone": str(row["phone"]),
            "telegram": row.get("telegram"),
            "country_code": str(row.get("country_code") or "UZ"),
            "city": row.get("city"),
            "categories": self._to_str_list(row.get("categories"), max_items=40, max_len=80),
            "monthly_orders": self._to_int(row.get("monthly_orders"), default=0) or None,
            "avg_order_value": self._to_float(row.get("avg_order_value"), default=0.0) or None,
            "feed_url": row.get("feed_url"),
            "logistics_model": str(row.get("logistics_model") or "own_warehouse"),
            "warehouses_count": self._to_int(row.get("warehouses_count"), default=0) or None,
            "marketplaces": self._to_str_list(row.get("marketplaces"), max_items=40, max_len=80),
            "returns_policy": row.get("returns_policy"),
            "goals": row.get("goals"),
            "notes": row.get("notes"),
            "review_note": row.get("review_note"),
            "reviewed_at": self._iso(row.get("reviewed_at")),
            "tracking_token": tracking_token,
            "provisioning_status": str(row.get("provisioning_status") or "pending"),
            "provisioned_user_id": str(row["provisioned_user_uuid"]) if row.get("provisioned_user_uuid") else None,
            "provisioned_org_id": str(row["provisioned_org_uuid"]) if row.get("provisioned_org_uuid") else None,
            "onboarding_application_id": str(row["onboarding_application_uuid"]) if row.get("onboarding_application_uuid") else None,
            "provisioned_at": self._iso(row.get("provisioned_at")),
            "provisioning_error": row.get("provisioning_error"),
            "welcome_email_sent_at": self._iso(row.get("welcome_email_sent_at")),
            "created_at": self._iso(row.get("created_at")),
            "updated_at": self._iso(row.get("updated_at")),
        }

    async def upsert_onboarding_application(self, *, payload: dict[str, Any], user_uuid: str) -> dict[str, Any]:
        org_id = int(payload["org_id"])
        status = "submitted" if bool(payload.get("submit")) else "draft"
        submitted_at = self._now() if status == "submitted" else None
        existing_id = (
            await self.session.execute(
                text(
                    """
                    select id
                    from b2b_onboarding_applications
                    where org_id = :org_id
                    order by updated_at desc, id desc
                    limit 1
                    """
                ),
                {"org_id": org_id},
            )
        ).scalar_one_or_none()
        params = {
            "org_id": org_id,
            "status": status,
            "company_name": payload["company_name"],
            "legal_address": payload.get("legal_address"),
            "billing_email": payload["billing_email"],
            "contact_name": payload["contact_name"],
            "contact_phone": payload.get("contact_phone"),
            "website_domain": payload.get("website_domain"),
            "tax_id": payload.get("tax_id"),
            "payout_details": json.dumps(payload.get("payout_details") or {}),
            "submitted_at": submitted_at,
            "user_uuid": self._uuid(user_uuid),
        }
        if existing_id is None:
            row = (
                await self.session.execute(
                    text(
                        """
                        insert into b2b_onboarding_applications (
                            org_id,
                            status,
                            company_name,
                            legal_address,
                            billing_email,
                            contact_name,
                            contact_phone,
                            website_domain,
                            tax_id,
                            payout_details,
                            submitted_at,
                            created_by_user_uuid,
                            updated_by_user_uuid
                        ) values (
                            :org_id,
                            :status,
                            :company_name,
                            :legal_address,
                            :billing_email,
                            :contact_name,
                            :contact_phone,
                            :website_domain,
                            :tax_id,
                            cast(:payout_details as jsonb),
                            :submitted_at,
                            cast(:user_uuid as uuid),
                            cast(:user_uuid as uuid)
                        )
                        returning uuid, status, company_name, billing_email, contact_name, tax_id, rejection_reason, submitted_at, reviewed_at, created_at, updated_at
                        """
                    ),
                    params,
                )
            ).mappings().one()
        else:
            params["id"] = int(existing_id)
            row = (
                await self.session.execute(
                    text(
                        """
                        update b2b_onboarding_applications
                        set
                            status = :status,
                            company_name = :company_name,
                            legal_address = :legal_address,
                            billing_email = :billing_email,
                            contact_name = :contact_name,
                            contact_phone = :contact_phone,
                            website_domain = :website_domain,
                            tax_id = :tax_id,
                            payout_details = cast(:payout_details as jsonb),
                            submitted_at = coalesce(:submitted_at, submitted_at),
                            rejection_reason = null,
                            reviewed_at = null,
                            reviewed_by_user_uuid = null,
                            updated_by_user_uuid = cast(:user_uuid as uuid),
                            updated_at = now()
                        where id = :id
                        returning uuid, status, company_name, billing_email, contact_name, tax_id, rejection_reason, submitted_at, reviewed_at, created_at, updated_at
                        """
                    ),
                    params,
                )
            ).mappings().one()
        org_uuid = (
            await self.session.execute(text("select uuid from b2b_organizations where id = :org_id"), {"org_id": org_id})
        ).scalar_one()
        await self.session.commit()
        return {
            "id": str(row["uuid"]),
            "org_id": str(org_uuid),
            "status": str(row["status"]),
            "company_name": str(row["company_name"]),
            "billing_email": str(row["billing_email"]),
            "contact_name": str(row["contact_name"]),
            "tax_id": row.get("tax_id"),
            "rejection_reason": row.get("rejection_reason"),
            "submitted_at": self._iso(row.get("submitted_at")),
            "reviewed_at": self._iso(row.get("reviewed_at")),
            "created_at": self._iso(row.get("created_at")),
            "updated_at": self._iso(row.get("updated_at")),
        }

    async def create_kyc_document(
        self,
        *,
        org_id: int,
        application_id: int | None,
        document_type: str,
        storage_url: str,
        checksum: str | None,
    ) -> dict[str, Any]:
        row = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_kyc_documents (
                        org_id,
                        application_id,
                        document_type,
                        storage_url,
                        checksum,
                        status
                    ) values (
                        :org_id,
                        :application_id,
                        :document_type,
                        :storage_url,
                        :checksum,
                        'uploaded'
                    )
                    returning uuid, application_id, document_type, storage_url, status, created_at
                    """
                ),
                {
                    "org_id": org_id,
                    "application_id": application_id,
                    "document_type": document_type,
                    "storage_url": storage_url,
                    "checksum": checksum,
                },
            )
        ).mappings().one()
        org_uuid = (
            await self.session.execute(text("select uuid from b2b_organizations where id = :org_id"), {"org_id": org_id})
        ).scalar_one()
        application_uuid = None
        if row.get("application_id") is not None:
            application_uuid = (
                await self.session.execute(
                    text("select uuid from b2b_onboarding_applications where id = :id"),
                    {"id": int(row["application_id"])},
                )
            ).scalar_one_or_none()
        await self.session.commit()
        return {
            "id": str(row["uuid"]),
            "org_id": str(org_uuid),
            "application_id": str(application_uuid) if application_uuid else None,
            "document_type": str(row["document_type"]),
            "storage_url": str(row["storage_url"]),
            "status": str(row["status"]),
            "created_at": self._iso(row.get("created_at")),
        }

    async def accept_contract(
        self,
        *,
        org_id: int,
        contract_version: str,
        user_uuid: str,
        ip_address: str,
        user_agent: str,
    ) -> dict[str, Any]:
        existing = (
            await self.session.execute(
                text(
                    """
                    select uuid, accepted_at, accepted_by_user_uuid
                    from b2b_contract_acceptances
                    where org_id = :org_id
                      and contract_version = :contract_version
                    limit 1
                    """
                ),
                {"org_id": org_id, "contract_version": contract_version},
            )
        ).mappings().first()
        if existing:
            org_uuid = (
                await self.session.execute(text("select uuid from b2b_organizations where id = :org_id"), {"org_id": org_id})
            ).scalar_one()
            return {
                "id": str(existing["uuid"]),
                "org_id": str(org_uuid),
                "contract_version": contract_version,
                "accepted_by_user_id": str(existing["accepted_by_user_uuid"]),
                "accepted_at": self._iso(existing.get("accepted_at")),
            }

        row = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_contract_acceptances (
                        org_id,
                        contract_version,
                        accepted_by_user_uuid,
                        accepted_at,
                        ip_address,
                        user_agent
                    ) values (
                        :org_id,
                        :contract_version,
                        cast(:user_uuid as uuid),
                        now(),
                        :ip_address,
                        :user_agent
                    )
                    returning uuid, accepted_at
                    """
                ),
                {
                    "org_id": org_id,
                    "contract_version": contract_version,
                    "user_uuid": self._uuid(user_uuid),
                    "ip_address": ip_address[:128],
                    "user_agent": user_agent[:512],
                },
            )
        ).mappings().one()
        org_uuid = (
            await self.session.execute(text("select uuid from b2b_organizations where id = :org_id"), {"org_id": org_id})
        ).scalar_one()
        await self.session.commit()
        return {
            "id": str(row["uuid"]),
            "org_id": str(org_uuid),
            "contract_version": contract_version,
            "accepted_by_user_id": self._uuid(user_uuid),
            "accepted_at": self._iso(row.get("accepted_at")),
        }

    async def list_feeds(self, *, org_id: int, store_id: int | None = None) -> list[dict[str, Any]]:
        where = ["f.org_id = :org_id"]
        params: dict[str, Any] = {"org_id": org_id}
        if store_id is not None:
            where.append("f.store_id = :store_id")
            params["store_id"] = store_id
        rows = (
            await self.session.execute(
                text(
                    f"""
                    select
                        f.uuid,
                        o.uuid as org_uuid,
                        s.uuid as store_uuid,
                        f.source_type,
                        f.source_url,
                        f.schedule_cron,
                        f.status,
                        f.is_active,
                        f.last_validated_at,
                        f.created_at,
                        f.updated_at
                    from b2b_feed_sources f
                    join b2b_organizations o on o.id = f.org_id
                    join catalog_stores s on s.id = f.store_id
                    where {" and ".join(where)}
                    order by f.updated_at desc, f.id desc
                    """
                ),
                params,
            )
        ).mappings().all()
        return [
            {
                "id": str(row["uuid"]),
                "org_id": str(row["org_uuid"]),
                "store_id": str(row["store_uuid"]),
                "source_type": str(row["source_type"]),
                "source_url": str(row["source_url"]),
                "schedule_cron": str(row["schedule_cron"]),
                "status": str(row["status"]),
                "is_active": bool(row["is_active"]),
                "last_validated_at": self._iso(row.get("last_validated_at")),
                "created_at": self._iso(row.get("created_at")),
                "updated_at": self._iso(row.get("updated_at")),
            }
            for row in rows
        ]

    async def create_feed(
        self,
        *,
        org_id: int,
        store_id: int,
        source_type: str,
        source_url: str,
        schedule_cron: str,
        auth_config: dict,
        is_active: bool,
        created_by_user_uuid: str,
    ) -> dict[str, Any]:
        await self.session.execute(
            text(
                """
                insert into b2b_org_store_links (org_id, store_id, status, ownership_verification_method)
                values (:org_id, :store_id, 'pending', 'feed_source')
                on conflict (org_id, store_id) do nothing
                """
            ),
            {"org_id": org_id, "store_id": store_id},
        )
        row = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_feed_sources (
                        org_id,
                        store_id,
                        source_type,
                        source_url,
                        auth_config,
                        schedule_cron,
                        is_active,
                        status,
                        created_by_user_uuid
                    ) values (
                        :org_id,
                        :store_id,
                        :source_type,
                        :source_url,
                        cast(:auth_config as jsonb),
                        :schedule_cron,
                        :is_active,
                        case when :is_active then 'active' else 'paused' end,
                        cast(:created_by_user_uuid as uuid)
                    )
                    returning uuid, source_type, source_url, schedule_cron, status, is_active, created_at, updated_at
                    """
                ),
                {
                    "org_id": org_id,
                    "store_id": store_id,
                    "source_type": source_type,
                    "source_url": source_url,
                    "auth_config": json.dumps(auth_config or {}),
                    "schedule_cron": schedule_cron,
                    "is_active": bool(is_active),
                    "created_by_user_uuid": self._uuid(created_by_user_uuid),
                },
            )
        ).mappings().one()
        org_uuid = (
            await self.session.execute(text("select uuid from b2b_organizations where id = :id"), {"id": org_id})
        ).scalar_one()
        store_uuid = (
            await self.session.execute(text("select uuid from catalog_stores where id = :id"), {"id": store_id})
        ).scalar_one()
        await self.session.commit()
        return {
            "id": str(row["uuid"]),
            "org_id": str(org_uuid),
            "store_id": str(store_uuid),
            "source_type": str(row["source_type"]),
            "source_url": str(row["source_url"]),
            "schedule_cron": str(row["schedule_cron"]),
            "status": str(row["status"]),
            "is_active": bool(row["is_active"]),
            "last_validated_at": None,
            "created_at": self._iso(row.get("created_at")),
            "updated_at": self._iso(row.get("updated_at")),
        }

    async def validate_feed(self, *, feed_id: int) -> dict[str, Any]:
        run = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_feed_runs (
                        feed_id,
                        status,
                        started_at,
                        finished_at,
                        total_items,
                        processed_items,
                        rejected_items
                    ) values (
                        :feed_id,
                        'success',
                        now(),
                        now(),
                        100,
                        93,
                        7
                    )
                    returning id, uuid
                    """
                ),
                {"feed_id": feed_id},
            )
        ).mappings().one()
        quality = {
            "availability_ratio": 0.93,
            "price_anomaly_ratio": 0.05,
            "duplicate_ratio": 0.02,
            "stale_ratio": 0.08,
            "image_quality_ratio": 0.91,
        }
        await self.session.execute(
            text(
                """
                insert into b2b_feed_quality_snapshots (
                    feed_id,
                    run_id,
                    availability_ratio,
                    price_anomaly_ratio,
                    duplicate_ratio,
                    stale_ratio,
                    image_quality_ratio,
                    summary
                ) values (
                    :feed_id,
                    :run_id,
                    :availability_ratio,
                    :price_anomaly_ratio,
                    :duplicate_ratio,
                    :stale_ratio,
                    :image_quality_ratio,
                    cast(:summary as jsonb)
                )
                """
            ),
            {"feed_id": feed_id, "run_id": int(run["id"]), **quality, "summary": json.dumps({"checks": quality})},
        )
        await self.session.execute(
            text(
                """
                update b2b_feed_sources
                set last_validated_at = now(), status = 'active', updated_at = now()
                where id = :feed_id
                """
            ),
            {"feed_id": feed_id},
        )
        feed_uuid = (
            await self.session.execute(text("select uuid from b2b_feed_sources where id = :feed_id"), {"feed_id": feed_id})
        ).scalar_one()
        await self.session.commit()
        return {"feed_id": str(feed_uuid), "run_id": str(run["uuid"]), "status": "success", "quality_snapshot": quality}

    async def list_feed_runs(self, *, org_id: int, feed_id: int) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                text(
                    """
                    select
                        r.uuid,
                        f.uuid as feed_uuid,
                        r.status,
                        r.started_at,
                        r.finished_at,
                        r.total_items,
                        r.processed_items,
                        r.rejected_items,
                        r.error_summary
                    from b2b_feed_runs r
                    join b2b_feed_sources f on f.id = r.feed_id
                    where f.org_id = :org_id
                      and r.feed_id = :feed_id
                    order by r.id desc
                    limit 100
                    """
                ),
                {"org_id": org_id, "feed_id": feed_id},
            )
        ).mappings().all()
        return [
            {
                "id": str(row["uuid"]),
                "feed_id": str(row["feed_uuid"]),
                "status": str(row["status"]),
                "started_at": self._iso(row.get("started_at")),
                "finished_at": self._iso(row.get("finished_at")),
                "total_items": self._to_int(row.get("total_items")),
                "processed_items": self._to_int(row.get("processed_items")),
                "rejected_items": self._to_int(row.get("rejected_items")),
                "error_summary": row.get("error_summary"),
            }
            for row in rows
        ]

    async def list_campaigns(self, *, org_id: int) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                text(
                    """
                    select
                        c.uuid,
                        o.uuid as org_uuid,
                        s.uuid as store_uuid,
                        c.name,
                        c.status,
                        c.strategy,
                        c.daily_budget,
                        c.monthly_budget,
                        c.bid_default,
                        c.bid_cap,
                        c.pacing_mode,
                        c.starts_at,
                        c.ends_at,
                        c.created_at,
                        c.updated_at
                    from b2b_campaigns c
                    join b2b_organizations o on o.id = c.org_id
                    join catalog_stores s on s.id = c.store_id
                    where c.org_id = :org_id
                    order by c.updated_at desc, c.id desc
                    """
                ),
                {"org_id": org_id},
            )
        ).mappings().all()
        return [
            {
                "id": str(row["uuid"]),
                "org_id": str(row["org_uuid"]),
                "store_id": str(row["store_uuid"]),
                "name": str(row["name"]),
                "status": str(row["status"]),
                "strategy": str(row["strategy"]),
                "daily_budget": self._to_float(row.get("daily_budget")),
                "monthly_budget": self._to_float(row.get("monthly_budget")),
                "bid_default": self._to_float(row.get("bid_default")),
                "bid_cap": self._to_float(row.get("bid_cap")),
                "pacing_mode": str(row.get("pacing_mode") or "even"),
                "starts_at": self._iso(row.get("starts_at")),
                "ends_at": self._iso(row.get("ends_at")),
                "created_at": self._iso(row.get("created_at")),
                "updated_at": self._iso(row.get("updated_at")),
            }
            for row in rows
        ]

    async def create_campaign(self, *, payload: dict[str, Any], user_uuid: str) -> dict[str, Any]:
        row = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_campaigns (
                        org_id,
                        store_id,
                        name,
                        status,
                        strategy,
                        daily_budget,
                        monthly_budget,
                        bid_default,
                        bid_cap,
                        pacing_mode,
                        starts_at,
                        ends_at,
                        created_by_user_uuid
                    ) values (
                        :org_id,
                        :store_id,
                        :name,
                        'draft',
                        'cpc',
                        :daily_budget,
                        :monthly_budget,
                        :bid_default,
                        :bid_cap,
                        :pacing_mode,
                        :starts_at,
                        :ends_at,
                        cast(:user_uuid as uuid)
                    )
                    returning id, uuid, created_at, updated_at
                    """
                ),
                {
                    "org_id": int(payload["org_id"]),
                    "store_id": int(payload["store_id"]),
                    "name": payload["name"],
                    "daily_budget": float(payload["daily_budget"]),
                    "monthly_budget": float(payload["monthly_budget"]),
                    "bid_default": float(payload["bid_default"]),
                    "bid_cap": float(payload["bid_cap"]),
                    "pacing_mode": payload["pacing_mode"],
                    "starts_at": payload.get("starts_at"),
                    "ends_at": payload.get("ends_at"),
                    "user_uuid": self._uuid(user_uuid),
                },
            )
        ).mappings().one()
        campaign_id = int(row["id"])
        for target in payload.get("targets") or []:
            target_type = str(target.get("target_type") or "").strip()
            target_value = str(target.get("target_value") or "").strip()
            if not target_type or not target_value:
                continue
            await self.session.execute(
                text(
                    """
                    insert into b2b_campaign_targets (campaign_id, target_type, target_value, bid_override, is_exclude)
                    values (:campaign_id, :target_type, :target_value, :bid_override, :is_exclude)
                    on conflict (campaign_id, target_type, target_value) do update
                    set bid_override = excluded.bid_override,
                        is_exclude = excluded.is_exclude,
                        updated_at = now()
                    """
                ),
                {
                    "campaign_id": campaign_id,
                    "target_type": target_type,
                    "target_value": target_value,
                    "bid_override": target.get("bid_override"),
                    "is_exclude": bool(target.get("is_exclude")),
                },
            )
        await self.session.execute(
            text(
                """
                insert into b2b_campaign_states (campaign_id, state, reason, actor_user_uuid)
                values (:campaign_id, 'draft', 'created', cast(:actor as uuid))
                """
            ),
            {"campaign_id": campaign_id, "actor": self._uuid(user_uuid)},
        )
        org_uuid = (
            await self.session.execute(text("select uuid from b2b_organizations where id = :id"), {"id": int(payload["org_id"])})
        ).scalar_one()
        store_uuid = (
            await self.session.execute(text("select uuid from catalog_stores where id = :id"), {"id": int(payload["store_id"])})
        ).scalar_one()
        await self.session.commit()
        return {
            "id": str(row["uuid"]),
            "org_id": str(org_uuid),
            "store_id": str(store_uuid),
            "name": payload["name"],
            "status": "draft",
            "strategy": "cpc",
            "daily_budget": float(payload["daily_budget"]),
            "monthly_budget": float(payload["monthly_budget"]),
            "bid_default": float(payload["bid_default"]),
            "bid_cap": float(payload["bid_cap"]),
            "pacing_mode": payload["pacing_mode"],
            "starts_at": self._iso(payload.get("starts_at")),
            "ends_at": self._iso(payload.get("ends_at")),
            "created_at": self._iso(row.get("created_at")),
            "updated_at": self._iso(row.get("updated_at")),
        }

    async def patch_campaign(self, *, org_id: int, campaign_id: int, payload: dict[str, Any], actor_uuid: str) -> dict[str, Any] | None:
        assignments: list[str] = []
        params: dict[str, Any] = {"org_id": org_id, "campaign_id": campaign_id}
        for field in ("status", "daily_budget", "monthly_budget", "bid_default", "bid_cap", "pacing_mode", "ends_at"):
            if field in payload and payload[field] is not None:
                assignments.append(f"{field} = :{field}")
                params[field] = payload[field]
        if not assignments:
            return None
        assignments.append("updated_at = now()")
        row = (
            await self.session.execute(
                text(
                    f"""
                    update b2b_campaigns
                    set {", ".join(assignments)}
                    where id = :campaign_id and org_id = :org_id
                    returning id, uuid, org_id, store_id, name, status, strategy, daily_budget, monthly_budget, bid_default, bid_cap, pacing_mode, starts_at, ends_at, created_at, updated_at
                    """
                ),
                params,
            )
        ).mappings().first()
        if not row:
            await self.session.rollback()
            return None
        if "status" in payload and payload["status"] is not None:
            await self.session.execute(
                text(
                    """
                    insert into b2b_campaign_states (campaign_id, state, reason, actor_user_uuid)
                    values (:campaign_id, :state, 'manual_update', cast(:actor as uuid))
                    """
                ),
                {"campaign_id": int(row["id"]), "state": str(payload["status"]), "actor": self._uuid(actor_uuid)},
            )
        org_uuid = (
            await self.session.execute(text("select uuid from b2b_organizations where id = :id"), {"id": int(row["org_id"])})
        ).scalar_one()
        store_uuid = (
            await self.session.execute(text("select uuid from catalog_stores where id = :id"), {"id": int(row["store_id"])})
        ).scalar_one()
        await self.session.commit()
        return {
            "id": str(row["uuid"]),
            "org_id": str(org_uuid),
            "store_id": str(store_uuid),
            "name": str(row["name"]),
            "status": str(row["status"]),
            "strategy": str(row["strategy"]),
            "daily_budget": self._to_float(row.get("daily_budget")),
            "monthly_budget": self._to_float(row.get("monthly_budget")),
            "bid_default": self._to_float(row.get("bid_default")),
            "bid_cap": self._to_float(row.get("bid_cap")),
            "pacing_mode": str(row.get("pacing_mode") or "even"),
            "starts_at": self._iso(row.get("starts_at")),
            "ends_at": self._iso(row.get("ends_at")),
            "created_at": self._iso(row.get("created_at")),
            "updated_at": self._iso(row.get("updated_at")),
        }

    async def get_analytics_overview(self, *, org_id: int, period_days: int) -> dict[str, Any]:
        since = self._now() - timedelta(days=max(1, int(period_days)))
        summary = (
            await self.session.execute(
                text(
                    """
                    select
                        count(*)::int as total_clicks,
                        count(*) filter (where is_billable = true)::int as billable_clicks,
                        count(distinct session_key)::int as unique_sessions,
                        coalesce(sum(billed_amount), 0)::double precision as spend
                    from b2b_click_events
                    where org_id = :org_id
                      and event_ts >= :since
                    """
                ),
                {"org_id": org_id, "since": since},
            )
        ).mappings().one()
        series = (
            await self.session.execute(
                text(
                    """
                    select
                        date_trunc('day', event_ts) as ts,
                        count(*)::int as clicks,
                        count(*) filter (where is_billable = true)::int as billable_clicks,
                        coalesce(sum(billed_amount), 0)::double precision as spend
                    from b2b_click_events
                    where org_id = :org_id
                      and event_ts >= :since
                    group by date_trunc('day', event_ts)
                    order by ts asc
                    """
                ),
                {"org_id": org_id, "since": since},
            )
        ).mappings().all()
        total_clicks = self._to_int(summary.get("total_clicks"))
        billable_clicks = self._to_int(summary.get("billable_clicks"))
        spend = self._to_float(summary.get("spend"))
        return {
            "summary": {
                "total_clicks": total_clicks,
                "billable_clicks": billable_clicks,
                "unique_sessions": self._to_int(summary.get("unique_sessions")),
                "ctr": round((billable_clicks / total_clicks), 6) if total_clicks > 0 else 0.0,
                "spend": spend,
                "avg_cpc": round((spend / billable_clicks), 6) if billable_clicks > 0 else 0.0,
            },
            "series": [
                {
                    "ts": self._iso(row.get("ts")),
                    "clicks": self._to_int(row.get("clicks")),
                    "billable_clicks": self._to_int(row.get("billable_clicks")),
                    "spend": self._to_float(row.get("spend")),
                }
                for row in series
            ],
        }

    async def get_analytics_offers(self, *, org_id: int, limit: int) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                text(
                    """
                    select
                        o.uuid as offer_id,
                        count(e.id)::int as clicks,
                        count(e.id) filter (where e.is_billable = true)::int as billable_clicks,
                        coalesce(sum(e.billed_amount), 0)::double precision as spend
                    from b2b_click_events e
                    join catalog_offers o on o.id = e.offer_id
                    where e.org_id = :org_id
                    group by o.uuid
                    order by spend desc, clicks desc
                    limit :limit
                    """
                ),
                {"org_id": org_id, "limit": max(1, min(int(limit), 200))},
            )
        ).mappings().all()
        return [
            {
                "offer_id": str(row["offer_id"]),
                "clicks": self._to_int(row.get("clicks")),
                "billable_clicks": self._to_int(row.get("billable_clicks")),
                "spend": self._to_float(row.get("spend")),
            }
            for row in rows
        ]

    async def get_analytics_attribution(self, *, org_id: int, period_days: int) -> list[dict[str, Any]]:
        since = self._now() - timedelta(days=max(1, int(period_days)))
        rows = (
            await self.session.execute(
                text(
                    """
                    select
                        coalesce(source_page, 'unknown') as source_page,
                        coalesce(placement, 'unknown') as placement,
                        count(*)::int as clicks,
                        count(*) filter (where is_billable = true)::int as billable_clicks,
                        coalesce(sum(billed_amount), 0)::double precision as spend
                    from b2b_click_events
                    where org_id = :org_id
                      and event_ts >= :since
                    group by coalesce(source_page, 'unknown'), coalesce(placement, 'unknown')
                    order by spend desc, clicks desc
                    """
                ),
                {"org_id": org_id, "since": since},
            )
        ).mappings().all()
        return [
            {
                "source_page": str(row["source_page"]),
                "placement": str(row["placement"]),
                "clicks": self._to_int(row.get("clicks")),
                "billable_clicks": self._to_int(row.get("billable_clicks")),
                "spend": self._to_float(row.get("spend")),
            }
            for row in rows
        ]

    async def list_billing_plans(self) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                text(
                    """
                    select uuid, code, name, monthly_fee, included_clicks, click_price, currency, limits
                    from b2b_plan_catalog
                    where is_active = true
                    order by monthly_fee asc, id asc
                    """
                )
            )
        ).mappings().all()
        return [
            {
                "id": str(row["uuid"]),
                "code": str(row["code"]),
                "name": str(row["name"]),
                "monthly_fee": self._to_float(row.get("monthly_fee")),
                "included_clicks": self._to_int(row.get("included_clicks")),
                "click_price": self._to_float(row.get("click_price")),
                "currency": str(row.get("currency") or "UZS"),
                "limits": row.get("limits") if isinstance(row.get("limits"), dict) else {},
            }
            for row in rows
        ]

    async def create_subscription(self, *, org_id: int, plan_code: str, user_uuid: str) -> dict[str, Any] | None:
        plan = (
            await self.session.execute(
                text(
                    """
                    select id, uuid, code, monthly_fee, currency
                    from b2b_plan_catalog
                    where is_active = true
                      and lower(code) = lower(:plan_code)
                    limit 1
                    """
                ),
                {"plan_code": plan_code},
            )
        ).mappings().first()
        if not plan:
            return None
        await self.session.execute(
            text(
                """
                update b2b_subscriptions
                set status = 'cancelled', cancelled_at = now(), updated_at = now()
                where org_id = :org_id
                  and status in ('active', 'trial', 'past_due')
                """
            ),
            {"org_id": org_id},
        )
        sub = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_subscriptions (
                        org_id,
                        plan_id,
                        status,
                        starts_at,
                        renews_at,
                        created_by_user_uuid
                    ) values (
                        :org_id,
                        :plan_id,
                        'active',
                        now(),
                        now() + interval '1 month',
                        cast(:user_uuid as uuid)
                    )
                    returning id, uuid, starts_at, renews_at, created_at
                    """
                ),
                {"org_id": org_id, "plan_id": int(plan["id"]), "user_uuid": self._uuid(user_uuid)},
            )
        ).mappings().one()
        await self.session.execute(
            text(
                """
                insert into b2b_wallet_accounts (org_id, currency, balance, credit_limit, status)
                values (:org_id, :currency, 0, 0, 'active')
                on conflict (org_id) do nothing
                """
            ),
            {"org_id": org_id, "currency": str(plan.get("currency") or "UZS")},
        )
        invoice_number = f"INV-{self._now().strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"
        invoice = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_invoices (
                        org_id,
                        subscription_id,
                        invoice_number,
                        status,
                        currency,
                        subtotal,
                        tax_amount,
                        total_amount,
                        paid_amount,
                        period_from,
                        period_to,
                        due_at,
                        issued_at
                    ) values (
                        :org_id,
                        :subscription_id,
                        :invoice_number,
                        'issued',
                        :currency,
                        :subtotal,
                        0,
                        :subtotal,
                        0,
                        current_date,
                        current_date + interval '1 month',
                        now() + interval '7 day',
                        now()
                    )
                    returning id
                    """
                ),
                {
                    "org_id": org_id,
                    "subscription_id": int(sub["id"]),
                    "invoice_number": invoice_number,
                    "currency": str(plan.get("currency") or "UZS"),
                    "subtotal": self._to_float(plan.get("monthly_fee")),
                },
            )
        ).mappings().one()
        await self.session.execute(
            text(
                """
                insert into b2b_invoice_lines (invoice_id, line_type, description, quantity, unit_price, amount, metadata)
                values (
                    :invoice_id,
                    'subscription',
                    :description,
                    1,
                    :unit_price,
                    :amount,
                    cast(:metadata as jsonb)
                )
                """
            ),
            {
                "invoice_id": int(invoice["id"]),
                "description": f"Subscription plan {plan['code']}",
                "unit_price": self._to_float(plan.get("monthly_fee")),
                "amount": self._to_float(plan.get("monthly_fee")),
                "metadata": json.dumps({"plan_code": str(plan["code"])}),
            },
        )
        org_uuid = (
            await self.session.execute(text("select uuid from b2b_organizations where id = :id"), {"id": org_id})
        ).scalar_one()
        await self.session.commit()
        return {
            "id": str(sub["uuid"]),
            "org_id": str(org_uuid),
            "plan_id": str(plan["uuid"]),
            "status": "active",
            "starts_at": self._iso(sub.get("starts_at")),
            "renews_at": self._iso(sub.get("renews_at")),
            "created_at": self._iso(sub.get("created_at")),
        }

    async def list_invoices(self, *, org_id: int, limit: int, offset: int) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                text(
                    """
                    select
                        i.uuid,
                        o.uuid as org_uuid,
                        i.invoice_number,
                        i.status,
                        i.currency,
                        i.total_amount,
                        i.paid_amount,
                        i.due_at,
                        i.issued_at,
                        i.paid_at,
                        i.created_at
                    from b2b_invoices i
                    join b2b_organizations o on o.id = i.org_id
                    where i.org_id = :org_id
                    order by i.created_at desc, i.id desc
                    limit :limit
                    offset :offset
                    """
                ),
                {"org_id": org_id, "limit": max(1, min(int(limit), 200)), "offset": max(0, int(offset))},
            )
        ).mappings().all()
        return [
            {
                "id": str(row["uuid"]),
                "org_id": str(row["org_uuid"]),
                "invoice_number": str(row["invoice_number"]),
                "status": str(row["status"]),
                "currency": str(row["currency"]),
                "total_amount": self._to_float(row.get("total_amount")),
                "paid_amount": self._to_float(row.get("paid_amount")),
                "due_at": self._iso(row.get("due_at")),
                "issued_at": self._iso(row.get("issued_at")),
                "paid_at": self._iso(row.get("paid_at")),
                "created_at": self._iso(row.get("created_at")),
            }
            for row in rows
        ]

    async def pay_invoice(self, *, org_id: int, invoice_id: int, provider: str, amount: float | None) -> dict[str, Any] | None:
        invoice = (
            await self.session.execute(
                text(
                    """
                    select id, uuid, total_amount, paid_amount, currency
                    from b2b_invoices
                    where id = :invoice_id and org_id = :org_id
                    limit 1
                    """
                ),
                {"invoice_id": invoice_id, "org_id": org_id},
            )
        ).mappings().first()
        if not invoice:
            return None
        due = max(self._to_float(invoice.get("total_amount")) - self._to_float(invoice.get("paid_amount")), 0.0)
        payment_amount = due if amount is None else max(0.0, float(amount))
        payment = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_payments (
                        org_id,
                        invoice_id,
                        provider,
                        provider_payment_id,
                        status,
                        amount,
                        currency,
                        metadata,
                        paid_at
                    ) values (
                        :org_id,
                        :invoice_id,
                        :provider,
                        :provider_payment_id,
                        'succeeded',
                        :amount,
                        :currency,
                        cast(:metadata as jsonb),
                        now()
                    )
                    returning uuid, status
                    """
                ),
                {
                    "org_id": org_id,
                    "invoice_id": invoice_id,
                    "provider": provider,
                    "provider_payment_id": f"pay_{secrets.token_hex(6)}",
                    "amount": payment_amount,
                    "currency": str(invoice.get("currency") or "UZS"),
                    "metadata": json.dumps({"mode": "api"}),
                },
            )
        ).mappings().one()
        paid_amount = self._to_float(invoice.get("paid_amount")) + payment_amount
        total = self._to_float(invoice.get("total_amount"))
        status = "paid" if paid_amount + 1e-9 >= total else "partially_paid"
        await self.session.execute(
            text(
                """
                update b2b_invoices
                set
                    paid_amount = :paid_amount,
                    status = cast(:status as varchar(16)),
                    paid_at = case when :is_paid then now() else paid_at end,
                    updated_at = now()
                where id = :invoice_id
                """
            ),
            {"invoice_id": invoice_id, "paid_amount": paid_amount, "status": status, "is_paid": status == "paid"},
        )
        if status == "paid":
            act_number = f"ACT-{self._now().strftime('%Y%m')}-{secrets.token_hex(3).upper()}"
            await self.session.execute(
                text(
                    """
                    insert into b2b_acts (org_id, invoice_id, act_number, status, document_url, issued_at)
                    values (:org_id, :invoice_id, :act_number, 'issued', :document_url, now())
                    on conflict (invoice_id) do nothing
                    """
                ),
                {
                    "org_id": org_id,
                    "invoice_id": invoice_id,
                    "act_number": act_number,
                    "document_url": f"/documents/acts/{act_number}.pdf",
                },
            )
        await self.session.commit()
        return {
            "invoice_id": str(invoice["uuid"]),
            "payment_id": str(payment["uuid"]),
            "status": str(payment["status"]),
            "redirect_url": None,
        }

    async def list_acts(self, *, org_id: int) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                text(
                    """
                    select
                        a.uuid,
                        o.uuid as org_uuid,
                        i.uuid as invoice_uuid,
                        a.act_number,
                        a.status,
                        a.document_url,
                        a.issued_at,
                        a.signed_at,
                        a.created_at
                    from b2b_acts a
                    join b2b_organizations o on o.id = a.org_id
                    join b2b_invoices i on i.id = a.invoice_id
                    where a.org_id = :org_id
                    order by a.created_at desc, a.id desc
                    """
                ),
                {"org_id": org_id},
            )
        ).mappings().all()
        return [
            {
                "id": str(row["uuid"]),
                "org_id": str(row["org_uuid"]),
                "invoice_id": str(row["invoice_uuid"]),
                "act_number": str(row["act_number"]),
                "status": str(row["status"]),
                "document_url": row.get("document_url"),
                "issued_at": self._iso(row.get("issued_at")),
                "signed_at": self._iso(row.get("signed_at")),
                "created_at": self._iso(row.get("created_at")),
            }
            for row in rows
        ]

    async def create_support_ticket(
        self,
        *,
        org_id: int,
        subject: str,
        category: str,
        priority: str,
        body: str,
        user_uuid: str,
    ) -> dict[str, Any]:
        ticket = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_support_tickets (
                        org_id,
                        subject,
                        category,
                        priority,
                        status,
                        created_by_user_uuid
                    ) values (
                        :org_id,
                        :subject,
                        :category,
                        :priority,
                        'open',
                        cast(:user_uuid as uuid)
                    )
                    returning id, uuid, created_at, updated_at
                    """
                ),
                {
                    "org_id": org_id,
                    "subject": subject,
                    "category": category,
                    "priority": priority,
                    "user_uuid": self._uuid(user_uuid),
                },
            )
        ).mappings().one()
        await self.session.execute(
            text(
                """
                insert into b2b_support_ticket_messages (ticket_id, author_user_uuid, author_type, body, attachments)
                values (:ticket_id, cast(:author_user_uuid as uuid), 'merchant', :body, '[]'::jsonb)
                """
            ),
            {"ticket_id": int(ticket["id"]), "author_user_uuid": self._uuid(user_uuid), "body": body},
        )
        org_uuid = (
            await self.session.execute(text("select uuid from b2b_organizations where id = :id"), {"id": org_id})
        ).scalar_one()
        await self.session.commit()
        return {
            "id": str(ticket["uuid"]),
            "org_id": str(org_uuid),
            "subject": subject,
            "category": category,
            "priority": priority,
            "status": "open",
            "created_by_user_id": self._uuid(user_uuid),
            "created_at": self._iso(ticket.get("created_at")),
            "updated_at": self._iso(ticket.get("updated_at")),
        }

    async def list_support_tickets(self, *, org_id: int, status: str | None, limit: int, offset: int) -> list[dict[str, Any]]:
        where = ["t.org_id = :org_id"]
        params: dict[str, Any] = {"org_id": org_id, "limit": max(1, min(int(limit), 200)), "offset": max(0, int(offset))}
        if status:
            where.append("t.status = :status")
            params["status"] = status
        rows = (
            await self.session.execute(
                text(
                    f"""
                    select
                        t.uuid,
                        o.uuid as org_uuid,
                        t.subject,
                        t.category,
                        t.priority,
                        t.status,
                        t.created_by_user_uuid,
                        t.created_at,
                        t.updated_at
                    from b2b_support_tickets t
                    join b2b_organizations o on o.id = t.org_id
                    where {" and ".join(where)}
                    order by t.updated_at desc, t.id desc
                    limit :limit
                    offset :offset
                    """
                ),
                params,
            )
        ).mappings().all()
        return [
            {
                "id": str(row["uuid"]),
                "org_id": str(row["org_uuid"]),
                "subject": str(row["subject"]),
                "category": str(row["category"]),
                "priority": str(row["priority"]),
                "status": str(row["status"]),
                "created_by_user_id": str(row["created_by_user_uuid"]),
                "created_at": self._iso(row.get("created_at")),
                "updated_at": self._iso(row.get("updated_at")),
            }
            for row in rows
        ]

    def build_click_token(self, *, click_event_uuid: str, offer_uuid: str, expires_at: datetime) -> str:
        payload = {"v": 1, "click_id": click_event_uuid, "offer_id": offer_uuid, "exp": int(expires_at.timestamp())}
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        signature = hmac.new(self.cursor_secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
        wrapped = {"d": payload, "s": signature}
        return base64.urlsafe_b64encode(json.dumps(wrapped, separators=(",", ":")).encode("utf-8")).decode("utf-8").rstrip("=")

    async def resolve_offer_destination(self, *, offer_uuid: str) -> dict[str, Any] | None:
        row = (
            await self.session.execute(
                text(
                    """
                    select
                        o.id,
                        o.uuid,
                        o.store_id,
                        coalesce(o.offer_url, sp.external_url) as destination_url
                    from catalog_offers o
                    join catalog_store_products sp on sp.id = o.store_product_id
                    where o.uuid = cast(:offer_uuid as uuid)
                    limit 1
                    """
                ),
                {"offer_uuid": self._uuid(offer_uuid)},
            )
        ).mappings().first()
        return dict(row) if row else None

    async def resolve_org_for_store(self, *, store_id: int) -> int | None:
        value = (
            await self.session.execute(
                text(
                    """
                    select org_id
                    from b2b_org_store_links
                    where store_id = :store_id
                      and status in ('active', 'pending')
                    order by case when status = 'active' then 0 else 1 end, id asc
                    limit 1
                    """
                ),
                {"store_id": store_id},
            )
        ).scalar_one_or_none()
        return int(value) if value is not None else None

    async def resolve_active_campaign_for_store(self, *, org_id: int | None, store_id: int) -> dict[str, Any] | None:
        if org_id is None:
            return None
        row = (
            await self.session.execute(
                text(
                    """
                    select id, uuid, bid_default
                    from b2b_campaigns
                    where org_id = :org_id
                      and store_id = :store_id
                      and status = 'active'
                      and (starts_at is null or starts_at <= now())
                      and (ends_at is null or ends_at >= now())
                    order by updated_at desc, id desc
                    limit 1
                    """
                ),
                {"org_id": org_id, "store_id": store_id},
            )
        ).mappings().first()
        return dict(row) if row else None

    async def resolve_plan_click_price(self, *, org_id: int | None) -> float:
        if org_id is None:
            return 0.0
        value = (
            await self.session.execute(
                text(
                    """
                    select p.click_price
                    from b2b_subscriptions s
                    join b2b_plan_catalog p on p.id = s.plan_id
                    where s.org_id = :org_id
                      and s.status in ('active', 'trial', 'past_due')
                    order by s.updated_at desc, s.id desc
                    limit 1
                    """
                ),
                {"org_id": org_id},
            )
        ).scalar_one_or_none()
        return self._to_float(value)

    async def create_click_event(
        self,
        *,
        offer_id: int,
        offer_uuid: str,
        store_id: int,
        destination_url: str,
        source_page: str,
        placement: str,
        session_key: str,
        ip_hash: str,
        user_agent_hash: str,
        referrer: str,
        org_id: int | None,
        campaign: dict[str, Any] | None,
        dedupe_key: str,
        dedupe_window_seconds: int,
        default_click_price: float,
    ) -> dict[str, Any]:
        dedupe_exists = (
            await self.session.execute(
                text(
                    """
                    select id
                    from b2b_click_dedupe
                    where dedupe_key = :dedupe_key
                      and expires_at > now()
                    limit 1
                    """
                ),
                {"dedupe_key": dedupe_key},
            )
        ).first() is not None
        campaign_id = int(campaign["id"]) if campaign else None
        amount = self._to_float(campaign.get("bid_default")) if campaign else 0.0
        if amount <= 0:
            amount = max(0.0, default_click_price)
        is_billable = bool((not dedupe_exists) and org_id is not None and amount > 0)
        status = "duplicate" if dedupe_exists else "valid"
        click = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_click_events (
                        event_ts,
                        offer_id,
                        offer_uuid,
                        org_id,
                        campaign_id,
                        store_id,
                        source_page,
                        placement,
                        session_key,
                        ip_hash,
                        user_agent_hash,
                        referrer,
                        destination_url,
                        attribution_token,
                        is_billable,
                        billed_amount,
                        status
                    ) values (
                        now(),
                        :offer_id,
                        cast(:offer_uuid as uuid),
                        :org_id,
                        :campaign_id,
                        :store_id,
                        :source_page,
                        :placement,
                        :session_key,
                        :ip_hash,
                        :user_agent_hash,
                        :referrer,
                        :destination_url,
                        '',
                        :is_billable,
                        :billed_amount,
                        :status
                    )
                    returning id, uuid
                    """
                ),
                {
                    "offer_id": offer_id,
                    "offer_uuid": self._uuid(offer_uuid),
                    "org_id": org_id,
                    "campaign_id": campaign_id,
                    "store_id": store_id,
                    "source_page": source_page[:64],
                    "placement": placement[:64],
                    "session_key": session_key[:128],
                    "ip_hash": ip_hash[:128],
                    "user_agent_hash": user_agent_hash[:128],
                    "referrer": referrer[:2000],
                    "destination_url": destination_url,
                    "is_billable": is_billable,
                    "billed_amount": amount if is_billable else 0.0,
                    "status": status,
                },
            )
        ).mappings().one()
        if not dedupe_exists:
            await self.session.execute(
                text(
                    """
                    insert into b2b_click_dedupe (dedupe_key, click_event_uuid, expires_at)
                    values (:dedupe_key, cast(:click_event_uuid as uuid), now() + make_interval(secs => :window_seconds))
                    on conflict (dedupe_key) do update
                    set click_event_uuid = excluded.click_event_uuid,
                        expires_at = excluded.expires_at,
                        updated_at = now()
                    """
                ),
                {
                    "dedupe_key": dedupe_key,
                    "click_event_uuid": str(click["uuid"]),
                    "window_seconds": max(10, int(dedupe_window_seconds)),
                },
            )
        if is_billable and org_id is not None:
            charge = (
                await self.session.execute(
                    text(
                        """
                        insert into b2b_click_charges (click_event_id, org_id, campaign_id, amount, currency, status)
                        values (:click_event_id, :org_id, :campaign_id, :amount, 'UZS', 'posted')
                        returning id
                        """
                    ),
                    {
                        "click_event_id": int(click["id"]),
                        "org_id": org_id,
                        "campaign_id": campaign_id,
                        "amount": amount,
                    },
                )
            ).mappings().one()
            await self.session.execute(
                text(
                    """
                    insert into b2b_wallet_accounts (org_id, currency, balance, credit_limit, status)
                    values (:org_id, 'UZS', 0, 0, 'active')
                    on conflict (org_id) do nothing
                    """
                ),
                {"org_id": org_id},
            )
            wallet_id = (
                await self.session.execute(text("select id from b2b_wallet_accounts where org_id = :org_id"), {"org_id": org_id})
            ).scalar_one()
            await self.session.execute(
                text(
                    """
                    insert into b2b_wallet_transactions (
                        wallet_account_id,
                        org_id,
                        kind,
                        amount,
                        currency,
                        reference_type,
                        reference_id,
                        note
                    ) values (
                        :wallet_account_id,
                        :org_id,
                        'charge',
                        :amount,
                        'UZS',
                        'click_charge',
                        :reference_id,
                        'CPC charge'
                    )
                    """
                ),
                {
                    "wallet_account_id": int(wallet_id),
                    "org_id": org_id,
                    "amount": -abs(float(amount)),
                    "reference_id": str(charge["id"]),
                },
            )
            await self.session.execute(
                text("update b2b_wallet_accounts set balance = coalesce(balance, 0) - :amount, updated_at = now() where id = :id"),
                {"id": int(wallet_id), "amount": abs(float(amount))},
            )
        await self.session.commit()
        return {
            "click_event_id": int(click["id"]),
            "click_event_uuid": str(click["uuid"]),
            "billable": is_billable,
            "status": status,
            "destination_url": destination_url,
        }

    async def attach_click_attribution_token(self, *, click_event_id: int, attribution_token: str) -> None:
        await self.session.execute(
            text(
                """
                update b2b_click_events
                set attribution_token = :attribution_token,
                    updated_at = now()
                where id = :click_event_id
                """
            ),
            {"click_event_id": click_event_id, "attribution_token": attribution_token},
        )
        await self.session.commit()

    async def list_admin_partner_leads(
        self,
        *,
        status: str | None,
        q: str | None,
        country_code: str | None,
        created_from: datetime | None,
        created_to: datetime | None,
        duplicates_only: bool,
        limit: int,
        offset: int,
    ) -> dict[str, Any]:
        duplicate_email_exists_sql = """
            exists (
                select 1
                from b2b_partner_leads dup_email
                where dup_email.id <> pl.id
                  and lower(trim(coalesce(dup_email.email, ''))) = lower(trim(coalesce(pl.email, '')))
                  and trim(coalesce(pl.email, '')) <> ''
            )
        """
        duplicate_company_exists_sql = """
            exists (
                select 1
                from b2b_partner_leads dup_company
                where dup_company.id <> pl.id
                  and lower(trim(coalesce(dup_company.company_name, ''))) = lower(trim(coalesce(pl.company_name, '')))
                  and trim(coalesce(pl.company_name, '')) <> ''
            )
        """
        where = ["1=1"]
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 200)), "offset": max(0, int(offset))}
        if status:
            where.append("pl.status = :status")
            params["status"] = status
        normalized_q = str(q or "").strip()
        if normalized_q:
            where.append("(pl.company_name ilike :q or pl.email ilike :q or pl.contact_name ilike :q)")
            params["q"] = f"%{normalized_q}%"
        normalized_country = str(country_code or "").strip().upper()
        if normalized_country:
            where.append("upper(pl.country_code) = :country_code")
            params["country_code"] = normalized_country
        if created_from is not None:
            where.append("pl.created_at >= :created_from")
            params["created_from"] = created_from
        if created_to is not None:
            where.append("pl.created_at < :created_to")
            params["created_to"] = created_to
        if duplicates_only:
            where.append(f"({duplicate_email_exists_sql} or {duplicate_company_exists_sql})")
        where_sql = " and ".join(where)
        total = int(
            (
                await self.session.execute(
                    text(f"select count(*)::int from b2b_partner_leads pl where {where_sql}"),
                    params,
                )
            ).scalar_one()
            or 0
        )
        rows = (
            await self.session.execute(
                text(
                    f"""
                    select
                        pl.uuid,
                        pl.status,
                        pl.company_name,
                        pl.legal_name,
                        pl.brand_name,
                        pl.tax_id,
                        pl.website_url,
                        pl.contact_name,
                        pl.contact_role,
                        pl.email,
                        pl.phone,
                        pl.telegram,
                        pl.country_code,
                        pl.city,
                        pl.categories,
                        pl.monthly_orders,
                        pl.avg_order_value,
                        pl.feed_url,
                        pl.logistics_model,
                        pl.warehouses_count,
                        pl.marketplaces,
                        pl.returns_policy,
                        pl.goals,
                        pl.notes,
                        pl.review_note,
                        pl.reviewed_at,
                        {duplicate_email_exists_sql} as is_duplicate_email,
                        {duplicate_company_exists_sql} as is_duplicate_company,
                        pl.provisioning_status,
                        pl.provisioned_user_uuid,
                        pl.provisioned_org_uuid,
                        pl.onboarding_application_uuid,
                        pl.provisioned_at,
                        pl.provisioning_error,
                        pl.welcome_email_sent_at,
                        pl.created_at,
                        pl.updated_at
                    from b2b_partner_leads pl
                    where {where_sql}
                    order by pl.updated_at desc, pl.id desc
                    limit :limit
                    offset :offset
                    """
                ),
                params,
            )
        ).mappings().all()
        return {
            "items": [
                {
                    "id": str(row["uuid"]),
                    "status": str(row["status"]),
                    "company_name": str(row["company_name"]),
                    "legal_name": row.get("legal_name"),
                    "brand_name": row.get("brand_name"),
                    "tax_id": row.get("tax_id"),
                    "website_url": row.get("website_url"),
                    "contact_name": str(row["contact_name"]),
                    "contact_role": row.get("contact_role"),
                    "email": str(row["email"]),
                    "phone": str(row["phone"]),
                    "telegram": row.get("telegram"),
                    "country_code": str(row.get("country_code") or "UZ"),
                    "city": row.get("city"),
                    "categories": self._to_str_list(row.get("categories"), max_items=40, max_len=80),
                    "monthly_orders": self._to_int(row.get("monthly_orders"), default=0) or None,
                    "avg_order_value": self._to_float(row.get("avg_order_value"), default=0.0) or None,
                    "feed_url": row.get("feed_url"),
                    "logistics_model": str(row.get("logistics_model") or "own_warehouse"),
                    "warehouses_count": self._to_int(row.get("warehouses_count"), default=0) or None,
                    "marketplaces": self._to_str_list(row.get("marketplaces"), max_items=40, max_len=80),
                    "returns_policy": row.get("returns_policy"),
                    "goals": row.get("goals"),
                    "notes": row.get("notes"),
                    "review_note": row.get("review_note"),
                    "reviewed_at": self._iso(row.get("reviewed_at")),
                    "is_duplicate_email": bool(row.get("is_duplicate_email")),
                    "is_duplicate_company": bool(row.get("is_duplicate_company")),
                    "provisioning_status": str(row.get("provisioning_status") or "pending"),
                    "provisioned_user_id": str(row["provisioned_user_uuid"]) if row.get("provisioned_user_uuid") else None,
                    "provisioned_org_id": str(row["provisioned_org_uuid"]) if row.get("provisioned_org_uuid") else None,
                    "onboarding_application_id": str(row["onboarding_application_uuid"]) if row.get("onboarding_application_uuid") else None,
                    "provisioned_at": self._iso(row.get("provisioned_at")),
                    "provisioning_error": row.get("provisioning_error"),
                    "welcome_email_sent_at": self._iso(row.get("welcome_email_sent_at")),
                    "created_at": self._iso(row.get("created_at")),
                    "updated_at": self._iso(row.get("updated_at")),
                }
                for row in rows
            ],
            "total": total,
            "limit": params["limit"],
            "offset": params["offset"],
        }

    async def patch_admin_partner_lead(
        self,
        *,
        lead_uuid: str,
        status: str,
        review_note: str | None,
        reviewer_uuid: str,
    ) -> dict[str, Any] | None:
        current = (
            await self.session.execute(
                text(
                    """
                    select status
                    from b2b_partner_leads
                    where uuid = cast(:lead_uuid as uuid)
                    for update
                    """
                ),
                {"lead_uuid": self._uuid(lead_uuid)},
            )
        ).mappings().first()
        if not current:
            await self.session.rollback()
            return None
        status_before = str(current.get("status") or "").strip().lower()
        row = (
            await self.session.execute(
                text(
                    """
                    update b2b_partner_leads
                    set
                        status = :status,
                        review_note = :review_note,
                        provisioning_error = case when :keep_provisioning_error then provisioning_error else null end,
                        reviewed_by_user_uuid = cast(:reviewer_uuid as uuid),
                        reviewed_at = now(),
                        updated_at = now()
                    where uuid = cast(:lead_uuid as uuid)
                    returning
                        uuid,
                        status,
                        company_name,
                        legal_name,
                        brand_name,
                        tax_id,
                        website_url,
                        contact_name,
                        contact_role,
                        email,
                        phone,
                        telegram,
                        country_code,
                        city,
                        categories,
                        monthly_orders,
                        avg_order_value,
                        feed_url,
                        logistics_model,
                        warehouses_count,
                        marketplaces,
                        returns_policy,
                        goals,
                        notes,
                        review_note,
                        reviewed_at,
                        provisioning_status,
                        provisioned_user_uuid,
                        provisioned_org_uuid,
                        onboarding_application_uuid,
                        provisioned_at,
                        provisioning_error,
                        welcome_email_sent_at,
                        created_at,
                        updated_at
                    """
                ),
                {
                    "lead_uuid": self._uuid(lead_uuid),
                    "status": status,
                    "review_note": review_note,
                    "keep_provisioning_error": str(status or "").strip().lower() == "approved",
                    "reviewer_uuid": self._uuid(reviewer_uuid),
                },
            )
        ).mappings().first()
        if not row:
            await self.session.rollback()
            return None
        await self.session.commit()
        status_after = str(row["status"]).strip().lower()
        return {
            "id": str(row["uuid"]),
            "status": str(row["status"]),
            "status_before": status_before,
            "status_changed": status_before != status_after,
            "company_name": str(row["company_name"]),
            "legal_name": row.get("legal_name"),
            "brand_name": row.get("brand_name"),
            "tax_id": row.get("tax_id"),
            "website_url": row.get("website_url"),
            "contact_name": str(row["contact_name"]),
            "contact_role": row.get("contact_role"),
            "email": str(row["email"]),
            "phone": str(row["phone"]),
            "telegram": row.get("telegram"),
            "country_code": str(row.get("country_code") or "UZ"),
            "city": row.get("city"),
            "categories": self._to_str_list(row.get("categories"), max_items=40, max_len=80),
            "monthly_orders": self._to_int(row.get("monthly_orders"), default=0) or None,
            "avg_order_value": self._to_float(row.get("avg_order_value"), default=0.0) or None,
            "feed_url": row.get("feed_url"),
            "logistics_model": str(row.get("logistics_model") or "own_warehouse"),
            "warehouses_count": self._to_int(row.get("warehouses_count"), default=0) or None,
            "marketplaces": self._to_str_list(row.get("marketplaces"), max_items=40, max_len=80),
            "returns_policy": row.get("returns_policy"),
            "goals": row.get("goals"),
            "notes": row.get("notes"),
            "review_note": row.get("review_note"),
            "reviewed_at": self._iso(row.get("reviewed_at")),
            "provisioning_status": str(row.get("provisioning_status") or "pending"),
            "provisioned_user_id": str(row["provisioned_user_uuid"]) if row.get("provisioned_user_uuid") else None,
            "provisioned_org_id": str(row["provisioned_org_uuid"]) if row.get("provisioned_org_uuid") else None,
            "onboarding_application_id": str(row["onboarding_application_uuid"]) if row.get("onboarding_application_uuid") else None,
            "provisioned_at": self._iso(row.get("provisioned_at")),
            "provisioning_error": row.get("provisioning_error"),
            "welcome_email_sent_at": self._iso(row.get("welcome_email_sent_at")),
            "created_at": self._iso(row.get("created_at")),
            "updated_at": self._iso(row.get("updated_at")),
        }

    async def get_partner_lead_status(self, *, lead_uuid: str, tracking_token: str) -> dict[str, Any] | None:
        row = (
            await self.session.execute(
                text(
                    """
                    select
                        uuid,
                        status,
                        company_name,
                        email,
                        review_note,
                        reviewed_at,
                        provisioning_status,
                        provisioned_user_uuid,
                        provisioned_org_uuid,
                        onboarding_application_uuid,
                        provisioned_at,
                        provisioning_error,
                        welcome_email_sent_at,
                        tracking_token_hash,
                        created_at,
                        updated_at
                    from b2b_partner_leads
                    where uuid = cast(:lead_uuid as uuid)
                    limit 1
                    """
                ),
                {"lead_uuid": self._uuid(lead_uuid)},
            )
        ).mappings().first()
        if not row:
            return None
        token_hash = str(row.get("tracking_token_hash") or "")
        if not token_hash:
            return None
        if not hmac.compare_digest(token_hash, self._hash_tracking_token(tracking_token)):
            return None
        return {
            "id": str(row["uuid"]),
            "status": str(row["status"]),
            "company_name": str(row["company_name"]),
            "email": str(row["email"]),
            "review_note": row.get("review_note"),
            "reviewed_at": self._iso(row.get("reviewed_at")),
            "provisioning_status": str(row.get("provisioning_status") or "pending"),
            "provisioned_user_id": str(row["provisioned_user_uuid"]) if row.get("provisioned_user_uuid") else None,
            "provisioned_org_id": str(row["provisioned_org_uuid"]) if row.get("provisioned_org_uuid") else None,
            "onboarding_application_id": str(row["onboarding_application_uuid"]) if row.get("onboarding_application_uuid") else None,
            "provisioned_at": self._iso(row.get("provisioned_at")),
            "provisioning_error": row.get("provisioning_error"),
            "welcome_email_sent_at": self._iso(row.get("welcome_email_sent_at")),
            "created_at": self._iso(row.get("created_at")),
            "updated_at": self._iso(row.get("updated_at")),
        }

    async def mark_partner_lead_welcome_email_sent(self, *, lead_uuid: str) -> None:
        await self.session.execute(
            text(
                """
                update b2b_partner_leads
                set welcome_email_sent_at = now(),
                    updated_at = now()
                where uuid = cast(:lead_uuid as uuid)
                """
            ),
            {"lead_uuid": self._uuid(lead_uuid)},
        )
        await self.session.commit()

    async def mark_partner_lead_provisioning_failed(self, *, lead_uuid: str, error_message: str) -> dict[str, Any] | None:
        row = (
            await self.session.execute(
                text(
                    """
                    update b2b_partner_leads
                    set provisioning_status = 'failed',
                        provisioning_error = :provisioning_error,
                        updated_at = now()
                    where uuid = cast(:lead_uuid as uuid)
                    returning
                        uuid,
                        status,
                        company_name,
                        legal_name,
                        brand_name,
                        tax_id,
                        website_url,
                        contact_name,
                        contact_role,
                        email,
                        phone,
                        telegram,
                        country_code,
                        city,
                        categories,
                        monthly_orders,
                        avg_order_value,
                        feed_url,
                        logistics_model,
                        warehouses_count,
                        marketplaces,
                        returns_policy,
                        goals,
                        notes,
                        review_note,
                        reviewed_at,
                        provisioning_status,
                        provisioned_user_uuid,
                        provisioned_org_uuid,
                        onboarding_application_uuid,
                        provisioned_at,
                        provisioning_error,
                        welcome_email_sent_at,
                        created_at,
                        updated_at
                    """
                ),
                {
                    "lead_uuid": self._uuid(lead_uuid),
                    "provisioning_error": str(error_message or "").strip()[:2000] or "provisioning failed",
                },
            )
        ).mappings().first()
        if not row:
            await self.session.rollback()
            return None
        await self.session.commit()
        return {
            "id": str(row["uuid"]),
            "status": str(row["status"]),
            "company_name": str(row["company_name"]),
            "legal_name": row.get("legal_name"),
            "brand_name": row.get("brand_name"),
            "tax_id": row.get("tax_id"),
            "website_url": row.get("website_url"),
            "contact_name": str(row["contact_name"]),
            "contact_role": row.get("contact_role"),
            "email": str(row["email"]),
            "phone": str(row["phone"]),
            "telegram": row.get("telegram"),
            "country_code": str(row.get("country_code") or "UZ"),
            "city": row.get("city"),
            "categories": self._to_str_list(row.get("categories"), max_items=40, max_len=80),
            "monthly_orders": self._to_int(row.get("monthly_orders"), default=0) or None,
            "avg_order_value": self._to_float(row.get("avg_order_value"), default=0.0) or None,
            "feed_url": row.get("feed_url"),
            "logistics_model": str(row.get("logistics_model") or "own_warehouse"),
            "warehouses_count": self._to_int(row.get("warehouses_count"), default=0) or None,
            "marketplaces": self._to_str_list(row.get("marketplaces"), max_items=40, max_len=80),
            "returns_policy": row.get("returns_policy"),
            "goals": row.get("goals"),
            "notes": row.get("notes"),
            "review_note": row.get("review_note"),
            "reviewed_at": self._iso(row.get("reviewed_at")),
            "provisioning_status": str(row.get("provisioning_status") or "failed"),
            "provisioned_user_id": str(row["provisioned_user_uuid"]) if row.get("provisioned_user_uuid") else None,
            "provisioned_org_id": str(row["provisioned_org_uuid"]) if row.get("provisioned_org_uuid") else None,
            "onboarding_application_id": str(row["onboarding_application_uuid"]) if row.get("onboarding_application_uuid") else None,
            "provisioned_at": self._iso(row.get("provisioned_at")),
            "provisioning_error": row.get("provisioning_error"),
            "welcome_email_sent_at": self._iso(row.get("welcome_email_sent_at")),
            "created_at": self._iso(row.get("created_at")),
            "updated_at": self._iso(row.get("updated_at")),
        }

    async def provision_partner_lead_approval(
        self,
        *,
        lead_uuid: str,
        owner_user_uuid: str,
        reviewer_uuid: str,
    ) -> dict[str, Any] | None:
        lead = (
            await self.session.execute(
                text(
                    """
                    select
                        id,
                        uuid,
                        status,
                        company_name,
                        legal_name,
                        tax_id,
                        website_url,
                        contact_name,
                        email,
                        phone,
                        country_code,
                        city,
                        logistics_model,
                        monthly_orders,
                        avg_order_value,
                        provisioned_org_uuid,
                        onboarding_application_uuid
                    from b2b_partner_leads
                    where uuid = cast(:lead_uuid as uuid)
                    for update
                    """
                ),
                {"lead_uuid": self._uuid(lead_uuid)},
            )
        ).mappings().first()
        if not lead:
            await self.session.rollback()
            return None
        if str(lead.get("status") or "").lower() != "approved":
            await self.session.rollback()
            return None

        owner_uuid = self._uuid(owner_user_uuid)
        reviewer = self._uuid(reviewer_uuid)
        org_id: int | None = None
        org_uuid: str | None = None

        existing_org_uuid = lead.get("provisioned_org_uuid")
        if existing_org_uuid:
            org = (
                await self.session.execute(
                    text("select id, uuid from b2b_organizations where uuid = cast(:org_uuid as uuid)"),
                    {"org_uuid": str(existing_org_uuid)},
                )
            ).mappings().first()
            if org:
                org_id = int(org["id"])
                org_uuid = str(org["uuid"])

        if org_id is None:
            slug_suffix = str(lead["uuid"])[:8]
            base_slug = self._slugify(f"{lead.get('company_name')}-{slug_suffix}", max_len=110)
            final_slug = f"{base_slug}-{slug_suffix}".strip("-")[:120]
            org = (
                await self.session.execute(
                    text(
                        """
                        insert into b2b_organizations (
                            slug,
                            name,
                            legal_name,
                            tax_id,
                            website_url,
                            status,
                            country_code,
                            default_currency,
                            created_by_user_uuid
                        ) values (
                            :slug,
                            :name,
                            :legal_name,
                            :tax_id,
                            :website_url,
                            'active',
                            :country_code,
                            :default_currency,
                            cast(:created_by_user_uuid as uuid)
                        )
                        returning id, uuid, slug
                        """
                    ),
                    {
                        "slug": final_slug,
                        "name": str(lead.get("company_name") or "Seller Organization").strip()[:160],
                        "legal_name": str(lead.get("legal_name") or "").strip() or None,
                        "tax_id": str(lead.get("tax_id") or "").strip() or None,
                        "website_url": str(lead.get("website_url") or "").strip() or None,
                        "country_code": (str(lead.get("country_code") or "UZ").strip().upper() or "UZ")[:2],
                        "default_currency": self._country_currency(str(lead.get("country_code") or "UZ")),
                        "created_by_user_uuid": owner_uuid,
                    },
                )
            ).mappings().one()
            org_id = int(org["id"])
            org_uuid = str(org["uuid"])

        existing_member_id = (
            await self.session.execute(
                text(
                    """
                    select id
                    from b2b_org_memberships
                    where org_id = :org_id
                      and user_uuid = cast(:user_uuid as uuid)
                    limit 1
                    """
                ),
                {"org_id": org_id, "user_uuid": owner_uuid},
            )
        ).scalar_one_or_none()
        if existing_member_id is None:
            await self.session.execute(
                text(
                    """
                    insert into b2b_org_memberships (org_id, user_uuid, role, status, invited_by_user_uuid)
                    values (:org_id, cast(:user_uuid as uuid), 'owner', 'active', cast(:invited_by_user_uuid as uuid))
                    """
                ),
                {"org_id": org_id, "user_uuid": owner_uuid, "invited_by_user_uuid": reviewer},
            )
        else:
            await self.session.execute(
                text(
                    """
                    update b2b_org_memberships
                    set role = 'owner',
                        status = 'active',
                        updated_at = now()
                    where id = :id
                    """
                ),
                {"id": int(existing_member_id)},
            )

        onboarding_uuid = lead.get("onboarding_application_uuid")
        if onboarding_uuid:
            onboarding_exists = (
                await self.session.execute(
                    text(
                        """
                        select uuid
                        from b2b_onboarding_applications
                        where uuid = cast(:uuid as uuid)
                        limit 1
                        """
                    ),
                    {"uuid": str(onboarding_uuid)},
                )
            ).scalar_one_or_none()
            if onboarding_exists is None:
                onboarding_uuid = None

        if onboarding_uuid is None:
            existing_onboarding = (
                await self.session.execute(
                    text(
                        """
                        select uuid
                        from b2b_onboarding_applications
                        where org_id = :org_id
                        order by updated_at desc, id desc
                        limit 1
                        """
                    ),
                    {"org_id": org_id},
                )
            ).scalar_one_or_none()
            if existing_onboarding is None:
                onboarding = (
                    await self.session.execute(
                        text(
                            """
                            insert into b2b_onboarding_applications (
                                org_id,
                                status,
                                company_name,
                                legal_address,
                                billing_email,
                                contact_name,
                                contact_phone,
                                website_domain,
                                tax_id,
                                payout_details,
                                created_by_user_uuid,
                                updated_by_user_uuid
                            ) values (
                                :org_id,
                                'draft',
                                :company_name,
                                :legal_address,
                                :billing_email,
                                :contact_name,
                                :contact_phone,
                                :website_domain,
                                :tax_id,
                                cast(:payout_details as jsonb),
                                cast(:created_by_user_uuid as uuid),
                                cast(:updated_by_user_uuid as uuid)
                            )
                            returning uuid
                            """
                        ),
                        {
                            "org_id": org_id,
                            "company_name": str(lead.get("company_name") or "Seller Organization").strip()[:255],
                            "legal_address": str(lead.get("city") or "").strip() or None,
                            "billing_email": str(lead.get("email") or "").strip().lower(),
                            "contact_name": str(lead.get("contact_name") or "").strip()[:160],
                            "contact_phone": str(lead.get("phone") or "").strip()[:64] or None,
                            "website_domain": self._domain_from_url(str(lead.get("website_url") or "")),
                            "tax_id": str(lead.get("tax_id") or "").strip() or None,
                            "payout_details": json.dumps(
                                {
                                    "seeded_from_partner_lead": str(lead["uuid"]),
                                    "logistics_model": str(lead.get("logistics_model") or "own_warehouse"),
                                    "monthly_orders": self._to_int(lead.get("monthly_orders"), default=0) or None,
                                    "avg_order_value": self._to_float(lead.get("avg_order_value"), default=0.0) or None,
                                }
                            ),
                            "created_by_user_uuid": owner_uuid,
                            "updated_by_user_uuid": owner_uuid,
                        },
                    )
                ).mappings().one()
                onboarding_uuid = str(onboarding["uuid"])
            else:
                onboarding_uuid = str(existing_onboarding)

        await self.session.execute(
            text(
                """
                insert into b2b_org_audit_events (org_id, actor_user_uuid, action, entity_type, entity_id, payload)
                values (
                    :org_id,
                    cast(:actor_user_uuid as uuid),
                    'partner_lead.provisioned',
                    'partner_lead',
                    cast(:entity_id as text),
                    cast(:payload as jsonb)
                )
                """
            ),
            {
                "org_id": org_id,
                "actor_user_uuid": reviewer,
                "entity_id": str(lead["uuid"]),
                "payload": json.dumps(
                    {
                        "owner_user_uuid": owner_uuid,
                        "onboarding_application_uuid": onboarding_uuid,
                    }
                ),
            },
        )

        updated = (
            await self.session.execute(
                text(
                    """
                    update b2b_partner_leads
                    set
                        provisioning_status = 'ready',
                        provisioned_user_uuid = cast(:owner_user_uuid as uuid),
                        provisioned_org_uuid = cast(:org_uuid as uuid),
                        onboarding_application_uuid = cast(:onboarding_application_uuid as uuid),
                        provisioned_at = now(),
                        provisioning_error = null,
                        updated_at = now()
                    where id = :id
                    returning
                        uuid,
                        status,
                        company_name,
                        legal_name,
                        brand_name,
                        tax_id,
                        website_url,
                        contact_name,
                        contact_role,
                        email,
                        phone,
                        telegram,
                        country_code,
                        city,
                        categories,
                        monthly_orders,
                        avg_order_value,
                        feed_url,
                        logistics_model,
                        warehouses_count,
                        marketplaces,
                        returns_policy,
                        goals,
                        notes,
                        review_note,
                        reviewed_at,
                        provisioning_status,
                        provisioned_user_uuid,
                        provisioned_org_uuid,
                        onboarding_application_uuid,
                        provisioned_at,
                        provisioning_error,
                        welcome_email_sent_at,
                        created_at,
                        updated_at
                    """
                ),
                {
                    "id": int(lead["id"]),
                    "owner_user_uuid": owner_uuid,
                    "org_uuid": org_uuid,
                    "onboarding_application_uuid": onboarding_uuid,
                },
            )
        ).mappings().one()
        await self.session.commit()
        return {
            "id": str(updated["uuid"]),
            "status": str(updated["status"]),
            "company_name": str(updated["company_name"]),
            "legal_name": updated.get("legal_name"),
            "brand_name": updated.get("brand_name"),
            "tax_id": updated.get("tax_id"),
            "website_url": updated.get("website_url"),
            "contact_name": str(updated["contact_name"]),
            "contact_role": updated.get("contact_role"),
            "email": str(updated["email"]),
            "phone": str(updated["phone"]),
            "telegram": updated.get("telegram"),
            "country_code": str(updated.get("country_code") or "UZ"),
            "city": updated.get("city"),
            "categories": self._to_str_list(updated.get("categories"), max_items=40, max_len=80),
            "monthly_orders": self._to_int(updated.get("monthly_orders"), default=0) or None,
            "avg_order_value": self._to_float(updated.get("avg_order_value"), default=0.0) or None,
            "feed_url": updated.get("feed_url"),
            "logistics_model": str(updated.get("logistics_model") or "own_warehouse"),
            "warehouses_count": self._to_int(updated.get("warehouses_count"), default=0) or None,
            "marketplaces": self._to_str_list(updated.get("marketplaces"), max_items=40, max_len=80),
            "returns_policy": updated.get("returns_policy"),
            "goals": updated.get("goals"),
            "notes": updated.get("notes"),
            "review_note": updated.get("review_note"),
            "reviewed_at": self._iso(updated.get("reviewed_at")),
            "provisioning_status": str(updated.get("provisioning_status") or "ready"),
            "provisioned_user_id": str(updated["provisioned_user_uuid"]) if updated.get("provisioned_user_uuid") else None,
            "provisioned_org_id": str(updated["provisioned_org_uuid"]) if updated.get("provisioned_org_uuid") else None,
            "onboarding_application_id": str(updated["onboarding_application_uuid"]) if updated.get("onboarding_application_uuid") else None,
            "provisioned_at": self._iso(updated.get("provisioned_at")),
            "provisioning_error": updated.get("provisioning_error"),
            "welcome_email_sent_at": self._iso(updated.get("welcome_email_sent_at")),
            "created_at": self._iso(updated.get("created_at")),
            "updated_at": self._iso(updated.get("updated_at")),
        }

    async def list_admin_onboarding_applications(self, *, status: str | None, limit: int, offset: int) -> dict[str, Any]:
        where = ["1=1"]
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 200)), "offset": max(0, int(offset))}
        if status:
            where.append("oa.status = :status")
            params["status"] = status
        where_sql = " and ".join(where)
        total = int(
            (
                await self.session.execute(
                    text(f"select count(*)::int from b2b_onboarding_applications oa where {where_sql}"),
                    params,
                )
            ).scalar_one()
            or 0
        )
        rows = (
            await self.session.execute(
                text(
                    f"""
                    select
                        oa.uuid,
                        o.uuid as org_uuid,
                        oa.status,
                        oa.company_name,
                        oa.billing_email,
                        oa.contact_name,
                        oa.tax_id,
                        oa.rejection_reason,
                        oa.submitted_at,
                        oa.reviewed_at,
                        oa.created_at,
                        oa.updated_at
                    from b2b_onboarding_applications oa
                    join b2b_organizations o on o.id = oa.org_id
                    where {where_sql}
                    order by oa.updated_at desc, oa.id desc
                    limit :limit
                    offset :offset
                    """
                ),
                params,
            )
        ).mappings().all()
        return {
            "items": [
                {
                    "id": str(row["uuid"]),
                    "org_id": str(row["org_uuid"]),
                    "status": str(row["status"]),
                    "company_name": str(row["company_name"]),
                    "billing_email": str(row["billing_email"]),
                    "contact_name": str(row["contact_name"]),
                    "tax_id": row.get("tax_id"),
                    "rejection_reason": row.get("rejection_reason"),
                    "submitted_at": self._iso(row.get("submitted_at")),
                    "reviewed_at": self._iso(row.get("reviewed_at")),
                    "created_at": self._iso(row.get("created_at")),
                    "updated_at": self._iso(row.get("updated_at")),
                }
                for row in rows
            ],
            "total": total,
            "limit": params["limit"],
            "offset": params["offset"],
        }

    async def patch_admin_onboarding_application(
        self,
        *,
        application_uuid: str,
        status: str,
        rejection_reason: str | None,
        reviewer_uuid: str,
    ) -> dict[str, Any] | None:
        row = (
            await self.session.execute(
                text(
                    """
                    update b2b_onboarding_applications
                    set
                        status = :status,
                        rejection_reason = :rejection_reason,
                        reviewed_by_user_uuid = cast(:reviewer_uuid as uuid),
                        reviewed_at = now(),
                        updated_at = now()
                    where uuid = cast(:application_uuid as uuid)
                    returning uuid, status
                    """
                ),
                {
                    "status": status,
                    "rejection_reason": rejection_reason,
                    "reviewer_uuid": self._uuid(reviewer_uuid),
                    "application_uuid": self._uuid(application_uuid),
                },
            )
        ).mappings().first()
        if not row:
            await self.session.rollback()
            return None
        await self.session.commit()
        return {"id": str(row["uuid"]), "status": str(row["status"])}

    async def list_admin_disputes(self, *, status: str | None, limit: int, offset: int) -> dict[str, Any]:
        where = ["1=1"]
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 200)), "offset": max(0, int(offset))}
        if status:
            where.append("d.status = :status")
            params["status"] = status
        where_sql = " and ".join(where)
        total = int(
            (
                await self.session.execute(text(f"select count(*)::int from b2b_click_disputes d where {where_sql}"), params)
            ).scalar_one()
            or 0
        )
        rows = (
            await self.session.execute(
                text(
                    f"""
                    select
                        d.uuid,
                        o.uuid as org_uuid,
                        c.uuid as click_charge_uuid,
                        d.status,
                        d.reason,
                        d.message,
                        d.resolution_note,
                        d.created_at,
                        d.updated_at,
                        d.resolved_at
                    from b2b_click_disputes d
                    join b2b_organizations o on o.id = d.org_id
                    join b2b_click_charges c on c.id = d.click_charge_id
                    where {where_sql}
                    order by d.updated_at desc, d.id desc
                    limit :limit
                    offset :offset
                    """
                ),
                params,
            )
        ).mappings().all()
        return {
            "items": [
                {
                    "id": str(row["uuid"]),
                    "org_id": str(row["org_uuid"]),
                    "click_charge_id": str(row["click_charge_uuid"]),
                    "status": str(row["status"]),
                    "reason": row.get("reason"),
                    "message": row.get("message"),
                    "resolution_note": row.get("resolution_note"),
                    "created_at": self._iso(row.get("created_at")),
                    "updated_at": self._iso(row.get("updated_at")),
                    "resolved_at": self._iso(row.get("resolved_at")),
                }
                for row in rows
            ],
            "total": total,
            "limit": params["limit"],
            "offset": params["offset"],
        }

    async def patch_admin_dispute(
        self,
        *,
        dispute_uuid: str,
        status: str,
        resolution_note: str | None,
        reviewer_uuid: str,
    ) -> dict[str, Any] | None:
        row = (
            await self.session.execute(
                text(
                    """
                    update b2b_click_disputes
                set
                        status = cast(:status as varchar(16)),
                        resolution_note = :resolution_note,
                    resolved_by_user_uuid = case when :is_resolved then cast(:reviewer_uuid as uuid) else resolved_by_user_uuid end,
                    resolved_at = case when :is_resolved then now() else resolved_at end,
                        updated_at = now()
                    where uuid = cast(:dispute_uuid as uuid)
                    returning uuid, status
                """
                ),
                {
                    "status": status,
                    "is_resolved": status in {"accepted", "rejected"},
                    "resolution_note": resolution_note,
                    "reviewer_uuid": self._uuid(reviewer_uuid),
                    "dispute_uuid": self._uuid(dispute_uuid),
                },
            )
        ).mappings().first()
        if not row:
            await self.session.rollback()
            return None
        await self.session.commit()
        return {"id": str(row["uuid"]), "status": str(row["status"])}

    async def list_admin_risk_flags(self, *, level: str | None, limit: int, offset: int) -> dict[str, Any]:
        where = ["1=1"]
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 200)), "offset": max(0, int(offset))}
        if level:
            where.append("f.level = :level")
            params["level"] = level
        where_sql = " and ".join(where)
        total = int(
            (
                await self.session.execute(text(f"select count(*)::int from b2b_fraud_flags f where {where_sql}"), params)
            ).scalar_one()
            or 0
        )
        rows = (
            await self.session.execute(
                text(
                    f"""
                    select
                        f.uuid,
                        f.level,
                        f.code,
                        f.details,
                        f.created_at,
                        e.uuid as click_event_uuid,
                        o.uuid as org_uuid
                    from b2b_fraud_flags f
                    join b2b_click_events e on e.id = f.click_event_id
                    left join b2b_organizations o on o.id = e.org_id
                    where {where_sql}
                    order by f.created_at desc, f.id desc
                    limit :limit
                    offset :offset
                    """
                ),
                params,
            )
        ).mappings().all()
        return {
            "items": [
                {
                    "id": str(row["uuid"]),
                    "level": str(row["level"]),
                    "code": str(row["code"]),
                    "details": row.get("details") if isinstance(row.get("details"), dict) else {},
                    "click_event_id": str(row["click_event_uuid"]),
                    "org_id": str(row["org_uuid"]) if row.get("org_uuid") else None,
                    "created_at": self._iso(row.get("created_at")),
                }
                for row in rows
            ],
            "total": total,
            "limit": params["limit"],
            "offset": params["offset"],
        }

    async def upsert_plan(self, *, code: str, name: str, monthly_fee: float, included_clicks: int, click_price: float, limits: dict) -> dict[str, Any]:
        row = (
            await self.session.execute(
                text(
                    """
                    insert into b2b_plan_catalog (
                        code,
                        name,
                        monthly_fee,
                        included_clicks,
                        click_price,
                        currency,
                        limits,
                        is_active
                    ) values (
                        :code,
                        :name,
                        :monthly_fee,
                        :included_clicks,
                        :click_price,
                        'UZS',
                        cast(:limits as jsonb),
                        true
                    )
                    on conflict (code) do update
                    set
                        name = excluded.name,
                        monthly_fee = excluded.monthly_fee,
                        included_clicks = excluded.included_clicks,
                        click_price = excluded.click_price,
                        limits = excluded.limits,
                        is_active = true,
                        updated_at = now()
                    returning uuid, code, name, monthly_fee, included_clicks, click_price, currency, limits
                    """
                ),
                {
                    "code": code,
                    "name": name,
                    "monthly_fee": monthly_fee,
                    "included_clicks": included_clicks,
                    "click_price": click_price,
                    "limits": json.dumps(limits or {}),
                },
            )
        ).mappings().one()
        await self.session.commit()
        return {
            "id": str(row["uuid"]),
            "code": str(row["code"]),
            "name": str(row["name"]),
            "monthly_fee": self._to_float(row.get("monthly_fee")),
            "included_clicks": self._to_int(row.get("included_clicks")),
            "click_price": self._to_float(row.get("click_price")),
            "currency": str(row.get("currency") or "UZS"),
            "limits": row.get("limits") if isinstance(row.get("limits"), dict) else {},
        }
