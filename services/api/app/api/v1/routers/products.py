from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import enforce_rate_limit
from app.api.idempotency import execute_idempotent_json
from app.api.deps import get_db_session, get_redis
from app.api.v1.routers.auth import get_current_user
from app.schemas.catalog import (
    CanonicalProductDetailOut,
    OfferOut,
    PriceHistoryPoint,
    ProductPriceAlertOut,
    ProductPriceAlertUpsertIn,
    SearchResponse,
)
from app.cache.redis_cache import CacheService
from app.core.config import settings
from app.repositories.catalog import CatalogRepository
from shared.db.models import CatalogPriceAlert

router = APIRouter(prefix="/products", tags=["products"])
UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"


def _as_decimal(value: float | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _user_uuid_from_current(current_user: dict) -> str:
    user_uuid = str(current_user.get("id") or "").strip().lower()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="invalid user session")
    return user_uuid


def _build_price_alert_response(alert: CatalogPriceAlert, *, product_uuid: str) -> ProductPriceAlertOut:
    updated_at = alert.updated_at or datetime.now(UTC)
    return ProductPriceAlertOut(
        id=str(alert.uuid),
        product_id=product_uuid,
        channel=str(alert.channel),
        alerts_enabled=bool(alert.alerts_enabled),
        baseline_price=_to_float(alert.baseline_price),
        target_price=_to_float(alert.target_price),
        last_seen_price=_to_float(alert.last_seen_price),
        last_notified_at=alert.last_notified_at.isoformat() if alert.last_notified_at else None,
        updated_at=updated_at.isoformat(),
    )


@router.get("", response_model=SearchResponse)
async def list_products(
    request: Request,
    category_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    brand_id: list[str] | None = Query(default=None),
    store_id: list[str] | None = Query(default=None),
    seller_id: list[str] | None = Query(default=None),
    min_price: float | None = None,
    max_price: float | None = None,
    max_delivery_days: int | None = Query(default=None, ge=0, le=30),
    in_stock: bool | None = None,
    sort: str = Query(default="popular", pattern="^(relevance|price_asc|price_desc|popular|newest)$"),
    limit: int = Query(default=24, ge=1, le=100),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="products", limit=120)

    cache = CacheService(redis)
    cache_key = CacheService.key(
        "plp",
        {
            "category_id": category_id,
            "brand_id": brand_id,
            "min_price": min_price,
            "max_price": max_price,
            "max_delivery_days": max_delivery_days,
            "in_stock": in_stock,
            "store_id": store_id,
            "seller_id": seller_id,
            "sort": sort,
            "limit": limit,
            "cursor": cursor,
        },
    )
    cached = await cache.get_json(cache_key)
    if cached is not None:
        cached["request_id"] = request.state.request_id
        return cached

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    resolved_category_id = await repo.resolve_entity_ref("category", category_id)
    if category_id is not None and resolved_category_id is None:
        raise HTTPException(status_code=422, detail="category_id is invalid")
    resolved_brand_ids = await repo.resolve_entity_refs("brand", brand_id)
    if brand_id is not None and not resolved_brand_ids:
        return {"items": [], "next_cursor": None, "request_id": request.state.request_id}
    resolved_store_ids = await repo.resolve_entity_refs("store", store_id)
    if store_id is not None and not resolved_store_ids:
        return {"items": [], "next_cursor": None, "request_id": request.state.request_id}
    resolved_seller_ids = await repo.resolve_entity_refs("seller", seller_id)
    if seller_id is not None and not resolved_seller_ids:
        return {"items": [], "next_cursor": None, "request_id": request.state.request_id}

    items, next_cursor = await repo.search_products(
        q=None,
        category_id=resolved_category_id,
        brand_ids=resolved_brand_ids,
        min_price=min_price,
        max_price=max_price,
        in_stock=in_stock,
        store_ids=resolved_store_ids,
        seller_ids=resolved_seller_ids,
        max_delivery_days=max_delivery_days,
        sort=sort,
        limit=limit,
        cursor=cursor,
    )

    result = {"items": items, "next_cursor": next_cursor, "request_id": request.state.request_id}
    await cache.set_json(cache_key, result, ttl_seconds=120)
    return result


