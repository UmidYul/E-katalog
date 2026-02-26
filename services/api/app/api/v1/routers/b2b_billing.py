from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.v1.routers.auth import get_current_user
from app.api.v1.routers.b2b_common import ensure_b2b_enabled, resolve_org_context
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.b2b import (
    B2BActOut,
    B2BBillingPlanOut,
    B2BBillingSubscribeIn,
    B2BInvoiceOut,
    B2BInvoicePayIn,
    B2BInvoicePayOut,
    B2BSubscriptionOut,
)


UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
B2B_BILLING_READ_ROLES = {"owner", "admin", "finance", "analyst"}
B2B_BILLING_WRITE_ROLES = {"owner", "admin", "finance"}

router = APIRouter(prefix="/b2b/billing", tags=["b2b-billing"])


@router.get("/plans", response_model=list[B2BBillingPlanOut])
async def list_b2b_billing_plans(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-billing-plans-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    rows = await repo.list_billing_plans()
    return [B2BBillingPlanOut(**item) for item in rows]


@router.post("/subscriptions", response_model=B2BSubscriptionOut)
async def subscribe_b2b_plan(
    request: Request,
    payload: B2BBillingSubscribeIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-billing-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=payload.org_id,
            allowed_roles=B2B_BILLING_WRITE_ROLES,
        )
        created = await repo.create_subscription(
            org_id=resolved_org_id,
            plan_code=payload.plan_code,
            user_uuid=str(current_user.get("id")),
        )
        if created is None:
            raise HTTPException(status_code=404, detail="billing plan not found")
        return B2BSubscriptionOut(**created)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.billing.subscriptions.create:{payload.org_id.lower()}:{payload.plan_code.lower()}",
        handler=_op,
    )


@router.get("/invoices", response_model=list[B2BInvoiceOut])
async def list_b2b_invoices(
    request: Request,
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-billing-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    resolved_org_id, _, _ = await resolve_org_context(
        repo,
        user_uuid=str(current_user.get("id")),
        org_id=org_id,
        allowed_roles=B2B_BILLING_READ_ROLES,
    )
    rows = await repo.list_invoices(org_id=resolved_org_id, limit=limit, offset=offset)
    return [B2BInvoiceOut(**item) for item in rows]


@router.post("/invoices/{invoice_id}/pay", response_model=B2BInvoicePayOut)
async def pay_b2b_invoice(
    request: Request,
    payload: B2BInvoicePayIn,
    invoice_id: str = Path(..., pattern=UUID_REF_PATTERN),
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-billing-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=org_id,
            allowed_roles=B2B_BILLING_WRITE_ROLES,
        )
        resolved_invoice_id = await repo.resolve_invoice_id(invoice_id)
        if resolved_invoice_id is None:
            raise HTTPException(status_code=404, detail="invoice not found")
        paid = await repo.pay_invoice(
            org_id=resolved_org_id,
            invoice_id=resolved_invoice_id,
            provider=payload.provider,
            amount=payload.amount,
        )
        if paid is None:
            raise HTTPException(status_code=404, detail="invoice not found")
        return B2BInvoicePayOut(**paid)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.billing.invoices.pay:{invoice_id.lower()}",
        handler=_op,
    )


@router.get("/acts", response_model=list[B2BActOut])
async def list_b2b_acts(
    request: Request,
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-billing-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    resolved_org_id, _, _ = await resolve_org_context(
        repo,
        user_uuid=str(current_user.get("id")),
        org_id=org_id,
        allowed_roles=B2B_BILLING_READ_ROLES,
    )
    rows = await repo.list_acts(org_id=resolved_org_id)
    return [B2BActOut(**item) for item in rows]
