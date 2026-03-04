from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.v1.routers.auth import _send_auth_email
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.seller import (
    SellerApplicationCreateIn,
    SellerApplicationOut,
    SellerApplicationStatusLookupOut,
)
from app.services.email_templates import build_partner_lead_submission_email
from app.services.seller_onboarding_service import (
    canonicalize_partner_lead_status,
    extract_request_ip,
    map_seller_application_payload_to_partner_lead,
    public_url,
    seller_panel_urls,
)


router = APIRouter(tags=["seller-public"])
logger = logging.getLogger(__name__)


@router.post("/applications/seller", response_model=SellerApplicationOut)
async def create_seller_application(
    request: Request,
    payload: SellerApplicationCreateIn,
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="seller-applications-create", limit=40)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        created = await repo.create_partner_lead(
            payload=map_seller_application_payload_to_partner_lead(payload),
            submitted_ip=extract_request_ip(request),
            submitted_user_agent=str(request.headers.get("user-agent") or "")[:512],
        )
        status_url = public_url(
            f"/partners/status?lead={created['id']}&token={created['tracking_token']}",
            app_base_url=str(settings.next_public_app_url or "http://localhost"),
        )
        subject, text_value, html_value = build_partner_lead_submission_email(
            contact_name=str(created.get("contact_name") or ""),
            company_name=str(created.get("company_name") or ""),
            lead_id=str(created.get("id") or ""),
            status_url=status_url,
            support_email=str(settings.admin_email or "").strip() or None,
        )
        sent, error_message = await _send_auth_email(
            recipient=str(created.get("email") or "").strip().lower(),
            subject=subject,
            text_value=text_value,
            html_value=html_value,
        )
        if not sent and error_message:
            logger.warning("seller_application_email_send_failed: %s", error_message)
        return SellerApplicationOut(
            id=str(created["id"]),
            status=canonicalize_partner_lead_status(created.get("status")),
            shop_name=str(created["company_name"]),
            contact_email=str(created["email"]),
            contact_phone=str(created["phone"]),
            review_note=created.get("review_note"),
            created_at=str(created["created_at"]),
            updated_at=str(created["updated_at"]),
        )

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"seller.applications.create:{payload.contact_email.lower()}:{payload.contact_phone}",
        handler=_op,
    )


@router.get("/applications/seller/status", response_model=SellerApplicationStatusLookupOut)
async def lookup_seller_application_status(
    request: Request,
    email: str = Query(..., min_length=5, max_length=255),
    phone: str = Query(..., min_length=7, max_length=64),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="seller-applications-status", limit=120)
    row = (
        await db.execute(
            text(
                """
                select
                    uuid,
                    status,
                    review_note,
                    provisioning_status,
                    created_at,
                    updated_at
                from b2b_partner_leads
                where lower(email) = lower(:email)
                  and phone = :phone
                order by updated_at desc, id desc
                limit 1
                """
            ),
            {"email": email.strip().lower(), "phone": phone.strip()},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="application not found")

    status = canonicalize_partner_lead_status(str(row.get("status") or "submitted"))
    provisioning_status = str(row.get("provisioning_status") or "pending")
    seller_login_url, seller_panel_url = seller_panel_urls(
        status=status,
        provisioning_status=provisioning_status,
        app_base_url=str(settings.next_public_app_url or "http://localhost"),
    )

    return SellerApplicationStatusLookupOut(
        id=str(row["uuid"]),
        status=status,
        review_note=row.get("review_note"),
        provisioning_status=provisioning_status,
        seller_login_url=seller_login_url,
        seller_panel_url=seller_panel_url,
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )
