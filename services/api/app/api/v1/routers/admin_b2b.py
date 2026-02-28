from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.rbac import ADMIN_ROLE, require_roles
from app.api.v1.routers.b2b_common import ensure_b2b_enabled
from app.api.v1.routers.seller_provisioning import apply_partner_lead_status_actions
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
        return await apply_partner_lead_status_actions(
            lead_id=lead_id,
            status_value=status_value,
            review_note=payload.review_note,
            updated=updated,
            current_user_id=str(current_user.get("id")),
            repo=repo,
            redis=redis,
            db=db,
        )

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
