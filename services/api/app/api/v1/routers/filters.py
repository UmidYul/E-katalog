from __future__ import annotations

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session
from app.core.config import settings
from app.repositories.catalog import CatalogRepository

router = APIRouter(prefix="/filters", tags=["filters"])
UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"


@router.get("")
async def get_filters(
    category_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    q: str | None = Query(default=None, min_length=1, max_length=200),
    db: AsyncSession = Depends(get_db_session),
):
    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    resolved_category_id = await repo.resolve_entity_ref("category", category_id)
    if category_id is not None and resolved_category_id is None:
        raise HTTPException(status_code=422, detail="category_id is invalid")
    return await repo.get_filter_buckets(category_id=resolved_category_id, q=q)
