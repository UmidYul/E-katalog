from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urljoin

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import logger
from app.parsers.alifshop import AlifshopParser
from app.parsers.asaxiy import AsaxiyParser
from app.parsers.base import StoreParser
from app.parsers.example_store import ExampleStoreParser
from app.parsers.mediapark import MediaParkParser
from app.parsers.texnomart import TexnomartParser


@dataclass(slots=True)
class ScrapeTarget:
    provider: str
    store_id: int | None
    store_name: str
    store_base_url: str | None
    category_urls: list[str]
    parser: StoreParser


def _normalize_provider(provider: str | None, *, base_url: str | None = None, store_name: str | None = None) -> str:
    value = (provider or "").strip().lower()
    if value in {"mediapark", "texnomart", "alifshop", "asaxiy", "example"}:
        return value

    hints = " ".join(part for part in [base_url or "", store_name or "", value] if part).lower()
    if "mediapark" in hints:
        return "mediapark"
    if "texnomart" in hints:
        return "texnomart"
    if "alifshop" in hints:
        return "alifshop"
    if "asaxiy" in hints:
        return "asaxiy"
    return "example"


def build_parser(provider: str | None = None) -> StoreParser:
    resolved = _normalize_provider(provider or settings.scraper_provider)
    if resolved == "mediapark":
        return MediaParkParser()
    if resolved == "texnomart":
        return TexnomartParser()
    if resolved == "alifshop":
        return AlifshopParser()
    if resolved == "asaxiy":
        return AsaxiyParser()
    if resolved == "example":
        return ExampleStoreParser()
    raise ValueError(f"unsupported scraper_provider: {provider}")


def _fallback_category_urls(provider: str) -> list[str]:
    if provider == "mediapark":
        base_url = str(settings.mediapark_base_url).rstrip("/") + "/"
        return [urljoin(base_url, path.lstrip("/")) for path in settings.mediapark_category_paths]
    if provider == "texnomart":
        base_url = str(settings.texnomart_base_url).rstrip("/") + "/"
        return [urljoin(base_url, path.lstrip("/")) for path in settings.texnomart_category_paths]
    if provider == "alifshop":
        base_url = str(settings.alifshop_base_url).rstrip("/") + "/"
        return [urljoin(base_url, path.lstrip("/")) for path in settings.alifshop_category_paths]
    if provider == "asaxiy":
        base_url = str(settings.asaxiy_base_url).rstrip("/") + "/"
        return [urljoin(base_url, path.lstrip("/")) for path in settings.asaxiy_category_paths]

    base_url = str(settings.example_store_base_url).rstrip("/") + "/"
    return [urljoin(base_url, path.lstrip("/")) for path in settings.example_store_category_paths]


def _override_parser_store(parser: StoreParser, *, store_name: str | None, store_base_url: str | None) -> None:
    if store_name:
        parser.shop_name = store_name
    if store_base_url:
        parser.shop_url = store_base_url


async def build_category_urls(session: AsyncSession, provider: str | None = None) -> list[str]:
    resolved = _normalize_provider(provider or settings.scraper_provider)
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
                {"provider": resolved},
            )
        ).scalars().all()
        if rows:
            return [str(url) for url in rows]
    except ProgrammingError:
        await session.rollback()

    return _fallback_category_urls(resolved)


async def build_scrape_targets(session: AsyncSession) -> list[ScrapeTarget]:
    try:
        rows = (
            await session.execute(
                text(
                    """
                    select
                      s.id as store_id,
                      s.name as store_name,
                      s.provider as provider,
                      s.base_url as base_url,
                      ss.url as source_url
                    from catalog_stores s
                    join catalog_scrape_sources ss on ss.store_id = s.id
                    where s.is_active = true
                      and ss.is_active = true
                    order by s.crawl_priority asc, s.id asc, ss.priority asc, ss.id asc
                    """
                )
            )
        ).mappings().all()

        if rows:
            grouped: dict[int, dict[str, object]] = {}
            order: list[int] = []
            for row in rows:
                store_id = int(row["store_id"])
                entry = grouped.get(store_id)
                if entry is None:
                    entry = {
                        "provider": str(row.get("provider") or "generic"),
                        "store_name": str(row.get("store_name") or f"store-{store_id}"),
                        "base_url": str(row.get("base_url") or "") or None,
                        "urls": [],
                    }
                    grouped[store_id] = entry
                    order.append(store_id)
                url = str(row.get("source_url") or "").strip()
                if url:
                    cast_urls = entry["urls"]
                    if isinstance(cast_urls, list) and url not in cast_urls:
                        cast_urls.append(url)

            targets: list[ScrapeTarget] = []
            for store_id in order:
                entry = grouped[store_id]
                provider = _normalize_provider(
                    str(entry["provider"]),
                    base_url=entry["base_url"] if isinstance(entry["base_url"], str) else None,
                    store_name=entry["store_name"] if isinstance(entry["store_name"], str) else None,
                )
                urls = [str(item) for item in entry["urls"] if isinstance(item, str)]
                if not urls:
                    continue
                parser = build_parser(provider)
                _override_parser_store(
                    parser,
                    store_name=entry["store_name"] if isinstance(entry["store_name"], str) else None,
                    store_base_url=entry["base_url"] if isinstance(entry["base_url"], str) else None,
                )
                targets.append(
                    ScrapeTarget(
                        provider=provider,
                        store_id=store_id,
                        store_name=str(entry["store_name"]),
                        store_base_url=entry["base_url"] if isinstance(entry["base_url"], str) else None,
                        category_urls=urls,
                        parser=parser,
                    )
                )

            if targets:
                return targets
    except ProgrammingError:
        await session.rollback()

    fallback_provider = _normalize_provider(settings.scraper_provider)
    parser = build_parser(fallback_provider)
    fallback_urls = _fallback_category_urls(fallback_provider)
    logger.warning(
        "scrape_targets_fallback_to_env",
        provider=fallback_provider,
        categories=len(fallback_urls),
    )
    return [
        ScrapeTarget(
            provider=fallback_provider,
            store_id=None,
            store_name=parser.shop_name,
            store_base_url=parser.shop_url,
            category_urls=fallback_urls,
            parser=parser,
        )
    ]
