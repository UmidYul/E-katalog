from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session
from app.core.config import settings
from app.repositories.catalog import CatalogRepository

router = APIRouter(prefix="/filters", tags=["filters"])


@router.get("")
async def get_filters(
    category_id: int | None = None,
    q: str | None = Query(default=None, min_length=1, max_length=200),
    db: AsyncSession = Depends(get_db_session),
):
    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.get_filter_buckets(category_id=category_id, q=q)
