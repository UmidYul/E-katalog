from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.v1.routers.b2b_common import B2B_WRITE_ROLES, ensure_b2b_enabled, get_current_b2b_user, resolve_org_context
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.b2b import (
    B2BContractAcceptanceIn,
    B2BContractAcceptanceOut,
    B2BKycDocumentIn,
    B2BKycDocumentOut,
    B2BOnboardingApplicationIn,
    B2BOnboardingApplicationOut,
)


UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"

router = APIRouter(prefix="/b2b/onboarding", tags=["b2b-onboarding"])


@router.post("/applications", response_model=B2BOnboardingApplicationOut)
async def upsert_onboarding_application(
    request: Request,
    payload: B2BOnboardingApplicationIn,
    current_user: dict = Depends(get_current_b2b_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-onboarding-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=payload.org_id,
            allowed_roles=B2B_WRITE_ROLES,
        )
        row = await repo.upsert_onboarding_application(
            payload={
                "org_id": resolved_org_id,
                "company_name": payload.company_name,
                "legal_address": payload.legal_address,
                "billing_email": payload.billing_email,
                "contact_name": payload.contact_name,
                "contact_phone": payload.contact_phone,
                "website_domain": payload.website_domain,
                "tax_id": payload.tax_id,
                "payout_details": payload.payout_details,
                "submit": payload.submit,
            },
            user_uuid=str(current_user.get("id")),
        )
        return row

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.onboarding.applications.upsert:{payload.org_id.lower()}",
        handler=_op,
    )


@router.post("/documents", response_model=B2BKycDocumentOut)
async def create_kyc_document(
    request: Request,
    payload: B2BKycDocumentIn,
    current_user: dict = Depends(get_current_b2b_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-onboarding-documents-write", limit=180)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=payload.org_id,
            allowed_roles=B2B_WRITE_ROLES,
        )
        application_id = None
        if payload.application_id is not None:
            application_row = (
                await db.execute(
                    text(
                        "select id from b2b_onboarding_applications where uuid = cast(:value as uuid) and org_id = :org_id"
                    ),
                    {"value": payload.application_id.lower(), "org_id": resolved_org_id},
                )
            ).scalar_one_or_none()
            if application_row is None:
                raise HTTPException(status_code=404, detail="onboarding application not found")
            application_id = int(application_row)
        return await repo.create_kyc_document(
            org_id=resolved_org_id,
            application_id=application_id,
            document_type=payload.document_type,
            storage_url=payload.storage_url,
            checksum=payload.checksum,
        )

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.onboarding.documents.create:{payload.org_id.lower()}:{payload.document_type.lower()}:{payload.storage_url}",
        handler=_op,
    )


@router.post("/accept-offer", response_model=B2BContractAcceptanceOut)
async def accept_public_offer(
    request: Request,
    payload: B2BContractAcceptanceIn,
    current_user: dict = Depends(get_current_b2b_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-onboarding-accept-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=payload.org_id,
            allowed_roles={"owner", "admin", "finance"},
        )
        return await repo.accept_contract(
            org_id=resolved_org_id,
            contract_version=payload.contract_version,
            user_uuid=str(current_user.get("id")),
            ip_address=(request.headers.get("x-real-ip") or request.client.host if request.client else "unknown"),
            user_agent=request.headers.get("user-agent") or "",
        )

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.onboarding.accept-offer:{payload.org_id.lower()}:{payload.contract_version}",
        handler=_op,
    )
