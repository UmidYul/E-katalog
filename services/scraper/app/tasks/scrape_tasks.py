from __future__ import annotations

import asyncio

from app.core.config import settings
from app.core.logging import configure_logging, logger
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.parsers.factory import build_category_urls, build_parser
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


async def _run_marketplace_scrape() -> str:
    await init_db()

    parser = None
    try:
        parser = build_parser()
        async with AsyncSessionLocal() as session:
            category_urls = await build_category_urls(session)
            service = ScraperService(session, parser, max_concurrency=max(1, settings.request_concurrency))
            await service.scrape_categories(category_urls)
            await sync_legacy_to_catalog(session)
    finally:
        if parser is not None:
            await parser.aclose()

    logger.info(
        "scrape_completed",
        provider=settings.scraper_provider,
        store=parser.shop_name,
        categories=len(category_urls),
    )
    return "ok"


async def _run_example_store_scrape() -> str:
    # Backward compatibility for old entrypoints/calls.
    return await _run_marketplace_scrape()
