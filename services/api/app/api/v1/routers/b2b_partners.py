from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.v1.routers.b2b_common import ensure_b2b_enabled
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.b2b import B2BPartnerLeadCreateIn, B2BPartnerLeadOut


router = APIRouter(prefix="/b2b/partners", tags=["b2b-partners"])


def _extract_ip(request: Request) -> str:
    forwarded_for = str(request.headers.get("x-forwarded-for") or "").strip()
    if forwarded_for:
        ip_value = forwarded_for.split(",")[0].strip()
        if ip_value:
            return ip_value
    real_ip = str(request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


@router.post("/leads", response_model=B2BPartnerLeadOut)
async def create_b2b_partner_lead(
    request: Request,
    payload: B2BPartnerLeadCreateIn,
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-partner-leads-create", limit=30)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        created = await repo.create_partner_lead(
            payload=payload.model_dump(),
            submitted_ip=_extract_ip(request),
            submitted_user_agent=str(request.headers.get("user-agent") or "")[:512],
        )
        return B2BPartnerLeadOut(**created)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.partners.leads.create:{payload.email.lower()}:{payload.company_name.lower()}",
        handler=_op,
    )
