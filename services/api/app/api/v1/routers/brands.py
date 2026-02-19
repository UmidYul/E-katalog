from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session
from app.core.config import settings
from app.repositories.catalog import CatalogRepository

router = APIRouter(prefix="/brands", tags=["brands"])


@router.get("")
async def list_brands(
    q: str | None = Query(default=None, min_length=1, max_length=100),
    category_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
):
    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.list_brands(q=q, category_id=category_id, limit=limit)
