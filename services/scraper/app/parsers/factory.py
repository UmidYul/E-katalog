from __future__ import annotations

from urllib.parse import urljoin

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.parsers.base import StoreParser
from app.parsers.example_store import ExampleStoreParser
from app.parsers.mediapark import MediaParkParser
from app.parsers.texnomart import TexnomartParser


def build_parser() -> StoreParser:
    if settings.scraper_provider == "mediapark":
        return MediaParkParser()
    if settings.scraper_provider == "texnomart":
        return TexnomartParser()
    if settings.scraper_provider == "example":
        return ExampleStoreParser()
    raise ValueError(f"unsupported scraper_provider: {settings.scraper_provider}")


async def build_category_urls(session: AsyncSession) -> list[str]:
    try:
        rows = (
            await session.execute(
                text(
                    """
                    select ss.url
                    from catalog_scrape_sources ss
                    join catalog_stores s on s.id = ss.store_id
                    where ss.is_active = true
                      and s.is_active = true
                      and (s.provider = :provider or s.provider = 'generic')
                    order by ss.priority asc, ss.id asc
                    """
                ),
                {"provider": settings.scraper_provider},
            )
        ).scalars().all()
        if rows:
            return [str(url) for url in rows]
    except ProgrammingError:
        # Backward-compatible fallback for environments where latest catalog tables are not migrated yet.
        pass

    if settings.scraper_provider == "mediapark":
        base_url = str(settings.mediapark_base_url).rstrip("/") + "/"
        return [urljoin(base_url, path.lstrip("/")) for path in settings.mediapark_category_paths]
    if settings.scraper_provider == "texnomart":
        base_url = str(settings.texnomart_base_url).rstrip("/") + "/"
        return [urljoin(base_url, path.lstrip("/")) for path in settings.texnomart_category_paths]

    base_url = str(settings.example_store_base_url).rstrip("/") + "/"
    return [urljoin(base_url, path.lstrip("/")) for path in settings.example_store_category_paths]
