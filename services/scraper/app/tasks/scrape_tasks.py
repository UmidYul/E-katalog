from __future__ import annotations

import asyncio
from urllib.parse import urljoin

from app.core.config import settings
from app.core.logging import configure_logging, logger
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.parsers.example_store import ExampleStoreParser
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
    return asyncio.run(_run_example_store_scrape())


async def _run_example_store_scrape() -> str:
    await init_db()

    parser = ExampleStoreParser()
    base_url = str(settings.example_store_base_url).rstrip("/") + "/"
    category_urls = [urljoin(base_url, path.lstrip("/")) for path in settings.example_store_category_paths]

    try:
        async with AsyncSessionLocal() as session:
            service = ScraperService(session, parser, max_concurrency=max(1, settings.request_concurrency))
            await service.scrape_categories(category_urls)
    finally:
        await parser.aclose()

    logger.info("scrape_completed", store=parser.shop_name, categories=len(category_urls))
    return "ok"
