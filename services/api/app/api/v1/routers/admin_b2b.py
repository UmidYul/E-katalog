from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.rbac import ADMIN_ROLE, require_roles
from app.api.v1.routers.auth import _create_user, _get_user_by_email, _hash_password, _now_iso, _send_auth_email
from app.api.v1.routers.b2b_common import ensure_b2b_enabled
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.b2b import (
    AdminB2BDisputePatchIn,
    AdminB2BOnboardingPatchIn,
    AdminB2BPartnerLeadPatchIn,
    AdminB2BPlanUpsertIn,
    B2BBillingPlanOut,
)
from app.services.worker_client import (
    enqueue_b2b_acts_generation,
    enqueue_b2b_feed_health_validation,
    enqueue_b2b_fraud_scan,
    enqueue_b2b_subscription_invoices,
)


UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"

router = APIRouter(prefix="/admin/b2b", tags=["admin-b2b"])


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


@router.get("/onboarding/applications")
async def admin_list_b2b_onboarding_applications(
    request: Request,
    status: str | None = Query(default=None, pattern=r"^(draft|submitted|review|approved|rejected)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-b2b-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.list_admin_onboarding_applications(status=status, limit=limit, offset=offset)


@router.get("/partner-leads")
async def admin_list_b2b_partner_leads(
    request: Request,
    status: str | None = Query(default=None, pattern=r"^(submitted|review|approved|rejected)$"),
    q: str | None = Query(default=None, min_length=2, max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-b2b-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.list_admin_partner_leads(status=status, q=q, limit=limit, offset=offset)


@router.patch("/partner-leads/{lead_id}")
async def admin_patch_b2b_partner_lead(
    request: Request,
    payload: AdminB2BPartnerLeadPatchIn,
    lead_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-b2b-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        updated = await repo.patch_admin_partner_lead(
            lead_uuid=lead_id,
            status=payload.status,
            review_note=payload.review_note,
            reviewer_uuid=str(current_user.get("id")),
        )
        if not updated:
            raise HTTPException(status_code=404, detail="partner lead not found")

        status_value = str(payload.status or "").strip().lower()
        if status_value == "approved":
            user = await _get_user_by_email(redis, str(updated.get("email") or ""), db)
            temp_password: str | None = None
            if user is None:
                temp_password = _issue_partner_temp_password()
                user = await _create_user(
                    redis,
                    db=db,
                    email=str(updated.get("email") or "").strip().lower(),
                    full_name=_display_name(str(updated.get("contact_name") or ""), str(updated.get("company_name") or "")),
                    password_hash=_hash_password(temp_password),
                    role="user",
                    extra_fields={"email_confirmed": "1", "email_confirmed_at": _now_iso()},
                )
            user_uuid = str(user.get("uuid") or "").strip()
            if not user_uuid:
                failed = await repo.mark_partner_lead_provisioning_failed(
                    lead_uuid=lead_id,
                    error_message="failed to resolve user uuid for approved partner lead",
                )
                if failed:
                    return failed
                raise HTTPException(status_code=500, detail="failed to resolve user uuid")

            try:
                provisioned = await repo.provision_partner_lead_approval(
                    lead_uuid=lead_id,
                    owner_user_uuid=user_uuid,
                    reviewer_uuid=str(current_user.get("id")),
                )
                if provisioned:
                    updated = provisioned
            except Exception as exc:  # noqa: BLE001
                failed = await repo.mark_partner_lead_provisioning_failed(lead_uuid=lead_id, error_message=str(exc))
                if failed:
                    return failed
                raise

            subject = "Seller partner application approved"
            lines = [
                f"Hello, {str(updated.get('contact_name') or '').strip() or 'partner'}!",
                "",
                f"Your application for {str(updated.get('company_name') or 'your company')} is approved.",
                f"Login: {_public_url('/login?next=/seller')}",
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
                    f"Seller panel: {_public_url('/seller')}",
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

        if status_value == "rejected":
            message_body = [
                f"Hello, {str(updated.get('contact_name') or '').strip() or 'partner'}!",
                "",
                f"Your application for {str(updated.get('company_name') or 'your company')} was rejected.",
                str(payload.review_note or "Please contact support for additional details."),
            ]
            sent, error_message = await _send_auth_email(
                recipient=str(updated.get("email") or "").strip().lower(),
                subject="Seller partner application update",
                text_value="\n".join(message_body),
            )
            if not sent and error_message:
                updated["notification_error"] = error_message
        return updated

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"admin.b2b.partner_leads.patch:{lead_id.lower()}:{payload.status}",
        handler=_op,
    )


@router.patch("/onboarding/applications/{application_id}")
async def admin_patch_b2b_onboarding_application(
    request: Request,
    payload: AdminB2BOnboardingPatchIn,
    application_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-b2b-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        updated = await repo.patch_admin_onboarding_application(
            application_uuid=application_id,
            status=payload.status,
            rejection_reason=payload.rejection_reason,
            reviewer_uuid=str(current_user.get("id")),
        )
        if not updated:
            raise HTTPException(status_code=404, detail="onboarding application not found")
        return updated

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"admin.b2b.onboarding.patch:{application_id.lower()}:{payload.status}",
        handler=_op,
    )


@router.get("/disputes")
async def admin_list_b2b_disputes(
    request: Request,
    status: str | None = Query(default=None, pattern=r"^(open|review|accepted|rejected)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-b2b-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.list_admin_disputes(status=status, limit=limit, offset=offset)


@router.patch("/disputes/{dispute_id}")
async def admin_patch_b2b_dispute(
    request: Request,
    payload: AdminB2BDisputePatchIn,
    dispute_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-b2b-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        updated = await repo.patch_admin_dispute(
            dispute_uuid=dispute_id,
            status=payload.status,
            resolution_note=payload.resolution_note,
            reviewer_uuid=str(current_user.get("id")),
        )
        if not updated:
            raise HTTPException(status_code=404, detail="dispute not found")
        return updated

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"admin.b2b.dispute.patch:{dispute_id.lower()}:{payload.status}",
        handler=_op,
    )


@router.get("/risk-flags")
async def admin_list_b2b_risk_flags(
    request: Request,
    level: str | None = Query(default=None, pattern=r"^(low|medium|high|critical)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-b2b-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.list_admin_risk_flags(level=level, limit=limit, offset=offset)


@router.get("/plans", response_model=list[B2BBillingPlanOut])
async def admin_list_b2b_plans(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-b2b-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    rows = await repo.list_billing_plans()
    return [B2BBillingPlanOut(**item) for item in rows]


@router.post("/plans/upsert", response_model=B2BBillingPlanOut)
async def admin_upsert_b2b_plan(
    request: Request,
    payload: AdminB2BPlanUpsertIn,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-b2b-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        row = await repo.upsert_plan(
            code=payload.code,
            name=payload.name,
            monthly_fee=payload.monthly_fee,
            included_clicks=payload.included_clicks,
            click_price=payload.click_price,
            limits=payload.limits,
        )
        return B2BBillingPlanOut(**row)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"admin.b2b.plan.upsert:{payload.code.lower()}",
        handler=_op,
    )


@router.post("/tasks/invoices")
async def admin_enqueue_b2b_invoices_task(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-b2b-write", limit=120)
        task_id = enqueue_b2b_subscription_invoices()
        return {"task_id": task_id, "queued": "b2b_subscription_invoices"}

    return await execute_idempotent_json(request, redis, scope="admin.b2b.tasks.invoices", handler=_op)


@router.post("/tasks/acts")
async def admin_enqueue_b2b_acts_task(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-b2b-write", limit=120)
        task_id = enqueue_b2b_acts_generation()
        return {"task_id": task_id, "queued": "b2b_acts_generation"}

    return await execute_idempotent_json(request, redis, scope="admin.b2b.tasks.acts", handler=_op)


@router.post("/tasks/fraud-scan")
async def admin_enqueue_b2b_fraud_scan_task(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-b2b-write", limit=120)
        task_id = enqueue_b2b_fraud_scan()
        return {"task_id": task_id, "queued": "b2b_fraud_scan"}

    return await execute_idempotent_json(request, redis, scope="admin.b2b.tasks.fraud_scan", handler=_op)


@router.post("/tasks/feed-health")
async def admin_enqueue_b2b_feed_health_task(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-b2b-write", limit=120)
        task_id = enqueue_b2b_feed_health_validation()
        return {"task_id": task_id, "queued": "b2b_feed_health_validation"}

    return await execute_idempotent_json(request, redis, scope="admin.b2b.tasks.feed_health", handler=_op)
