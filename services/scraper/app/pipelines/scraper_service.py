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

    @staticmethod
    def _infer_category_slug(category_url: str) -> str | None:
        source = str(category_url or "").strip().lower()
        if not source:
            return None
        if any(token in source for token in ("naush", "headphone", "airpods", "earbud", "buds", "garni")):
            return "headphones"
        if any(token in source for token in ("playstation", "xbox", "nintendo", "ps5", "ps4", "console", "konsol")):
            return "consoles"
        if any(token in source for token in ("holodil", "stiral", "pylesos", "mikrovoln", "duhov", "plita", "vacuum", "washer", "appliance", "kondits", "conditioner")):
            return "appliances"
        if any(token in source for token in ("camera", "kamera", "fotoapparat", "gopro", "dslr", "lens", "obektiv")):
            return "cameras"
        if any(token in source for token in ("telev", "televizor", "tv", "oled", "qled")):
            return "tvs"
        if any(token in source for token in ("watch", "soat", "saat", "умные-часы", "smart-watch")):
            return "watches"
        if any(token in source for token in ("noutbuk", "laptop", "notebook")):
            return "laptops"
        if any(token in source for token in ("planshet", "tablet", "ipad")):
            return "tablets"
        if any(token in source for token in ("smartfon", "smartphone", "iphone", "galaxy")):
            return "phones"
        return None

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
            category_slug = self._infer_category_slug(category_url)
            category_rate_limited = False
            for link in links:
                if await self._parse_and_upsert(link, shop, category_slug=category_slug):
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

    async def _parse_and_upsert(self, product_url: str, shop: Shop, *, category_slug: str | None = None) -> bool:
        async with self._domain_limiter.acquire(product_url):
            try:
                parsed = await self._parser.parse_product(product_url)
                await self._product_service.upsert_offer(parsed=parsed, shop=shop, category_slug=category_slug)
                logger.info("product_upserted", product_url=product_url)
                return False
            except UpstreamRateLimitedError as exc:
                logger.error("upstream_rate_limited_product", product_url=product_url, error=str(exc))
                return True
            except ValueError as exc:
                await self._session.rollback()
                if str(exc).lower() == "price not found":
                    logger.warning("product_skipped_no_price", product_url=product_url)
                    return False
                logger.error("product_parse_failed", product_url=product_url, error=str(exc))
                return False
            except Exception as exc:  # noqa: BLE001
                await self._session.rollback()
                logger.error("product_parse_failed", product_url=product_url, error=str(exc))
                return False
