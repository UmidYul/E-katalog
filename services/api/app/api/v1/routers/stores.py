from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session
from app.core.config import settings
from app.repositories.catalog import CatalogRepository

router = APIRouter(prefix="/stores", tags=["stores"])


@router.get("")
async def list_stores(active_only: bool = True, db: AsyncSession = Depends(get_db_session)):
    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.list_stores(active_only=active_only)
