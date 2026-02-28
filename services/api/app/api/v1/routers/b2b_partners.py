from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.v1.routers.b2b_common import ensure_b2b_enabled
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.b2b import B2BPartnerLeadCreateIn, B2BPartnerLeadOut, B2BPartnerLeadStatusOut
from app.services.seller_onboarding_service import (
    extract_request_ip,
    maybe_log_legacy_b2b_seller_warning,
    public_url,
    seller_panel_urls,
    set_legacy_b2b_seller_deprecation_headers,
)


router = APIRouter(prefix="/b2b/partners", tags=["b2b-partners"])
UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"


@router.post("/leads", response_model=B2BPartnerLeadOut)
async def create_b2b_partner_lead(
    request: Request,
    response: Response,
    payload: B2BPartnerLeadCreateIn,
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    set_legacy_b2b_seller_deprecation_headers(response, successor_path="/api/v1/applications/seller")
    maybe_log_legacy_b2b_seller_warning(endpoint_name="POST /api/v1/b2b/partners/leads")
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-partner-leads-create", limit=30)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        created = await repo.create_partner_lead(
            payload=payload.model_dump(),
            submitted_ip=extract_request_ip(request),
            submitted_user_agent=str(request.headers.get("user-agent") or "")[:512],
        )
        created["status_url"] = public_url(
            f"/partners/status?lead={created['id']}&token={created['tracking_token']}",
            app_base_url=str(settings.next_public_app_url or "http://localhost"),
        )
        return B2BPartnerLeadOut(**created)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.partners.leads.create:{payload.email.lower()}:{payload.company_name.lower()}",
        handler=_op,
    )


@router.get("/leads/{lead_id}/status", response_model=B2BPartnerLeadStatusOut)
async def get_b2b_partner_lead_status(
    request: Request,
    response: Response,
    lead_id: str = Path(..., pattern=UUID_REF_PATTERN),
    token: str = Query(..., min_length=20, max_length=255),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    set_legacy_b2b_seller_deprecation_headers(response, successor_path="/api/v1/applications/seller/status")
    maybe_log_legacy_b2b_seller_warning(endpoint_name="GET /api/v1/b2b/partners/leads/{lead_id}/status")
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-partner-leads-status-read", limit=120)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    row = await repo.get_partner_lead_status(lead_uuid=lead_id, tracking_token=token)
    if not row:
        raise HTTPException(status_code=404, detail="partner lead not found")
    row["seller_login_url"], row["seller_panel_url"] = seller_panel_urls(
        status=str(row.get("status") or ""),
        provisioning_status=str(row.get("provisioning_status") or ""),
        app_base_url=str(settings.next_public_app_url or "http://localhost"),
    )
    return B2BPartnerLeadStatusOut(**row)
