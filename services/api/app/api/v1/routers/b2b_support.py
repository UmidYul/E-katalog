from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.v1.routers.auth import get_current_user
from app.api.v1.routers.b2b_common import ensure_b2b_enabled, resolve_org_context
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.b2b import B2BSupportTicketCreateIn, B2BSupportTicketOut


UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
B2B_SUPPORT_ROLES = {"owner", "admin", "marketing", "analyst", "finance", "operator"}

router = APIRouter(prefix="/b2b/support", tags=["b2b-support"])


@router.post("/tickets", response_model=B2BSupportTicketOut)
async def create_b2b_support_ticket(
    request: Request,
    payload: B2BSupportTicketCreateIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-support-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=payload.org_id,
            allowed_roles=B2B_SUPPORT_ROLES,
        )
        created = await repo.create_support_ticket(
            org_id=resolved_org_id,
            subject=payload.subject,
            category=payload.category,
            priority=payload.priority,
            body=payload.body,
            user_uuid=str(current_user.get("id")),
        )
        return B2BSupportTicketOut(**created)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.support.ticket.create:{payload.org_id.lower()}:{payload.subject.strip().lower()}",
        handler=_op,
    )


@router.get("/tickets", response_model=list[B2BSupportTicketOut])
async def list_b2b_support_tickets(
    request: Request,
    org_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    status: str | None = Query(default=None, pattern=r"^(open|in_progress|waiting_merchant|resolved|closed)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-support-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    resolved_org_id, _, _ = await resolve_org_context(
        repo,
        user_uuid=str(current_user.get("id")),
        org_id=org_id,
        allowed_roles=B2B_SUPPORT_ROLES,
    )
    rows = await repo.list_support_tickets(org_id=resolved_org_id, status=status, limit=limit, offset=offset)
    return [B2BSupportTicketOut(**item) for item in rows]
