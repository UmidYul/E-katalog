from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.rbac import require_roles
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.seller import (
    SellerDashboardAlertsOut,
    SellerDashboardChartPoint,
    SellerDashboardStatsOut,
    SellerShopOut,
    SellerShopPatchIn,
)
from shared.utils.time import UTC


router = APIRouter(prefix="/seller", tags=["seller"])


async def get_current_seller_user(current_user: dict = Depends(require_roles("seller", detail="seller access required"))) -> dict:
    return current_user


async def _resolve_primary_org_id(db: AsyncSession, *, user_uuid: str) -> int | None:
    org_uuid = (
        await db.execute(
            text(
                """
                select org_uuid
                from seller_shops
                where owner_user_uuid = cast(:user_uuid as uuid)
                order by updated_at desc, id desc
                limit 1
                """
            ),
            {"user_uuid": str(user_uuid).strip().lower()},
        )
    ).scalar_one_or_none()
    if org_uuid:
        resolved = await B2BRepository(db, cursor_secret=settings.cursor_secret).resolve_org_id(str(org_uuid))
        if resolved is not None:
            return resolved
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    memberships, _ = await repo.list_user_orgs(user_uuid=user_uuid)
    if not memberships:
        return None
    return await repo.resolve_org_id(str(memberships[0]["org_id"]))


