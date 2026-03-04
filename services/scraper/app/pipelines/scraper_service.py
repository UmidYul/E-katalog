from __future__ import annotations

from app.core.config import settings
from app.core.errors import UpstreamRateLimitedError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.db.models import Shop
from app.parsers.base import StoreParser
from app.pipelines.product_service import ProductService
from app.utils.domain_limiter import DomainLimiter


class ScraperService:
    def __init__(
        self,
        session: AsyncSession,
        parser: StoreParser,
    ) -> None:
        self._session = session
        self._parser = parser
        self._product_service = ProductService(session)
        self._domain_limiter = DomainLimiter()

    async def scrape_categories(self, category_urls: list[str]) -> None:
        shop = await self._product_service.get_or_create_shop(name=self._parser.shop_name, url=self._parser.shop_url)
        product_limit = max(0, settings.scrape_product_limit)
        processed = 0

        for category_url in category_urls:
            if product_limit and processed >= product_limit:
                break
            try:
                async with self._domain_limiter.acquire(category_url):
                    links = await self._parser.discover_product_links(category_url)
            except UpstreamRateLimitedError as exc:
                logger.warning(
                    "upstream_rate_limited_skip_category",
                    category_url=category_url,
                    error=str(exc),
                )
                continue
            except Exception as exc:  # noqa: BLE001
                logger.error("category_discovery_failed", category_url=category_url, error=str(exc))
                continue
            if product_limit:
                remaining = max(0, product_limit - processed)
                links = links[:remaining]
            logger.info("category_links_discovered", category_url=category_url, count=len(links))
            category_rate_limited = False
            for link in links:
                if await self._parse_and_upsert(link, shop):
                    logger.warning(
                        "upstream_rate_limited_skip_remaining_category",
                        product_url=link,
                        error="cloudflare_1015",
                    )
                    category_rate_limited = True
                    break
                processed += 1
                if product_limit and processed >= product_limit:
                    break
            if category_rate_limited:
                continue

        await self._session.commit()

    async def _parse_and_upsert(self, product_url: str, shop: Shop) -> bool:
        async with self._domain_limiter.acquire(product_url):
            try:
                parsed = await self._parser.parse_product(product_url)
                await self._product_service.upsert_offer(parsed=parsed, shop=shop)
                logger.info("product_upserted", product_url=product_url)
                return False
            except UpstreamRateLimitedError as exc:
                logger.error("upstream_rate_limited_product", product_url=product_url, error=str(exc))
                return True
            except ValueError as exc:
                if str(exc).lower() == "price not found":
                    logger.warning("product_skipped_no_price", product_url=product_url)
                    return False
                logger.error("product_parse_failed", product_url=product_url, error=str(exc))
                return False
            except Exception as exc:  # noqa: BLE001
                logger.error("product_parse_failed", product_url=product_url, error=str(exc))
                return False
