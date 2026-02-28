from __future__ import annotations

import hashlib
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from shared.utils.time import UTC

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.rbac import ADMIN_ROLE, require_roles
from app.api.v1.routers.seller_provisioning import apply_partner_lead_status_actions
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.seller import SellerProductStatusEventListOut
from app.services.seller_onboarding_service import canonicalize_partner_lead_status, internalize_seller_status
from app.services.seller_product_timeline_service import (
    list_seller_product_status_events,
    record_seller_product_status_event,
)


router = APIRouter(prefix="/admin/sellers", tags=["admin-sellers"])

UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"


class AdminSellerProductModerationPatchIn(BaseModel):
    status: str = Field(pattern=r"^(active|rejected|archived)$")
    moderation_comment: str | None = Field(default=None, max_length=2000)


class AdminSellerApplicationPatchIn(BaseModel):
    status: str = Field(pattern=r"^(pending|review|approved|rejected)$")
    review_note: str | None = Field(default=None, max_length=2000)


class AdminSellerApplicationBulkPatchIn(BaseModel):
    application_ids: list[str] = Field(min_length=1, max_length=200)
    status: str = Field(pattern=r"^(pending|review|approved|rejected)$")
    review_note: str | None = Field(default=None, max_length=2000)


class AdminSellerTariffAssignIn(BaseModel):
    plan_code: str = Field(min_length=2, max_length=64)


