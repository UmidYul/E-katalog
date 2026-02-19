from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session
from app.schemas.catalog import SearchResponse
from shared.db.models import CatalogCategory
from app.repositories.catalog import CatalogRepository
from app.core.config import settings

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("")
async def list_categories(db: AsyncSession = Depends(get_db_session)):
    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.list_categories()


@router.get("/{slug}/products", response_model=SearchResponse)
async def list_category_products(
    slug: str,
    request: Request,
    limit: int = Query(default=24, ge=1, le=100),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db_session),
):
    category_id = (
        await db.execute(select(CatalogCategory.id).where(CatalogCategory.slug == slug, CatalogCategory.is_active.is_(True)))
    ).scalar_one_or_none()
    if category_id is None:
        raise HTTPException(status_code=404, detail="category not found")
    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    items, next_cursor = await repo.search_products(
        q=None,
        category_id=category_id,
        brand_ids=None,
        min_price=None,
        max_price=None,
        in_stock=None,
        store_ids=None,
        seller_ids=None,
        max_delivery_days=None,
        sort="popular",
        limit=limit,
        cursor=cursor,
    )
    return {"items": items, "next_cursor": next_cursor, "request_id": request.state.request_id}
