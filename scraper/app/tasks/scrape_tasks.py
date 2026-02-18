from __future__ import annotations

import asyncio

from app.core.config import settings
from app.core.logging import configure_logging, logger
from app.db.session import AsyncSessionLocal
from app.parsers.example_store import ExampleStoreParser
from app.services.scraper_service import ScraperService
from app.tasks.celery_app import celery_app

configure_logging(settings.log_level)


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=5,
)
def enqueue_example_store_scrape(self) -> str:
    return asyncio.run(_run_example_store_scrape())


async def _run_example_store_scrape() -> str:
    parser = ExampleStoreParser()
    category_urls = [f"{settings.example_store_base_url}{path}" for path in settings.example_store_category_paths]

    async with AsyncSessionLocal() as session:
        service = ScraperService(session, parser, max_concurrency=settings.request_concurrency)
        await service.scrape_categories(category_urls)

    await parser.aclose()
    logger.info("scrape_completed", store=parser.shop_name, categories=len(category_urls))
    return "ok"