def _parse_iso(value: object) -> datetime | None:
    text_value = str(value or "").strip()
    if not text_value:
        return None
    try:
        parsed = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _age_hours(value: object) -> int:
    parsed = _parse_iso(value)
    if parsed is None:
        return 0
    return max(0, int((datetime.now(UTC) - parsed).total_seconds() // 3600))


def _priority_by_age(*, status: str, age_hours: int) -> str:
    if status not in {"pending", "review"}:
        return "resolved"
    if age_hours >= 72:
        return "critical"
    if age_hours >= 24:
        return "high"
    return "normal"


def _with_sla(item: dict) -> dict:
    normalized = dict(item)
    status = canonicalize_partner_lead_status(str(normalized.get("status") or "submitted"))
    submitted_at = str(normalized.get("created_at") or "")
    age_hours = _age_hours(submitted_at)
    normalized["status"] = status
    normalized["submitted_at"] = submitted_at
    normalized["age_hours"] = age_hours
    normalized["priority"] = _priority_by_age(status=status, age_hours=age_hours)
    return normalized


@router.get("/applications")
async def admin_list_seller_applications(
    request: Request,
    status: str | None = Query(default=None, pattern=r"^(pending|review|approved|rejected)$"),
    q: str | None = Query(default=None, min_length=2, max_length=120),
    sort_by: str = Query(default="recent", pattern=r"^(recent|oldest)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    b2b_status = internalize_seller_status(status) if status else None
    result = await repo.list_admin_partner_leads(status=b2b_status, q=q, limit=limit, offset=offset)
    items = [_with_sla(item) for item in result.get("items", [])]
    if sort_by == "oldest":
        items.sort(key=lambda item: _parse_iso(item.get("submitted_at")) or datetime.now(UTC))
    else:
        items.sort(key=lambda item: _parse_iso(item.get("submitted_at")) or datetime.fromtimestamp(0, tz=UTC), reverse=True)
    result["items"] = items
    return result


@router.get("/applications/{application_id}")
async def admin_get_seller_application(
    request: Request,
    application_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    row = (
        await db.execute(
            text(
                """
                select
                    uuid,
                    status,
                    company_name,
                    legal_name,
                    tax_id,
                    website_url,
                    contact_name,
                    contact_role,
                    email,
                    phone,
                    categories,
                    notes,
                    review_note,
                    provisioning_status,
                    created_at,
                    updated_at
                from b2b_partner_leads
                where uuid = cast(:application_id as uuid)
                limit 1
                """
            ),
            {"application_id": application_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="application not found")
    return _with_sla(dict(row))


@router.patch("/applications/{application_id}/status")
async def admin_patch_seller_application(
    request: Request,
    payload: AdminSellerApplicationPatchIn,
    application_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    if payload.status == "rejected" and not str(payload.review_note or "").strip():
        raise HTTPException(status_code=422, detail="review_note is required for rejected status")
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-sellers-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        status = internalize_seller_status(payload.status)
        updated = await repo.patch_admin_partner_lead(
            lead_uuid=application_id,
            status=status,
            review_note=payload.review_note,
            reviewer_uuid=str(current_user.get("id")),
        )
        if not updated:
            raise HTTPException(status_code=404, detail="application not found")
        result = await apply_partner_lead_status_actions(
            lead_id=application_id,
            status_value=status,
            review_note=payload.review_note,
            updated=updated,
            current_user_id=str(current_user.get("id")),
            repo=repo,
            redis=redis,
            db=db,
        )
        if isinstance(result, dict):
            return _with_sla(result)
        return _with_sla(updated)

    return await execute_idempotent_json(
        request,
        redis,
        scope=(
            f"admin.sellers.applications.patch:{application_id.lower()}:{payload.status}:"
            f"{hashlib.sha256(str(payload.review_note or '').encode('utf-8')).hexdigest()[:12]}"
        ),
        handler=_op,
    )


@router.post("/applications/bulk-status")
async def admin_bulk_patch_seller_applications(
    request: Request,
    payload: AdminSellerApplicationBulkPatchIn,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    if payload.status == "rejected" and not str(payload.review_note or "").strip():
        raise HTTPException(status_code=422, detail="review_note is required for rejected status")
    cleaned_ids: list[str] = []
    seen: set[str] = set()
    for value in payload.application_ids:
        normalized = str(value or "").strip().lower()
        if not re.match(UUID_REF_PATTERN, normalized):
            raise HTTPException(status_code=422, detail=f"invalid application id: {value}")
        if normalized in seen:
            continue
        cleaned_ids.append(normalized)
        seen.add(normalized)

    redis = get_redis()
    scope_fingerprint = hashlib.sha256(
        f"{payload.status}|{payload.review_note or ''}|{','.join(sorted(cleaned_ids))}".encode("utf-8")
    ).hexdigest()[:16]

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-sellers-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        target_status = internalize_seller_status(payload.status)
        items: list[dict] = []
        not_found: list[str] = []
        failed: list[dict] = []
        for application_id in cleaned_ids:
            try:
                updated = await repo.patch_admin_partner_lead(
                    lead_uuid=application_id,
                    status=target_status,
                    review_note=payload.review_note,
                    reviewer_uuid=str(current_user.get("id")),
                )
                if not updated:
                    not_found.append(application_id)
                    continue
                result = await apply_partner_lead_status_actions(
                    lead_id=application_id,
                    status_value=target_status,
                    review_note=payload.review_note,
                    updated=updated,
                    current_user_id=str(current_user.get("id")),
                    repo=repo,
                    redis=redis,
                    db=db,
                )
                items.append(_with_sla(result if isinstance(result, dict) else updated))
            except HTTPException as exc:
                failed.append({"application_id": application_id, "detail": str(exc.detail), "status_code": exc.status_code})
            except Exception as exc:  # noqa: BLE001
                failed.append({"application_id": application_id, "detail": str(exc), "status_code": 500})
        return {
            "ok": not failed,
            "status": payload.status,
            "processed": len(cleaned_ids),
            "updated_count": len(items),
            "not_found_count": len(not_found),
            "failed_count": len(failed),
            "items": items,
            "not_found_ids": not_found,
            "failed": failed,
        }

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"admin.sellers.applications.bulk_patch:{payload.status}:{scope_fingerprint}",
        handler=_op,
    )


@router.get("/shops")
async def admin_list_seller_shops(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    rows = (
        await db.execute(
            text(
                """
                select
                    s.uuid,
                    s.org_uuid,
                    s.owner_user_uuid,
                    s.slug,
                    s.shop_name,
                    s.status,
                    s.website_url,
                    s.contact_email,
                    s.contact_phone,
                    s.is_auto_paused,
                    s.metadata,
                    s.created_at,
                    s.updated_at
                from seller_shops s
                order by s.updated_at desc, s.id desc
                limit :limit
                offset :offset
                """
            ),
            {"limit": limit, "offset": offset},
        )
    ).mappings().all()
    total = int((await db.execute(text("select count(*)::int from seller_shops"))).scalar_one() or 0)
    return {"items": [dict(item) for item in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/product-moderation")
async def admin_list_seller_product_moderation(
    request: Request,
    status: str | None = Query(default="pending_moderation", pattern=r"^(draft|pending_moderation|active|rejected|archived)$"),
    q: str | None = Query(default=None, min_length=1, max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    rows = (
        await db.execute(
            text(
                """
                select
                    p.uuid,
                    p.title,
                    p.status,
                    p.price,
                    p.stock_quantity,
                    p.sku,
                    p.moderation_comment,
                    p.updated_at,
                    s.uuid as shop_uuid,
                    s.shop_name
                from seller_products p
                join seller_shops s on s.id = p.shop_id
                where (:status is null or p.status = :status)
                  and (
                    :q is null
                    or lower(p.title) like lower(cast(:q_like as text))
                    or lower(coalesce(p.sku, '')) like lower(cast(:q_like as text))
                    or lower(s.shop_name) like lower(cast(:q_like as text))
                  )
                order by p.updated_at desc, p.id desc
                limit :limit
                offset :offset
                """
            ),
            {
                "status": status,
                "q": q,
                "q_like": f"%{q.strip()}%" if q else None,
                "limit": limit,
                "offset": offset,
            },
        )
    ).mappings().all()
    total = int(
        (
            await db.execute(
                text(
                    """
                    select count(*)::int
                    from seller_products p
                    join seller_shops s on s.id = p.shop_id
                    where (:status is null or p.status = :status)
                      and (
                        :q is null
                        or lower(p.title) like lower(cast(:q_like as text))
                        or lower(coalesce(p.sku, '')) like lower(cast(:q_like as text))
                        or lower(s.shop_name) like lower(cast(:q_like as text))
                      )
                    """
                ),
                {
                    "status": status,
                    "q": q,
                    "q_like": f"%{q.strip()}%" if q else None,
                },
            )
        ).scalar_one()
        or 0
    )
    return {"items": [dict(item) for item in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/product-moderation/{product_id}/status-history", response_model=SellerProductStatusEventListOut)
async def admin_list_seller_product_status_history(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    target = (
        await db.execute(
            text(
                """
                select id
                from seller_products
                where uuid = cast(:product_uuid as uuid)
                limit 1
                """
            ),
            {"product_uuid": product_id},
        )
    ).mappings().first()
    if not target:
        raise HTTPException(status_code=404, detail="product not found")
    payload = await list_seller_product_status_events(
        db,
        product_id=int(target["id"]),
        limit=limit,
        offset=offset,
    )
    return SellerProductStatusEventListOut(**payload)


@router.patch("/product-moderation/{product_id}/status")
async def admin_patch_seller_product_moderation_status(
    request: Request,
    payload: AdminSellerProductModerationPatchIn,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    if payload.status == "rejected" and not str(payload.moderation_comment or "").strip():
        raise HTTPException(status_code=422, detail="moderation_comment is required when status=rejected")
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-sellers-write", limit=120)
        row = (
            await db.execute(
                text(
                    """
                    with target as (
                        select id, shop_id, status
                        from seller_products
                        where uuid = cast(:product_uuid as uuid)
                        limit 1
                    )
                    update seller_products p
                    set
                        status = :status,
                        moderation_comment = :moderation_comment,
                        updated_at = now()
                    from target t
                    where p.id = t.id
                    returning p.id, p.uuid, t.shop_id, t.status as previous_status, p.status, p.moderation_comment, p.updated_at
                    """
                ),
                {
                    "status": payload.status,
                    "moderation_comment": payload.moderation_comment,
                    "product_uuid": product_id,
                },
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="product not found")
        previous_status = str(row.get("previous_status") or "").strip().lower() or None
        current_status = str(row.get("status") or "").strip().lower() or None
        if current_status and previous_status != current_status:
            await record_seller_product_status_event(
                db,
                product_id=int(row["id"]),
                shop_id=int(row["shop_id"]),
                from_status=previous_status,
                to_status=current_status,
                event_type="status_change",
                reason_code=f"admin_moderation_{current_status}",
                comment=payload.moderation_comment,
                actor_role="admin",
                actor_user_uuid=str(current_user.get("id") or "").strip().lower() or None,
            )
        await db.commit()
        return {
            "uuid": str(row["uuid"]),
            "status": str(row["status"]),
            "moderation_comment": row.get("moderation_comment"),
            "updated_at": str(row["updated_at"]),
        }

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"admin.sellers.product_moderation.patch:{product_id.lower()}:{payload.status}",
        handler=_op,
    )


@router.get("/finance")
async def admin_list_seller_finance(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    rows = (
        await db.execute(
            text(
                """
                select
                    s.uuid as shop_uuid,
                    s.shop_name,
                    s.status as shop_status,
                    coalesce(w.balance, 0) as balance,
                    coalesce(w.credit_limit, 0) as credit_limit,
                    coalesce(sum(case when t.amount > 0 then t.amount else 0 end), 0) as total_topup,
                    coalesce(sum(case when t.amount < 0 then -t.amount else 0 end), 0) as total_spend
                from seller_shops s
                left join b2b_wallet_accounts w on w.org_id = (select o.id from b2b_organizations o where o.uuid = s.org_uuid)
                left join b2b_wallet_transactions t on t.wallet_account_id = w.id
                group by s.uuid, s.shop_name, s.status, w.balance, w.credit_limit
                order by s.updated_at desc
                limit :limit
                offset :offset
                """
            ),
            {"limit": limit, "offset": offset},
        )
    ).mappings().all()
    total = int((await db.execute(text("select count(*)::int from seller_shops"))).scalar_one() or 0)
    return {"items": [dict(item) for item in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/tariffs")
async def admin_list_seller_tariffs(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    plans = (
        await db.execute(
            text(
                """
                select
                    p.uuid,
                    p.code,
                    p.name,
                    p.monthly_fee,
                    p.included_clicks,
                    p.click_price,
                    p.currency,
                    p.is_active,
                    p.updated_at
                from b2b_plan_catalog p
                order by p.monthly_fee asc, p.id asc
                """
            )
        )
    ).mappings().all()
    return {"items": [dict(item) for item in plans], "total": len(plans)}


@router.get("/tariffs/assignments")
async def admin_list_seller_tariff_assignments(
    request: Request,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    rows = (
        await db.execute(
            text(
                """
                with latest_sub as (
                    select
                        s.org_id,
                        s.plan_id,
                        s.status,
                        s.created_at,
                        row_number() over (partition by s.org_id order by s.created_at desc, s.id desc) as rn
                    from b2b_subscriptions s
                )
                select
                    sh.uuid as shop_uuid,
                    sh.shop_name,
                    ls.status as subscription_status,
                    ls.created_at as assigned_at,
                    p.code as plan_code,
                    p.name as plan_name
                from seller_shops sh
                left join latest_sub ls on ls.org_id = (select o.id from b2b_organizations o where o.uuid = sh.org_uuid) and ls.rn = 1
                left join b2b_plan_catalog p on p.id = ls.plan_id
                order by sh.updated_at desc
                limit :limit
                """
            ),
            {"limit": limit},
        )
    ).mappings().all()
    return {"items": [dict(item) for item in rows], "total": len(rows)}


@router.put("/tariffs/assignments/{shop_id}")
async def admin_assign_seller_tariff(
    request: Request,
    payload: AdminSellerTariffAssignIn,
    shop_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-sellers-write", limit=120)
        org_id = (
            await db.execute(
                text("select o.id from b2b_organizations o join seller_shops s on s.org_uuid = o.uuid where s.uuid = cast(:shop_uuid as uuid)"),
                {"shop_uuid": shop_id},
            )
        ).scalar_one_or_none()
        if org_id is None:
            raise HTTPException(status_code=404, detail="shop not found")

        plan_id = (
            await db.execute(
                text("select id from b2b_plan_catalog where code = :code and is_active = true"),
                {"code": payload.plan_code},
            )
        ).scalar_one_or_none()
        if plan_id is None:
            raise HTTPException(status_code=404, detail="tariff plan not found")

        row = (
            await db.execute(
                text(
                    """
                    insert into b2b_subscriptions (org_id, plan_id, status, starts_at, created_at, updated_at)
                    values (:org_id, :plan_id, 'active', now(), now(), now())
                    returning uuid, org_id, plan_id, status, created_at
                    """
                ),
                {"org_id": int(org_id), "plan_id": int(plan_id)},
            )
        ).mappings().one()
        await db.commit()
        return dict(row)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"admin.sellers.tariff.assign:{shop_id.lower()}:{payload.plan_code.lower()}",
        handler=_op,
    )
