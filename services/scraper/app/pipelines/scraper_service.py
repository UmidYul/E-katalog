from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.db.models import Shop
from app.parsers.base import StoreParser
from app.pipelines.product_service import ProductService


class ScraperService:
    def __init__(self, session: AsyncSession, parser: StoreParser, *, max_concurrency: int = 10) -> None:
        self._session = session
        self._parser = parser
        self._product_service = ProductService(session)
        self._semaphore = asyncio.Semaphore(max_concurrency)

    async def scrape_categories(self, category_urls: list[str]) -> None:
        shop = await self._product_service.get_or_create_shop(name=self._parser.shop_name, url=self._parser.shop_url)

        for category_url in category_urls:
            try:
                links = await self._parser.discover_product_links(category_url)
            except Exception as exc:  # noqa: BLE001
                logger.error("category_discovery_failed", category_url=category_url, error=str(exc))
                continue
            logger.info("category_links_discovered", category_url=category_url, count=len(links))
            for link in links:
                await self._parse_and_upsert(link, shop)

        await self._session.commit()

    async def _parse_and_upsert(self, product_url: str, shop: Shop) -> None:
        async with self._semaphore:
            try:
                parsed = await self._parser.parse_product(product_url)
                await self._product_service.upsert_offer(parsed=parsed, shop=shop)
                logger.info("product_upserted", product_url=product_url)
            except Exception as exc:  # noqa: BLE001
                logger.error("product_parse_failed", product_url=product_url, error=str(exc))
