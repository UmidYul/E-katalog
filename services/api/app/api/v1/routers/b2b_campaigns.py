from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.v1.routers.auth import get_current_user
from app.api.v1.routers.b2b_common import B2B_WRITE_ROLES, ensure_b2b_enabled, resolve_org_context
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.b2b import B2BCampaignCreateIn, B2BCampaignOut, B2BCampaignPatchIn


UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
B2B_READ_ROLES = {"owner", "admin", "marketing", "analyst", "finance", "operator"}

router = APIRouter(prefix="/b2b/campaigns", tags=["b2b-campaigns"])


@router.get("", response_model=list[B2BCampaignOut])
async def list_b2b_campaigns(
    request: Request,
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-campaigns-read", limit=180)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    resolved_org_id, _, _ = await resolve_org_context(
        repo,
        user_uuid=str(current_user.get("id")),
        org_id=org_id,
        allowed_roles=B2B_READ_ROLES,
    )
    rows = await repo.list_campaigns(org_id=resolved_org_id)
    return [B2BCampaignOut(**item) for item in rows]


@router.post("", response_model=B2BCampaignOut)
async def create_b2b_campaign(
    request: Request,
    payload: B2BCampaignCreateIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-campaigns-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=payload.org_id,
            allowed_roles=B2B_WRITE_ROLES,
        )
        resolved_store_id = await repo.resolve_store_id(payload.store_id)
        if resolved_store_id is None:
            raise HTTPException(status_code=404, detail="store not found")
        created = await repo.create_campaign(
            payload={
                "org_id": resolved_org_id,
                "store_id": resolved_store_id,
                "name": payload.name,
                "daily_budget": payload.daily_budget,
                "monthly_budget": payload.monthly_budget,
                "bid_default": payload.bid_default,
                "bid_cap": payload.bid_cap,
                "pacing_mode": payload.pacing_mode,
                "starts_at": payload.starts_at,
                "ends_at": payload.ends_at,
                "targets": payload.targets,
            },
            user_uuid=str(current_user.get("id")),
        )
        return B2BCampaignOut(**created)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.campaigns.create:{payload.org_id.lower()}:{payload.store_id.lower()}:{payload.name.strip().lower()}",
        handler=_op,
    )


@router.patch("/{campaign_id}", response_model=B2BCampaignOut)
async def patch_b2b_campaign(
    request: Request,
    payload: B2BCampaignPatchIn,
    campaign_id: str = Path(..., pattern=UUID_REF_PATTERN),
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-campaigns-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=org_id,
            allowed_roles=B2B_WRITE_ROLES,
        )
        resolved_campaign_id = await repo.resolve_campaign_id(campaign_id)
        if resolved_campaign_id is None:
            raise HTTPException(status_code=404, detail="campaign not found")
        rows = await repo.list_campaigns(org_id=resolved_org_id)
        if not any(str(item.get("id", "")).lower() == campaign_id.lower() for item in rows):
            raise HTTPException(status_code=404, detail="campaign not found")
        patched = await repo.patch_campaign(
            org_id=resolved_org_id,
            campaign_id=resolved_campaign_id,
            payload=payload.model_dump(exclude_none=True),
            actor_uuid=str(current_user.get("id")),
        )
        if not patched:
            raise HTTPException(status_code=404, detail="campaign not found")
        return B2BCampaignOut(**patched)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.campaigns.patch:{campaign_id.lower()}",
        handler=_op,
    )
