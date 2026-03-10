from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import UpstreamRateLimitedError
from app.core.logging import logger
from app.db.models import Shop
from app.parsers.base import StoreParser
from app.pipelines.product_service import ProductService
from app.utils.domain_limiter import DomainLimiter


ProductStatus = Literal["done", "invalid", "quarantined", "rate_limited", "failed"]
CategoryStatus = Literal["done", "failed", "rate_limited", "quarantined", "invalid"]


@dataclass(slots=True)
class CategoryScrapeResult:
    url: str
    status: CategoryStatus
    processed_products: int = 0
    failed_products: int = 0
    invalid_products: int = 0
    quarantined_products: int = 0
    rate_limited_products: int = 0
    unknown_products: int = 0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "status": self.status,
            "processed_products": int(self.processed_products),
            "failed_products": int(self.failed_products),
            "invalid_products": int(self.invalid_products),
            "quarantined_products": int(self.quarantined_products),
            "rate_limited_products": int(self.rate_limited_products),
            "unknown_products": int(self.unknown_products),
            "error": self.error,
        }


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
        if any(
            token in source
            for token in (
                "holodil",
                "stiral",
                "pylesos",
                "mikrovoln",
                "duhov",
                "plita",
                "vacuum",
                "washer",
                "appliance",
                "kondits",
                "conditioner",
            )
        ):
            return "appliances"
        if any(token in source for token in ("camera", "kamera", "fotoapparat", "gopro", "dslr", "lens", "obektiv")):
            return "cameras"
        if any(token in source for token in ("telev", "televizor", "tv", "oled", "qled")):
            return "tvs"
        if any(token in source for token in ("watch", "soat", "saat", "СѓРјРЅС‹Рµ-С‡Р°СЃС‹", "smart-watch")):
            return "watches"
        if any(token in source for token in ("noutbuk", "laptop", "notebook")):
            return "laptops"
        if any(token in source for token in ("planshet", "tablet", "ipad")):
            return "tablets"
        if any(token in source for token in ("smartfon", "smartphone", "iphone", "galaxy")):
            return "phones"
        return None

    @staticmethod
    def _resolve_category_status(result: CategoryScrapeResult) -> CategoryStatus:
        if result.rate_limited_products > 0:
            return "rate_limited"
        if result.failed_products > 0:
            return "failed"
        if result.quarantined_products > 0:
            return "quarantined"
        if result.invalid_products > 0:
            return "invalid"
        return "done"

    async def scrape_categories(self, category_urls: list[str]) -> dict[str, Any]:
        shop = await self._product_service.get_or_create_shop(name=self._parser.shop_name, url=self._parser.shop_url)
        product_limit = max(0, settings.scrape_product_limit)
        processed = 0
        category_results: list[CategoryScrapeResult] = []

        for category_url in category_urls:
            if product_limit and processed >= product_limit:
                break
            category_result = CategoryScrapeResult(url=category_url, status="done")
            try:
                async with self._domain_limiter.acquire(category_url):
                    links = await self._parser.discover_product_links(category_url)
            except UpstreamRateLimitedError as exc:
                category_result.status = "rate_limited"
                category_result.error = str(exc)
                category_result.rate_limited_products = 1
                category_results.append(category_result)
                logger.warning("upstream_rate_limited_skip_category", category_url=category_url, error=str(exc))
                continue
            except Exception as exc:  # noqa: BLE001
                category_result.status = "failed"
                category_result.error = str(exc)
                category_result.failed_products = 1
                category_results.append(category_result)
                logger.error("category_discovery_failed", category_url=category_url, error=str(exc))
                continue

            if product_limit:
                remaining = max(0, product_limit - processed)
                links = links[:remaining]
            logger.info("category_links_discovered", category_url=category_url, count=len(links))
            category_slug = self._infer_category_slug(category_url)

            for link in links:
                product_result = await self._parse_and_upsert(
                    link,
                    shop,
                    category_slug=category_slug,
                    source_url=category_url,
                )
                status = str(product_result["status"])
                if status == "done":
                    category_result.processed_products += 1
                    processed += 1
                elif status == "invalid":
                    category_result.invalid_products += 1
                elif status == "quarantined":
                    category_result.quarantined_products += 1
                elif status == "rate_limited":
                    category_result.rate_limited_products += 1
                    category_result.error = str(product_result.get("error") or "rate_limited")
                    logger.warning("upstream_rate_limited_skip_remaining_category", product_url=link, error=category_result.error)
                    break
                else:
                    category_result.failed_products += 1
                if str(product_result.get("category_slug") or "").strip().lower() == "unknown":
                    category_result.unknown_products += 1
                if product_limit and processed >= product_limit:
                    break

            category_result.status = self._resolve_category_status(category_result)
            try:
                await self._session.commit()
            except Exception as exc:  # noqa: BLE001
                await self._session.rollback()
                category_result.status = "failed"
                category_result.error = str(exc)
                logger.error("category_commit_failed", category_url=category_url, error=str(exc))
            category_results.append(category_result)

        payload = [item.to_dict() for item in category_results]
        return {
            "category_results": payload,
            "processed_products": sum(item.processed_products for item in category_results),
            "failed_products": sum(item.failed_products for item in category_results),
            "invalid_products": sum(item.invalid_products for item in category_results),
            "quarantined_products": sum(item.quarantined_products for item in category_results),
            "rate_limited_products": sum(item.rate_limited_products for item in category_results),
            "unknown_products": sum(item.unknown_products for item in category_results),
        }

    async def scrape_product_urls(
        self,
        product_urls: list[str],
        *,
        category_slug_override: str | None = None,
        brand_hint_override: str | None = None,
        source_url: str | None = None,
    ) -> dict[str, Any]:
        shop = await self._product_service.get_or_create_shop(name=self._parser.shop_name, url=self._parser.shop_url)
        results: list[dict[str, Any]] = []
        for product_url in product_urls:
            item = await self._parse_and_upsert(
                product_url,
                shop,
                category_slug=category_slug_override,
                brand_hint_override=brand_hint_override,
                source_url=source_url or product_url,
            )
            results.append({"url": product_url, **item})
            try:
                await self._session.commit()
            except Exception as exc:  # noqa: BLE001
                await self._session.rollback()
                results[-1]["status"] = "failed"
                results[-1]["error"] = str(exc)

        return {
            "results": results,
            "done": sum(1 for item in results if item.get("status") == "done"),
            "failed": sum(1 for item in results if item.get("status") == "failed"),
            "invalid": sum(1 for item in results if item.get("status") == "invalid"),
            "quarantined": sum(1 for item in results if item.get("status") == "quarantined"),
            "rate_limited": sum(1 for item in results if item.get("status") == "rate_limited"),
        }

    async def _parse_and_upsert(
        self,
        product_url: str,
        shop: Shop,
        *,
        category_slug: str | None = None,
        brand_hint_override: str | None = None,
        source_url: str | None = None,
    ) -> dict[str, str | None]:
        async with self._domain_limiter.acquire(product_url):
            try:
                async with self._session.begin_nested():
                    parsed = await self._parser.parse_product(product_url)
                    ingest_result = await self._product_service.upsert_offer(
                        parsed=parsed,
                        shop=shop,
                        category_slug=category_slug,
                        brand_hint_override=brand_hint_override,
                        source_url=source_url,
                    )
                logger.info("product_upserted", product_url=product_url, outcome=ingest_result.status)
                return {
                    "status": str(ingest_result.status),
                    "error": ingest_result.reason,
                    "category_slug": ingest_result.category_slug,
                }
            except UpstreamRateLimitedError as exc:
                logger.error("upstream_rate_limited_product", product_url=product_url, error=str(exc))
                return {"status": "rate_limited", "error": str(exc)}
            except ValueError as exc:
                message = str(exc).strip()
                logger.warning("product_parse_invalid", product_url=product_url, error=message)
                return {"status": "invalid", "error": message}
            except Exception as exc:  # noqa: BLE001
                logger.error("product_parse_failed", product_url=product_url, error=str(exc))
                return {"status": "failed", "error": str(exc)}
