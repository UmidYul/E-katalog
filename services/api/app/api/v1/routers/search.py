from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import enforce_rate_limit
from app.api.deps import get_db_session, get_redis
from app.schemas.catalog import SearchResponse
from app.cache.redis_cache import CacheService
from app.core.config import settings
from app.repositories.catalog import CatalogRepository

router = APIRouter(tags=["search"])
UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"


@router.get("/search", response_model=SearchResponse)
async def search(
    request: Request,
    q: str | None = Query(default=None, min_length=1, max_length=200),
    category_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    brand_id: list[str] | None = Query(default=None),
    store_id: list[str] | None = Query(default=None),
    seller_id: list[str] | None = Query(default=None),
    min_price: float | None = None,
    max_price: float | None = None,
    max_delivery_days: int | None = Query(default=None, ge=0, le=30),
    in_stock: bool | None = None,
    sort: str = Query(default="relevance", pattern="^(relevance|price_asc|price_desc|popular|newest)$"),
    limit: int = Query(default=24, ge=1, le=100),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="search", limit=60)

    cache = CacheService(redis)
    cache_key = CacheService.key(
        "search",
        {
            "q": q,
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
        return {"items": [], "next_cursor": None, "request_id": request.state.request_id}
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
        q=q,
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

    result = {
        "items": items,
        "next_cursor": next_cursor,
        "request_id": request.state.request_id,
    }
    await cache.set_json(cache_key, result, ttl_seconds=120)
    return result
