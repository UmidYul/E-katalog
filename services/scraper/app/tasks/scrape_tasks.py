from __future__ import annotations

import asyncio

from app.core.config import settings
from app.core.logging import configure_logging, logger
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.parsers.factory import build_scrape_targets
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
    return asyncio.run(_run_marketplace_scrape())


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
                    max_concurrency=max(1, settings.request_concurrency),
                    inter_request_delay_seconds=max(0.0, settings.scrape_inter_request_delay_seconds),
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
