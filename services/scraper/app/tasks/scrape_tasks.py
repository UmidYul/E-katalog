from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.core.config import settings
from app.core.asyncio_runner import run_async_task
from app.core.logging import configure_logging, logger
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.parsers.factory import build_parser, build_scrape_targets
from app.pipelines.catalog_sync import sync_legacy_to_catalog
from app.pipelines.scraper_service import ScraperService
from app.tasks.celery_app import celery_app

configure_logging(settings.log_level)


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=settings.task_retry_backoff_max_seconds,
    retry_jitter=True,
    max_retries=settings.max_retries,
)
def enqueue_example_store_scrape(self) -> str:
    return run_async_task(_run_marketplace_scrape())


def _enqueue_post_scrape_pipeline() -> str:
    result = celery_app.send_task(
        "app.tasks.scrape_tasks.enqueue_ingested_products_pipeline",
        queue="normalize",
        routing_key="normalize",
    )
    return str(result.id)


async def _run_marketplace_scrape() -> str:
    await init_db()

    async with AsyncSessionLocal() as session:
        targets = await build_scrape_targets(session)
        stores_total = len(targets)
        stores_completed = 0
        stores_failed = 0
        for target in targets:
            try:
                service = ScraperService(
                    session,
                    target.parser,
                )
                await service.scrape_categories(target.category_urls)
                stores_completed += 1
                logger.info(
                    "store_scrape_completed",
                    provider=target.provider,
                    store=target.store_name,
                    categories=len(target.category_urls),
                )
            except Exception as exc:  # noqa: BLE001
                stores_failed += 1
                logger.error(
                    "store_scrape_failed",
                    provider=target.provider,
                    store=target.store_name,
                    categories=len(target.category_urls),
                    error=str(exc),
                )
            finally:
                await target.parser.aclose()

        if settings.legacy_write_enabled:
            await sync_legacy_to_catalog(session)

    workflow_id = _enqueue_post_scrape_pipeline()
    logger.info(
        "scrape_completed",
        stores_total=stores_total,
        stores_completed=stores_completed,
        stores_failed=stores_failed,
        post_scrape_workflow_id=workflow_id,
    )
    return "ok"


async def _run_example_store_scrape() -> str:
    # Backward compatibility for old entrypoints/calls.
    return await _run_marketplace_scrape()


async def _run_scrape_targets(targets: list[dict[str, Any]]) -> dict[str, Any]:
    await init_db()
    target_rows = targets if isinstance(targets, list) else []
    stores_payload: list[dict[str, Any]] = []
    processed_urls_total = 0
    failed_urls_total = 0
    processed_by_store: dict[int, int] = defaultdict(int)
    failed_by_store: dict[int, int] = defaultdict(int)

    async with AsyncSessionLocal() as session:
        for target in target_rows:
            store_id = int(target.get("store_id") or 0)
            store_name = str(target.get("store_name") or f"store-{store_id}")
            provider = str(target.get("provider") or "generic")
            base_url = str(target.get("base_url") or "").strip() or None
            urls = [str(url).strip() for url in (target.get("category_urls") or []) if str(url).strip()]

            parser = build_parser(provider)
            if store_name:
                parser.shop_name = store_name
            if base_url:
                parser.shop_url = base_url

            service = ScraperService(
                session,
                parser,
            )

            store_url_results: list[dict[str, Any]] = []
            for category_url in urls:
                try:
                    await service.scrape_categories([category_url])
                    store_url_results.append({"url": category_url, "status": "done", "error": None})
                    processed_urls_total += 1
                    processed_by_store[store_id] += 1
                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        "target_category_scrape_failed",
                        store_id=store_id,
                        provider=provider,
                        category_url=category_url,
                        error=str(exc),
                    )
                    store_url_results.append({"url": category_url, "status": "failed", "error": str(exc)})
                    failed_urls_total += 1
                    failed_by_store[store_id] += 1

            await parser.aclose()
            stores_payload.append(
                {
                    "store_id": store_id,
                    "store_name": store_name,
                    "provider": provider,
                    "total_urls": len(urls),
                    "processed_urls": int(processed_by_store[store_id]),
                    "failed_urls": int(failed_by_store[store_id]),
                    "url_results": store_url_results,
                }
            )

        if settings.legacy_write_enabled:
            await sync_legacy_to_catalog(session)

    return {
        "status": "ok",
        "stores": stores_payload,
        "processed_urls": processed_urls_total,
        "failed_urls": failed_urls_total,
    }


@celery_app.task(
    bind=True,
    name="app.tasks.scrape_tasks.run_scrape_targets",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=settings.task_retry_backoff_max_seconds,
    retry_jitter=True,
    max_retries=settings.max_retries,
)
def run_scrape_targets(self, targets: list[dict[str, Any]]) -> dict[str, Any]:
    return run_async_task(_run_scrape_targets(targets))

