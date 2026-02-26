from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.v1.routers.auth import get_current_user
from app.api.v1.routers.b2b_common import ensure_b2b_enabled, resolve_org_context
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.b2b import (
    B2BMeOut,
    B2BOrganizationCreateIn,
    B2BOrganizationCreateOut,
    B2BOrgInviteIn,
    B2BOrgInviteOut,
    B2BOrgMemberPatchIn,
    B2BMembershipOut,
)


UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"

router = APIRouter(prefix="/b2b", tags=["b2b-orgs"])


@router.get("/me", response_model=B2BMeOut)
async def b2b_me(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="b2b-me", limit=120)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    memberships, organizations = await repo.list_user_orgs(user_uuid=str(current_user.get("id")))
    org_ids = [str(item.get("id")) for item in organizations]
    onboarding = await repo.get_onboarding_status_by_org(org_uuids=org_ids)
    billing = await repo.get_billing_status_by_org(org_uuids=org_ids)
    return B2BMeOut(
        user_id=str(current_user.get("id")),
        memberships=[B2BMembershipOut(**item) for item in memberships],
        organizations=organizations,
        onboarding_status_by_org=onboarding,
        billing_status_by_org=billing,
    )


@router.post("/orgs", response_model=B2BOrganizationCreateOut)
async def create_b2b_org(
    request: Request,
    payload: B2BOrganizationCreateIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-orgs-write", limit=60)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        return await repo.create_org(
            name=payload.name,
            slug=payload.slug,
            legal_name=payload.legal_name,
            tax_id=payload.tax_id,
            website_url=payload.website_url,
            user_uuid=str(current_user.get("id")),
        )

    try:
        return await execute_idempotent_json(
            request,
            redis,
            scope=f"b2b.orgs.create:{payload.slug.lower()}",
            handler=_op,
        )
    except Exception as exc:  # noqa: BLE001
        message = str(exc).lower()
        if "unique" in message or "duplicate" in message:
            raise HTTPException(status_code=409, detail="organization slug already exists") from exc
        raise


@router.post("/orgs/{org_id}/invites", response_model=B2BOrgInviteOut)
async def create_org_invite(
    request: Request,
    payload: B2BOrgInviteIn,
    org_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-org-invites-write", limit=80)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=org_id,
            allowed_roles={"owner", "admin"},
        )
        return await repo.create_org_invite(
            org_id=resolved_org_id,
            email=payload.email,
            role=payload.role,
            expires_in_days=payload.expires_in_days,
            invited_by_user_uuid=str(current_user.get("id")),
        )

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.org.invites.create:{org_id.lower()}:{payload.email.lower()}:{payload.role}",
        handler=_op,
    )


@router.patch("/orgs/{org_id}/members/{member_id}", response_model=B2BMembershipOut)
async def patch_org_member(
    request: Request,
    payload: B2BOrgMemberPatchIn,
    org_id: str = Path(..., pattern=UUID_REF_PATTERN),
    member_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    ensure_b2b_enabled()
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="b2b-org-members-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        resolved_org_id, _, _ = await resolve_org_context(
            repo,
            user_uuid=str(current_user.get("id")),
            org_id=org_id,
            allowed_roles={"owner", "admin"},
        )
        patched = await repo.patch_member(
            org_id=resolved_org_id,
            membership_uuid=member_id,
            role=payload.role,
            status=payload.status,
            actor_user_uuid=str(current_user.get("id")),
        )
        if not patched:
            raise HTTPException(status_code=404, detail="membership not found")
        return patched

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"b2b.org.members.patch:{org_id.lower()}:{member_id.lower()}",
        handler=_op,
    )
