from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import enforce_rate_limit
from app.api.deps import get_db_session, get_redis
from app.schemas.catalog import CanonicalProductDetailOut, OfferOut, PriceHistoryPoint, SearchResponse
from app.cache.redis_cache import CacheService
from app.core.config import settings
from app.repositories.catalog import CatalogRepository

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=SearchResponse)
async def list_products(
    request: Request,
    category_id: int | None = None,
    brand_id: list[int] | None = Query(default=None),
    store_id: list[int] | None = Query(default=None),
    seller_id: list[int] | None = Query(default=None),
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
    items, next_cursor = await repo.search_products(
        q=None,
        category_id=category_id,
        brand_ids=brand_id,
        min_price=min_price,
        max_price=max_price,
        in_stock=in_stock,
        store_ids=store_id,
        seller_ids=seller_id,
        max_delivery_days=max_delivery_days,
        sort=sort,
        limit=limit,
        cursor=cursor,
    )

    result = {"items": items, "next_cursor": next_cursor, "request_id": request.state.request_id}
    await cache.set_json(cache_key, result, ttl_seconds=120)
    return result


@router.get("/{product_id}", response_model=CanonicalProductDetailOut)
async def get_product(product_id: int, request: Request, db: AsyncSession = Depends(get_db_session)):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="products", limit=120)

    cache = CacheService(redis)
    cache_key = f"pdp:{product_id}"
    cached = await cache.get_json(cache_key)
    if cached is not None:
        return cached

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    product = await repo.get_product(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="product not found")
    offers_by_store = await repo.get_offers_by_store(product_id=product_id, limit=150, in_stock=None, sort="price")

    payload = {
        "id": product["id"],
        "title": product["title"],
        "category": product["category"],
        "brand": product["brand"],
        "main_image": product["main_image"],
        "specs": product["specs"],
        "offers_by_store": offers_by_store,
    }
    await cache.set_json(cache_key, payload, ttl_seconds=60)
    return payload


@router.get("/{product_id}/offers", response_model=list[OfferOut])
async def get_product_offers(
    product_id: int,
    request: Request,
    in_stock: bool | None = None,
    store_id: list[int] | None = Query(default=None),
    seller_id: list[int] | None = Query(default=None),
    max_delivery_days: int | None = Query(default=None, ge=0, le=30),
    sort: str = Query(default="price", pattern="^(price|seller_rating|delivery)$"),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="offers", limit=120)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.get_offers(
        product_id=product_id,
        limit=limit,
        in_stock=in_stock,
        sort=sort,
        store_ids=store_id,
        seller_ids=seller_id,
        max_delivery_days=max_delivery_days,
    )


@router.get("/{product_id}/price-history", response_model=list[PriceHistoryPoint])
async def get_product_history(
    product_id: int,
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="history", limit=120)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.price_history(product_id=product_id, days=days)
