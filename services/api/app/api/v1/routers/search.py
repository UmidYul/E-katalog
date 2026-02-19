from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.core.rate_limit import enforce_rate_limit
from app.api.deps import get_db_session, get_redis
from app.schemas.catalog import SearchResponse
from app.cache.redis_cache import CacheService
from app.core.config import settings
from app.repositories.catalog import CatalogRepository

router = APIRouter(tags=["search"])


@router.get("/search", response_model=SearchResponse)
async def search(
    request: Request,
    q: str | None = Query(default=None, min_length=1, max_length=200),
    category_id: int | None = None,
    brand_id: list[int] | None = Query(default=None),
    min_price: float | None = None,
    max_price: float | None = None,
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
            "in_stock": in_stock,
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
        q=q,
        category_id=category_id,
        brand_ids=brand_id,
        min_price=min_price,
        max_price=max_price,
        in_stock=in_stock,
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