@router.get("/{product_id}", response_model=CanonicalProductDetailOut)
async def get_product(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="products", limit=120)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    resolved_product_id = await repo.resolve_product_with_offers(product_id)
    if resolved_product_id is None:
        raise HTTPException(status_code=404, detail="product not found")

    cache = CacheService(redis)
    cache_key = f"pdp:{resolved_product_id}"
    cached = await cache.get_json(cache_key)
    if cached is not None:
        return cached

    product = await repo.get_product(resolved_product_id)
    if not product:
        raise HTTPException(status_code=404, detail="product not found")
    target_product_id = int(product.get("legacy_id") or resolved_product_id)
    offers_by_store = await repo.get_offers_by_store(product_id=target_product_id, limit=150, in_stock=None, sort="price")

    payload = {
        "id": product["id"],
        "title": product["title"],
        "category": product["category"],
        "brand": product["brand"],
        "main_image": product["main_image"],
        "gallery_images": product.get("gallery_images", []),
        "short_description": product.get("short_description"),
        "whats_new": product.get("whats_new", []),
        "specs": product["specs"],
        "offers_by_store": offers_by_store,
    }
    await cache.set_json(cache_key, payload, ttl_seconds=60)
    return payload


@router.post("/{product_id}/alerts", response_model=ProductPriceAlertOut)
async def upsert_product_price_alert(
    request: Request,
    payload: ProductPriceAlertUpsertIn,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="price-alerts-write", limit=90)
    async def _op():
        repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
        product = await repo.get_product(product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="product not found")

        product_uuid = str(product["id"])
        product_internal_id = int(product["legacy_id"])
        user_uuid = _user_uuid_from_current(current_user)
        channel = str(payload.channel or "telegram").strip().lower()
        now = datetime.now(UTC)
        fields_set = payload.model_fields_set

        current_price = payload.current_price
        if current_price is None:
            compare_meta = await repo.get_product_compare_meta(product_internal_id)
            price_min = compare_meta.get("price_min")
            current_price = float(price_min) if price_min is not None else None

        stmt = (
            select(CatalogPriceAlert)
            .where(CatalogPriceAlert.user_uuid == user_uuid)
            .where(CatalogPriceAlert.product_id == product_internal_id)
            .where(CatalogPriceAlert.channel == channel)
            .limit(1)
        )
        alert = (await db.execute(stmt)).scalar_one_or_none()
        if alert is None:
            alert = CatalogPriceAlert(
                user_uuid=user_uuid,
                product_id=product_internal_id,
                channel=channel,
                alerts_enabled=payload.alerts_enabled if payload.alerts_enabled is not None else True,
                baseline_price=_as_decimal(payload.baseline_price if "baseline_price" in fields_set else current_price),
                target_price=_as_decimal(payload.target_price if "target_price" in fields_set else None),
                last_seen_price=_as_decimal(current_price),
                created_at=now,
                updated_at=now,
            )
            db.add(alert)
        else:
            if "alerts_enabled" in fields_set and payload.alerts_enabled is not None:
                alert.alerts_enabled = bool(payload.alerts_enabled)
            if "target_price" in fields_set:
                alert.target_price = _as_decimal(payload.target_price)
            if "baseline_price" in fields_set:
                alert.baseline_price = _as_decimal(payload.baseline_price)
            if current_price is not None:
                alert.last_seen_price = _as_decimal(current_price)
                if "baseline_price" not in fields_set and alert.baseline_price is None:
                    alert.baseline_price = _as_decimal(current_price)
            alert.updated_at = now

        await db.commit()
        await db.refresh(alert)
        return _build_price_alert_response(alert, product_uuid=product_uuid)

    user_uuid = _user_uuid_from_current(current_user)
    return await execute_idempotent_json(
        request,
        redis,
        scope=f"products.alerts.upsert:{user_uuid}:{product_id.lower()}",
        handler=_op,
    )


@router.get("/{product_id}/offers", response_model=list[OfferOut])
async def get_product_offers(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    in_stock: bool | None = None,
    store_id: list[str] | None = Query(default=None),
    seller_id: list[str] | None = Query(default=None),
    max_delivery_days: int | None = Query(default=None, ge=0, le=30),
    sort: str = Query(default="price", pattern="^(price|seller_rating|delivery)$"),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="offers", limit=120)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    resolved_product_id = await repo.resolve_product_with_offers(product_id)
    if resolved_product_id is None:
        raise HTTPException(status_code=404, detail="product not found")
    resolved_store_ids = await repo.resolve_entity_refs("store", store_id)
    if store_id is not None and not resolved_store_ids:
        return []
    resolved_seller_ids = await repo.resolve_entity_refs("seller", seller_id)
    if seller_id is not None and not resolved_seller_ids:
        return []

    return await repo.get_offers(
        product_id=resolved_product_id,
        limit=limit,
        in_stock=in_stock,
        sort=sort,
        store_ids=resolved_store_ids,
        seller_ids=resolved_seller_ids,
        max_delivery_days=max_delivery_days,
    )


@router.get("/{product_id}/price-history", response_model=list[PriceHistoryPoint])
async def get_product_history(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="history", limit=120)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    resolved_product_id = await repo.resolve_product_with_offers(product_id)
    if resolved_product_id is None:
        raise HTTPException(status_code=404, detail="product not found")
    return await repo.price_history(product_id=resolved_product_id, days=days)