@router.get("/shop", response_model=SellerShopOut)
async def seller_get_shop(
    request: Request,
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="seller-dashboard-read", limit=240)
    row = (
        await db.execute(
            text(
                """
                select
                    uuid,
                    org_uuid,
                    owner_user_uuid,
                    slug,
                    shop_name,
                    status,
                    website_url,
                    contact_email,
                    contact_phone,
                    is_auto_paused,
                    metadata,
                    created_at,
                    updated_at
                from seller_shops
                where owner_user_uuid = cast(:user_uuid as uuid)
                order by updated_at desc, id desc
                limit 1
                """
            ),
            {"user_uuid": str(current_user.get("id") or "").strip().lower()},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="seller shop not found")
    return SellerShopOut(
        id=str(row["uuid"]),
        org_id=str(row["org_uuid"]),
        owner_user_id=str(row["owner_user_uuid"]),
        slug=str(row["slug"]),
        shop_name=str(row["shop_name"]),
        status=str(row["status"]),
        website_url=row.get("website_url"),
        contact_email=str(row["contact_email"]),
        contact_phone=str(row["contact_phone"]),
        is_auto_paused=bool(row.get("is_auto_paused")),
        metadata=row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


@router.put("/shop", response_model=SellerShopOut)
async def seller_update_shop(
    request: Request,
    payload: SellerShopPatchIn,
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    user_uuid = str(current_user.get("id") or "").strip().lower()
    provided_patch = payload.model_dump(exclude_unset=True)
    payload_fingerprint = hashlib.sha256(
        json.dumps(provided_patch, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]

    async def _op():
        await enforce_rate_limit(request, redis, bucket="seller-dashboard-write", limit=120)
        metadata_patch: dict[str, str | None] = {}
        if "logo_url" in provided_patch:
            logo_url = provided_patch.get("logo_url")
            metadata_patch["logo_url"] = str(logo_url).strip() if isinstance(logo_url, str) else None
        if "banner_url" in provided_patch:
            banner_url = provided_patch.get("banner_url")
            metadata_patch["banner_url"] = str(banner_url).strip() if isinstance(banner_url, str) else None
        if "brand_color" in provided_patch:
            brand_color = provided_patch.get("brand_color")
            normalized_brand_color: str | None = None
            if isinstance(brand_color, str):
                cleaned = brand_color.strip().lower()
                if cleaned:
                    normalized_brand_color = cleaned if cleaned.startswith("#") else f"#{cleaned}"
            metadata_patch["brand_color"] = normalized_brand_color
        row = (
            await db.execute(
                text(
                    """
                    update seller_shops
                    set
                        shop_name = coalesce(:shop_name, shop_name),
                        website_url = coalesce(:website_url, website_url),
                        contact_email = coalesce(:contact_email, contact_email),
                        contact_phone = coalesce(:contact_phone, contact_phone),
                        metadata = jsonb_strip_nulls(coalesce(metadata, '{}'::jsonb) || cast(:metadata_patch as jsonb)),
                        updated_at = now()
                    where owner_user_uuid = cast(:user_uuid as uuid)
                    returning
                        uuid,
                        org_uuid,
                        owner_user_uuid,
                        slug,
                        shop_name,
                        status,
                        website_url,
                        contact_email,
                        contact_phone,
                        is_auto_paused,
                        metadata,
                        created_at,
                        updated_at
                    """
                ),
                {
                    "shop_name": payload.shop_name,
                    "website_url": payload.website_url,
                    "contact_email": payload.contact_email,
                    "contact_phone": payload.contact_phone,
                    "metadata_patch": json.dumps(
                        metadata_patch,
                        ensure_ascii=False,
                    ),
                    "user_uuid": user_uuid,
                },
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="seller shop not found")
        await db.commit()
        return SellerShopOut(
            id=str(row["uuid"]),
            org_id=str(row["org_uuid"]),
            owner_user_id=str(row["owner_user_uuid"]),
            slug=str(row["slug"]),
            shop_name=str(row["shop_name"]),
            status=str(row["status"]),
            website_url=row.get("website_url"),
            contact_email=str(row["contact_email"]),
            contact_phone=str(row["contact_phone"]),
            is_auto_paused=bool(row.get("is_auto_paused")),
            metadata=row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"seller.shop.update:{user_uuid}:{payload_fingerprint}",
        handler=_op,
    )


@router.get("/dashboard/stats", response_model=SellerDashboardStatsOut)
async def seller_dashboard_stats(
    request: Request,
    period_days: int = Query(default=30, ge=7, le=90),
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="seller-dashboard-read", limit=240)
    org_id = await _resolve_primary_org_id(db, user_uuid=str(current_user.get("id")))
    if org_id is None:
        return SellerDashboardStatsOut(period_days=period_days, clicks=0, spend_uzs=0.0, orders=0, conversion_rate=0.0)

    since = datetime.now(UTC) - timedelta(days=period_days)
    row = (
        await db.execute(
            text(
                """
                select
                    coalesce(count(e.id), 0)::int as clicks,
                    coalesce(sum(e.billed_amount), 0)::numeric as spend_uzs,
                    coalesce(count(distinct p.id), 0)::int as orders
                from b2b_click_events e
                left join b2b_payments p on p.org_id = e.org_id and p.created_at >= :since
                where e.org_id = :org_id
                  and e.created_at >= :since
                """
            ),
            {"org_id": org_id, "since": since},
        )
    ).mappings().one()

    clicks = int(row.get("clicks") or 0)
    orders = int(row.get("orders") or 0)
    conversion = (orders / clicks * 100.0) if clicks > 0 else 0.0
    return SellerDashboardStatsOut(
        period_days=period_days,
        clicks=clicks,
        spend_uzs=float(row.get("spend_uzs") or 0.0),
        orders=orders,
        conversion_rate=round(conversion, 2),
    )


@router.get("/dashboard/chart", response_model=list[SellerDashboardChartPoint])
async def seller_dashboard_chart(
    request: Request,
    period_days: int = Query(default=30, ge=7, le=90),
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="seller-dashboard-read", limit=240)
    org_id = await _resolve_primary_org_id(db, user_uuid=str(current_user.get("id")))
    if org_id is None:
        return []

    since = datetime.now(UTC) - timedelta(days=period_days)
    rows = (
        await db.execute(
            text(
                """
                select
                    date_trunc('day', created_at)::date as day,
                    count(*)::int as clicks,
                    coalesce(sum(billed_amount), 0)::numeric as spend_uzs
                from b2b_click_events
                where org_id = :org_id
                  and created_at >= :since
                group by 1
                order by 1 asc
                """
            ),
            {"org_id": org_id, "since": since},
        )
    ).mappings().all()
    return [
        SellerDashboardChartPoint(
            date=str(item["day"]),
            clicks=int(item["clicks"]),
            spend_uzs=float(item["spend_uzs"] or 0.0),
        )
        for item in rows
    ]


@router.get("/dashboard/alerts", response_model=SellerDashboardAlertsOut)
async def seller_dashboard_alerts(
    request: Request,
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="seller-dashboard-read", limit=240)
    org_id = await _resolve_primary_org_id(db, user_uuid=str(current_user.get("id")))
    if org_id is None:
        return SellerDashboardAlertsOut(alerts=[{"code": "no_org", "severity": "warning", "message": "Seller organization not found"}])

    alerts: list[dict] = []
    overdue_invoices = int(
        (
            await db.execute(
                text(
                    """
                    select count(*)::int
                    from b2b_invoices
                    where org_id = :org_id
                      and status in ('issued', 'overdue')
                      and due_at is not null
                      and due_at < now()
                    """
                ),
                {"org_id": org_id},
            )
        ).scalar_one()
        or 0
    )
    if overdue_invoices > 0:
        alerts.append(
            {
                "code": "billing_overdue",
                "severity": "critical",
                "message": f"{overdue_invoices} overdue invoice(s)",
            }
        )

    feed_errors = int(
        (
            await db.execute(
                text(
                    """
                    select count(*)::int
                    from b2b_feed_sources
                    where org_id = :org_id
                      and status = 'error'
                    """
                ),
                {"org_id": org_id},
            )
        ).scalar_one()
        or 0
    )
    if feed_errors > 0:
        alerts.append(
            {
                "code": "feed_errors",
                "severity": "warning",
                "message": f"{feed_errors} feed source(s) in error state",
            }
        )

    return SellerDashboardAlertsOut(alerts=alerts)
