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
    rate_limited_urls_total = 0
    quarantined_urls_total = 0
    invalid_urls_total = 0
    unknown_products_total = 0
    processed_by_store: dict[int, int] = defaultdict(int)
    failed_by_store: dict[int, int] = defaultdict(int)
    rate_limited_by_store: dict[int, int] = defaultdict(int)
    quarantined_by_store: dict[int, int] = defaultdict(int)
    invalid_by_store: dict[int, int] = defaultdict(int)
    unknown_products_by_store: dict[int, int] = defaultdict(int)

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
                    scrape_result = await service.scrape_categories([category_url])
                    category_results = scrape_result.get("category_results") if isinstance(scrape_result, dict) else []
                    category_result = (
                        category_results[0]
                        if isinstance(category_results, list) and category_results and isinstance(category_results[0], dict)
                        else {}
                    )
                    item_status = str(category_result.get("status") or "done").strip().lower()
                    error_text = str(category_result.get("error") or "").strip() or None
                    payload = {
                        "url": category_url,
                        "status": item_status,
                        "error": error_text,
                        "processed_products": int(category_result.get("processed_products") or 0),
                        "failed_products": int(category_result.get("failed_products") or 0),
                        "invalid_products": int(category_result.get("invalid_products") or 0),
                        "quarantined_products": int(category_result.get("quarantined_products") or 0),
                        "rate_limited_products": int(category_result.get("rate_limited_products") or 0),
                        "unknown_products": int(category_result.get("unknown_products") or 0),
                    }
                    store_url_results.append(payload)
                    unknown_products_total += int(payload["unknown_products"])
                    unknown_products_by_store[store_id] += int(payload["unknown_products"])
                    if item_status in {"ok", "done", "completed", "success"}:
                        processed_urls_total += 1
                        processed_by_store[store_id] += 1
                    elif item_status == "rate_limited":
                        rate_limited_urls_total += 1
                        rate_limited_by_store[store_id] += 1
                    elif item_status == "quarantined":
                        quarantined_urls_total += 1
                        quarantined_by_store[store_id] += 1
                    elif item_status == "invalid":
                        invalid_urls_total += 1
                        invalid_by_store[store_id] += 1
                    else:
                        failed_urls_total += 1
                        failed_by_store[store_id] += 1
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
                    "rate_limited_urls": int(rate_limited_by_store[store_id]),
                    "quarantined_urls": int(quarantined_by_store[store_id]),
                    "invalid_urls": int(invalid_by_store[store_id]),
                    "unknown_products": int(unknown_products_by_store[store_id]),
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
        "rate_limited_urls": rate_limited_urls_total,
        "quarantined_urls": quarantined_urls_total,
        "invalid_urls": invalid_urls_total,
        "unknown_products": unknown_products_total,
        "legacy_write_attempts": 0,
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


async def _process_quarantine_item_remote(
    *,
    item_uuid: str,
    store_id: int,
    store_name: str,
    provider: str,
    base_url: str | None,
    product_url: str,
    category_slug_override: str | None,
    brand_hint_override: str | None = None,
    source_url: str | None = None,
) -> dict[str, Any]:
    await init_db()
    async with AsyncSessionLocal() as session:
        parser = build_parser(provider)
        if store_name:
            parser.shop_name = store_name
        if base_url:
            parser.shop_url = base_url
        service = ScraperService(session, parser)
        try:
            payload = await service.scrape_product_urls(
                [product_url],
                category_slug_override=category_slug_override,
                brand_hint_override=brand_hint_override,
                source_url=source_url or product_url,
            )
            results = payload.get("results") if isinstance(payload, dict) else []
            first = results[0] if isinstance(results, list) and results and isinstance(results[0], dict) else {}
            return {
                "status": "ok",
                "item_uuid": item_uuid,
                "store_id": int(store_id),
                "result": {
                    "url": str(first.get("url") or product_url),
                    "status": str(first.get("status") or "failed"),
                    "error": first.get("error"),
                },
            }
        finally:
            await parser.aclose()


@celery_app.task(
    bind=True,
    name="app.tasks.scrape_tasks.process_quarantine_item_remote",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=settings.task_retry_backoff_max_seconds,
    retry_jitter=True,
    max_retries=settings.max_retries,
)
def process_quarantine_item_remote(
    self,
    *,
    item_uuid: str,
    store_id: int,
    store_name: str,
    provider: str,
    base_url: str | None,
    product_url: str,
    category_slug_override: str | None,
    brand_hint_override: str | None = None,
    source_url: str | None = None,
) -> dict[str, Any]:
    return run_async_task(
        _process_quarantine_item_remote(
            item_uuid=item_uuid,
            store_id=store_id,
            store_name=store_name,
            provider=provider,
            base_url=base_url,
            product_url=product_url,
            category_slug_override=category_slug_override,
            brand_hint_override=brand_hint_override,
            source_url=source_url,
        )
    )

