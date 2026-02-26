from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.v1.routers.auth import get_current_user
from app.api.v1.routers.b2b_common import ensure_b2b_enabled, resolve_org_context
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.b2b import B2BAnalyticsAttributionOut, B2BAnalyticsOfferOut, B2BAnalyticsOverviewOut
from shared.utils.time import UTC
from datetime import datetime


UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
B2B_READ_ROLES = {"owner", "admin", "marketing", "analyst", "finance", "operator"}

router = APIRouter(prefix="/b2b/analytics", tags=["b2b-analytics"])


@router.get("/overview", response_model=B2BAnalyticsOverviewOut)
async def b2b_analytics_overview(
    request: Request,
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    period_days: int = Query(default=30, ge=1, le=365),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-analytics-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    resolved_org_id, org_uuid, _ = await resolve_org_context(
        repo,
        user_uuid=str(current_user.get("id")),
        org_id=org_id,
        allowed_roles=B2B_READ_ROLES,
    )
    payload = await repo.get_analytics_overview(org_id=resolved_org_id, period_days=period_days)
    return B2BAnalyticsOverviewOut(
        org_id=org_uuid,
        period_days=period_days,
        summary=payload.get("summary") if isinstance(payload.get("summary"), dict) else {},
        series=payload.get("series") if isinstance(payload.get("series"), list) else [],
        generated_at=datetime.now(UTC).isoformat(),
    )


@router.get("/offers", response_model=list[B2BAnalyticsOfferOut])
async def b2b_analytics_offers(
    request: Request,
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-analytics-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    resolved_org_id, _, _ = await resolve_org_context(
        repo,
        user_uuid=str(current_user.get("id")),
        org_id=org_id,
        allowed_roles=B2B_READ_ROLES,
    )
    rows = await repo.get_analytics_offers(org_id=resolved_org_id, limit=limit)
    return [B2BAnalyticsOfferOut(**item) for item in rows]


@router.get("/attribution", response_model=list[B2BAnalyticsAttributionOut])
async def b2b_analytics_attribution(
    request: Request,
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    period_days: int = Query(default=30, ge=1, le=365),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-analytics-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    resolved_org_id, _, _ = await resolve_org_context(
        repo,
        user_uuid=str(current_user.get("id")),
        org_id=org_id,
        allowed_roles=B2B_READ_ROLES,
    )
    rows = await repo.get_analytics_attribution(org_id=resolved_org_id, period_days=period_days)
    return [B2BAnalyticsAttributionOut(**item) for item in rows]
