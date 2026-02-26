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
from app.schemas.b2b import B2BFeedCreateIn, B2BFeedOut, B2BFeedRunOut, B2BFeedValidateOut


UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
B2B_READ_ROLES = {"owner", "admin", "marketing", "analyst", "finance", "operator"}

router = APIRouter(prefix="/b2b/feeds", tags=["b2b-feeds"])


@router.get("", response_model=list[B2BFeedOut])
async def list_b2b_feeds(
    request: Request,
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    store_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-feeds-read", limit=180)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    resolved_org_id, _, _ = await resolve_org_context(
        repo,
        user_uuid=str(current_user.get("id")),
        org_id=org_id,
        allowed_roles=B2B_READ_ROLES,
    )
    resolved_store_id: int | None = None
    if store_id:
        resolved_store_id = await repo.resolve_store_id(store_id)
        if resolved_store_id is None:
            raise HTTPException(status_code=404, detail="store not found")
    feeds = await repo.list_feeds(org_id=resolved_org_id, store_id=resolved_store_id)
    return [B2BFeedOut(**item) for item in feeds]


@router.post("", response_model=B2BFeedOut)
async def create_b2b_feed(
    request: Request,
    payload: B2BFeedCreateIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-feeds-write", limit=120)
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
        created = await repo.create_feed(
            org_id=resolved_org_id,
            store_id=resolved_store_id,
            source_type=payload.source_type,
            source_url=payload.source_url,
            schedule_cron=payload.schedule_cron,
            auth_config=payload.auth_config,
            is_active=payload.is_active,
            created_by_user_uuid=str(current_user.get("id")),
        )
        return B2BFeedOut(**created)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.feeds.create:{payload.org_id.lower()}:{payload.store_id.lower()}:{payload.source_url}",
        handler=_op,
    )


@router.post("/{feed_id}/validate", response_model=B2BFeedValidateOut)
async def validate_b2b_feed(
    request: Request,
    feed_id: str = Path(..., pattern=UUID_REF_PATTERN),
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-feeds-validate", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=org_id,
            allowed_roles=B2B_WRITE_ROLES,
        )
        resolved_feed_id = await repo.resolve_feed_id(feed_id)
        if resolved_feed_id is None:
            raise HTTPException(status_code=404, detail="feed not found")
        feeds = await repo.list_feeds(org_id=resolved_org_id)
        if not any(str(item.get("id", "")).lower() == feed_id.lower() for item in feeds):
            raise HTTPException(status_code=404, detail="feed not found")
        validated = await repo.validate_feed(feed_id=resolved_feed_id)
        return B2BFeedValidateOut(**validated)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.feeds.validate:{feed_id.lower()}",
        handler=_op,
    )


@router.get("/{feed_id}/runs", response_model=list[B2BFeedRunOut])
async def list_b2b_feed_runs(
    request: Request,
    feed_id: str = Path(..., pattern=UUID_REF_PATTERN),
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-feed-runs-read", limit=200)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    resolved_org_id, _, _ = await resolve_org_context(
        repo,
        user_uuid=str(current_user.get("id")),
        org_id=org_id,
        allowed_roles=B2B_READ_ROLES,
    )
    resolved_feed_id = await repo.resolve_feed_id(feed_id)
    if resolved_feed_id is None:
        raise HTTPException(status_code=404, detail="feed not found")
    items = await repo.list_feed_runs(org_id=resolved_org_id, feed_id=resolved_feed_id)
    return [B2BFeedRunOut(**item) for item in items]
