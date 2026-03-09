from __future__ import annotations

import json
import re
from datetime import datetime
from time import perf_counter
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

from celery.result import allow_join_result
import httpx
from sqlalchemy import text

from app.celery_app import celery_app
from app.core.asyncio_runner import run_async_task
from app.core.config import settings
from app.core.logging import logger
from app.core.metrics import add_parse_errors, observe_stage_duration
from app.db.session import AsyncSessionLocal
from app.orchestrators.product_pipeline import run_product_pipeline
from shared.utils.time import UTC

_SCRAPE_REMOTE_TASK_NAME = "app.tasks.scrape_tasks.run_scrape_targets"
_SCRAPE_REMOTE_TIMEOUT_SECONDS = 60 * 60 * 4
_IMMEDIATE_REINDEX_TASK_NAME = "app.tasks.reindex_tasks.reindex_product_search_batch"

_SOURCE_DISCOVERY_MIN_ACTIVE_PER_STORE = 8
_SOURCE_DISCOVERY_MAX_PER_STORE = 40
_DISCOVERY_TIMEOUT_SECONDS = 20.0

_PROVIDER_FALLBACK_SOURCES: dict[str, list[str]] = {
    "mediapark": [
        "https://mediapark.uz/products/category/smartfony-po-brendu-660/smartfony-samsung-210",
        "https://mediapark.uz/products/category/smartfony-po-brendu-660/smartfony-apple-iphone-211",
    ],
    "texnomart": [
        "https://texnomart.uz/katalog/smartfony-apple/",
        "https://texnomart.uz/katalog/smartfon-samsung/",
        "https://texnomart.uz/katalog/smartfony/",
        "https://texnomart.uz/katalog/noutbuki/",
        "https://texnomart.uz/katalog/planshety/",
    ],
}


def _normalize_source_url(base_url: str, href: str) -> str | None:
    raw = str(href or "").strip()
    if not raw:
        return None
    if raw.startswith("#") or raw.startswith("javascript:") or raw.startswith("mailto:"):
        return None
    absolute = urljoin(base_url, raw)
    parts = urlsplit(absolute)
    scheme = (parts.scheme or "").lower()
    if scheme not in {"http", "https"}:
        return None
    if not parts.netloc:
        return None
    cleaned_path = re.sub(r"/{2,}", "/", parts.path or "/")
    normalized = urlunsplit((scheme, parts.netloc.lower(), cleaned_path or "/", "", ""))
    return normalized


async def _discover_sources_for_store(*, provider: str, base_url: str) -> list[str]:
    patterns_by_provider: dict[str, tuple[str, ...]] = {
        "mediapark": (r'href=["\']([^"\']*?/products/category/[^"\']+)["\']',),
        "texnomart": (r'href=["\']([^"\']*?/katalog/[^"\']+)["\']',),
    }
    patterns = patterns_by_provider.get(provider, ())
    if not patterns:
        return []

    timeout = httpx.Timeout(_DISCOVERY_TIMEOUT_SECONDS)
    html_chunks: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(base_url)
            response.raise_for_status()
            html_chunks.append(response.text)
            for fallback_url in _PROVIDER_FALLBACK_SOURCES.get(provider, []):
                try:
                    fallback_response = await client.get(fallback_url)
                    fallback_response.raise_for_status()
                except Exception:  # noqa: BLE001
                    continue
                html_chunks.append(fallback_response.text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("source_discovery_failed", provider=provider, base_url=base_url, error=str(exc))
        return []

    discovered: list[str] = []
    seen: set[str] = set()
    for html in html_chunks:
        for pattern in patterns:
            for href in re.findall(pattern, html, flags=re.IGNORECASE):
                normalized = _normalize_source_url(base_url, href)
                if not normalized or normalized in seen:
                    continue
                seen.add(normalized)
                discovered.append(normalized)
                if len(discovered) >= _SOURCE_DISCOVERY_MAX_PER_STORE:
                    return discovered
    return discovered


async def _ensure_scrape_sources(session) -> None:
    rows = (
        await session.execute(
            text(
                """
                select
                    s.id as store_id,
                    lower(s.provider) as provider,
                    s.base_url as base_url,
                    count(*) filter (where ss.is_active = true)::int as active_sources
                from catalog_stores s
                left join catalog_scrape_sources ss on ss.store_id = s.id
                where s.is_active = true
                  and lower(s.provider) in ('mediapark', 'texnomart')
                group by s.id, s.provider, s.base_url
                order by s.id asc
                """
            )
        )
    ).mappings().all()

    inserted_total = 0
    for row in rows:
        provider = str(row.get("provider") or "").strip().lower()
        store_id = int(row["store_id"])
        active_sources = int(row.get("active_sources") or 0)
        if active_sources >= _SOURCE_DISCOVERY_MIN_ACTIVE_PER_STORE:
            continue

        base_url = str(row.get("base_url") or "").strip()
        if not base_url:
            if provider == "mediapark":
                base_url = "https://mediapark.uz"
            elif provider == "texnomart":
                base_url = "https://texnomart.uz"

        candidates = await _discover_sources_for_store(provider=provider, base_url=base_url) if base_url else []
        for fallback_url in _PROVIDER_FALLBACK_SOURCES.get(provider, []):
            normalized = _normalize_source_url(base_url or fallback_url, fallback_url)
            if normalized and normalized not in candidates:
                candidates.append(normalized)

        for idx, source_url in enumerate(candidates):
            if idx >= _SOURCE_DISCOVERY_MAX_PER_STORE:
                break
            result = (
                await session.execute(
                    text(
                        """
                        insert into catalog_scrape_sources (store_id, url, source_type, is_active, priority)
                        values (:store_id, :url, 'category', true, :priority)
                        on conflict (store_id, url) do nothing
                        returning id
                        """
                    ),
                    {"store_id": store_id, "url": source_url, "priority": idx + 1},
                )
            ).first()
            if result is not None:
                inserted_total += 1

    if inserted_total:
        await session.commit()
        logger.info("scrape_sources_synced", inserted=inserted_total)
    else:
        await session.rollback()


async def _load_scrape_targets(session) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            text(
                """
                select
                    s.id as store_id,
                    s.name as store_name,
                    s.provider as provider,
                    s.base_url as base_url,
                    ss.id as source_id,
                    ss.url as source_url
                from catalog_stores s
                join catalog_scrape_sources ss on ss.store_id = s.id
                where s.is_active = true
                  and ss.is_active = true
                order by s.crawl_priority asc, s.id asc, ss.priority asc, ss.id asc
                """
            )
        )
    ).mappings().all()

    grouped: dict[int, dict[str, Any]] = {}
    for row in rows:
        store_id = int(row["store_id"])
        entry = grouped.get(store_id)
        if entry is None:
            entry = {
                "store_id": store_id,
                "store_name": str(row.get("store_name") or f"store-{store_id}"),
                "provider": str(row.get("provider") or "generic"),
                "base_url": str(row.get("base_url") or "").strip() or None,
                "category_urls": [],
            }
            grouped[store_id] = entry
        url = str(row.get("source_url") or "").strip()
        if url and url not in entry["category_urls"]:
            entry["category_urls"].append(url)

    return [grouped[key] for key in sorted(grouped.keys())]


async def _open_crawl_jobs(session, *, targets: list[dict[str, Any]]) -> dict[int, int]:
    now = datetime.now(UTC)
    jobs_by_store: dict[int, int] = {}

    for target in targets:
        store_id = int(target["store_id"])
        job_row = (
            await session.execute(
                text(
                    """
                    insert into catalog_crawl_jobs (store_id, category_id, started_at, finished_at, status, error_summary)
                    values (:store_id, null, :started_at, null, 'running', null)
                    returning id
                    """
                ),
                {"store_id": store_id, "started_at": now},
            )
        ).mappings().one()
        job_id = int(job_row["id"])
        jobs_by_store[store_id] = job_id

        for url in target.get("category_urls", []):
            normalized = str(url or "").strip()
            if not normalized:
                continue
            await session.execute(
                text(
                    """
                    insert into catalog_crawl_job_items (crawl_job_id, external_id, status, retry_count, last_error)
                    values (:crawl_job_id, :external_id, 'queued', 0, null)
                    """
                ),
                {"crawl_job_id": job_id, "external_id": normalized[:255]},
            )

    await session.commit()
    return jobs_by_store


def _index_store_results(scrape_result: dict[str, Any]) -> dict[int, dict[str, Any]]:
    indexed: dict[int, dict[str, Any]] = {}
    for row in scrape_result.get("stores", []):
        try:
            store_id = int(row.get("store_id"))
        except Exception:  # noqa: BLE001
            continue
        indexed[store_id] = row
    return indexed


async def _finalize_crawl_jobs(
    session,
    *,
    jobs_by_store: dict[int, int],
    scrape_result: dict[str, Any],
) -> dict[str, int]:
    done_jobs = 0
    failed_jobs = 0
    indexed_results = _index_store_results(scrape_result)
    finished_at = datetime.now(UTC)

    for store_id, job_id in jobs_by_store.items():
        store_result = indexed_results.get(store_id, {})
        url_results = store_result.get("url_results") if isinstance(store_result.get("url_results"), list) else []
        processed_urls = int(store_result.get("processed_urls") or 0)
        failed_urls = int(store_result.get("failed_urls") or 0)
        status = "completed" if failed_urls <= 0 else "failed"
        if status == "completed":
            done_jobs += 1
        else:
            failed_jobs += 1

        summary = {
            "processed_urls": processed_urls,
            "failed_urls": failed_urls,
            "total_urls": int(store_result.get("total_urls") or processed_urls + failed_urls),
        }

        await session.execute(
            text(
                """
                update catalog_crawl_jobs
                set status = :status,
                    finished_at = :finished_at,
                    error_summary = :error_summary
                where id = :job_id
                """
            ),
            {
                "status": status,
                "finished_at": finished_at,
                "error_summary": json.dumps(summary, ensure_ascii=False),
                "job_id": job_id,
            },
        )

        await session.execute(
            text(
                """
                update catalog_crawl_job_items
                set status = 'done',
                    last_error = null
                where crawl_job_id = :job_id
                """
            ),
            {"job_id": job_id},
        )

        for item in url_results:
            url = str(item.get("url") or "").strip()
            if not url:
                continue
            item_status = str(item.get("status") or "").strip().lower()
            if item_status in {"ok", "done", "completed", "success"}:
                continue
            error_text = str(item.get("error") or "").strip() or "scrape_failed"
            await session.execute(
                text(
                    """
                    update catalog_crawl_job_items
                    set status = 'failed',
                        retry_count = retry_count + 1,
                        last_error = :last_error
                    where crawl_job_id = :job_id
                      and external_id = :external_id
                    """
                ),
                {
                    "job_id": job_id,
                    "external_id": url[:255],
                    "last_error": error_text[:4000],
                },
            )

    await session.commit()
    return {"completed_jobs": done_jobs, "failed_jobs": failed_jobs}


async def _mark_jobs_failed(session, *, jobs_by_store: dict[int, int], error_text: str) -> None:
    finished_at = datetime.now(UTC)
    safe_error = (error_text or "scrape_failed")[:4000]
    for job_id in jobs_by_store.values():
        await session.execute(
            text(
                """
                update catalog_crawl_jobs
                set status = 'failed',
                    finished_at = :finished_at,
                    error_summary = :error_summary
                where id = :job_id
                """
            ),
            {
                "finished_at": finished_at,
                "error_summary": safe_error,
                "job_id": job_id,
            },
        )
        await session.execute(
            text(
                """
                update catalog_crawl_job_items
                set status = 'failed',
                    retry_count = retry_count + 1,
                    last_error = :last_error
                where crawl_job_id = :job_id
                """
            ),
            {"job_id": job_id, "last_error": safe_error},
        )
    await session.commit()


def _run_remote_scrape(targets: list[dict[str, Any]]) -> dict[str, Any]:
    async_result = celery_app.send_task(
        _SCRAPE_REMOTE_TASK_NAME,
        kwargs={"targets": targets},
        queue="scrape.high",
        routing_key="scrape.high",
    )
    with allow_join_result():
        payload = async_result.get(timeout=_SCRAPE_REMOTE_TIMEOUT_SECONDS, propagate=True)
    if isinstance(payload, dict):
        return payload
    return {"status": "ok", "stores": []}


async def _enqueue_full_crawl() -> dict[str, Any]:
    lock_key = 904231
    lock_acquired = False
    lock_session = AsyncSessionLocal()
    async with AsyncSessionLocal() as session:
        lock_row = (
            await lock_session.execute(
                text(
                    """
                    select pg_try_advisory_lock(:lock_key) as locked
                    """
                ),
                {"lock_key": lock_key},
            )
        ).mappings().one()
        lock_acquired = bool(lock_row.get("locked"))
        if not lock_acquired:
            await lock_session.close()
            return {
                "status": "already_running",
                "stores": 0,
                "urls": 0,
                "at": datetime.now(UTC).isoformat(),
            }
        try:
            running_row = (
                await session.execute(
                    text(
                        """
                        select count(*)::int as total
                        from catalog_crawl_jobs
                        where status = 'running'
                        """
                    )
                )
            ).mappings().one()
            if int(running_row.get("total") or 0) > 0:
                return {
                    "status": "already_running",
                    "stores": 0,
                    "urls": 0,
                    "at": datetime.now(UTC).isoformat(),
                }

            await _ensure_scrape_sources(session)
            targets = await _load_scrape_targets(session)
            if not targets:
                return {"status": "no_targets", "stores": 0, "urls": 0, "at": datetime.now(UTC).isoformat()}
            jobs_by_store = await _open_crawl_jobs(session, targets=targets)
        finally:
            if lock_acquired:
                await lock_session.execute(text("select pg_advisory_unlock(:lock_key)"), {"lock_key": lock_key})
                await lock_session.commit()
            await lock_session.close()

    try:
        scrape_result = _run_remote_scrape(targets)
    except Exception as exc:  # noqa: BLE001
        async with AsyncSessionLocal() as session:
            await _mark_jobs_failed(session, jobs_by_store=jobs_by_store, error_text=str(exc))
        raise

    async with AsyncSessionLocal() as session:
        crawl_stats = await _finalize_crawl_jobs(session, jobs_by_store=jobs_by_store, scrape_result=scrape_result)

    workflow_id = run_product_pipeline()
    immediate_reindex_task_id = celery_app.send_task(
        _IMMEDIATE_REINDEX_TASK_NAME,
        kwargs={"limit": 20000},
        queue="reindex",
        routing_key="reindex",
    ).id
    total_urls = sum(len(target.get("category_urls", [])) for target in targets)
    add_parse_errors(count=int(scrape_result.get("failed_urls") or 0))
    logger.info(
        "full_crawl_enqueued",
        stores=len(targets),
        urls=total_urls,
        workflow_id=workflow_id,
        immediate_reindex_task_id=immediate_reindex_task_id,
        **crawl_stats,
    )
    return {
        "status": "ok",
        "stores": len(targets),
        "urls": total_urls,
        "workflow_id": workflow_id,
        "immediate_reindex_task_id": immediate_reindex_task_id,
        "crawl_jobs": crawl_stats,
        "scrape_result": scrape_result,
        "at": datetime.now(UTC).isoformat(),
    }


async def _retry_failed_items() -> dict[str, Any]:
    max_retries = max(int(settings.max_retries or 0), 0)
    batch_limit = 200
    retried_items = 0
    skipped_due_limit = 0
    enqueued_batches = 0

    async with AsyncSessionLocal() as session:
        skipped_row = (
            await session.execute(
                text(
                    """
                    select count(*)::int as total
                    from catalog_crawl_job_items i
                    where lower(i.status) in ('failed', 'failure', 'error')
                      and i.retry_count >= :max_retries
                    """
                ),
                {"max_retries": max_retries},
            )
        ).mappings().one()
        skipped_due_limit = int(skipped_row.get("total") or 0)

        rows = (
            await session.execute(
                text(
                    """
                    select
                        i.id as item_id,
                        i.external_id as external_id,
                        j.store_id as store_id,
                        j.category_id as category_id,
                        s.name as store_name,
                        s.provider as provider,
                        s.base_url as base_url
                    from catalog_crawl_job_items i
                    join catalog_crawl_jobs j on j.id = i.crawl_job_id
                    join catalog_stores s on s.id = j.store_id
                    where lower(i.status) in ('failed', 'failure', 'error')
                      and i.retry_count < :max_retries
                    order by i.id asc
                    limit :limit
                    for update of i skip locked
                    """
                ),
                {"max_retries": max_retries, "limit": batch_limit},
            )
        ).mappings().all()

        if not rows:
            logger.info(
                "retry_failed_items_done",
                taken_for_retry=0,
                skipped_retry_limit=skipped_due_limit,
                max_retries=max_retries,
            )
            return {
                "status": "ok",
                "taken_for_retry": 0,
                "enqueued_batches": 0,
                "skipped_retry_limit": skipped_due_limit,
                "max_retries": max_retries,
                "at": datetime.now(UTC).isoformat(),
            }

        grouped_targets: dict[tuple[str, str, int], dict[str, Any]] = {}
        item_ids_by_group: dict[tuple[str, str, int], list[int]] = {}
        for row in rows:
            queue_name = "scrape.high" if row.get("category_id") is not None else "scrape.default"
            group_key = (queue_name, queue_name, int(row["store_id"]))
            entry = grouped_targets.get(group_key)
            if entry is None:
                entry = {
                    "store_id": int(row["store_id"]),
                    "store_name": str(row.get("store_name") or f"store-{int(row['store_id'])}"),
                    "provider": str(row.get("provider") or "generic"),
                    "base_url": str(row.get("base_url") or "").strip() or None,
                    "category_urls": [],
                }
                grouped_targets[group_key] = entry
                item_ids_by_group[group_key] = []

            url = str(row.get("external_id") or "").strip()
            if url and url not in entry["category_urls"]:
                entry["category_urls"].append(url)
            item_ids_by_group[group_key].append(int(row["item_id"]))

        selected_for_retry = len(rows)
        now = datetime.now(UTC)
        updated_ids: list[int] = []
        for group_key, target in grouped_targets.items():
            queue_name, routing_key, _store_id = group_key
            if not target.get("category_urls"):
                continue
            try:
                celery_app.send_task(
                    _SCRAPE_REMOTE_TASK_NAME,
                    kwargs={"targets": [target]},
                    queue=queue_name,
                    routing_key=routing_key,
                )
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "retry_failed_items_enqueue_failed",
                    queue=queue_name,
                    store_id=target["store_id"],
                    urls=len(target["category_urls"]),
                    error=str(exc),
                )
                continue
            enqueued_batches += 1
            updated_ids.extend(item_ids_by_group[group_key])

        if updated_ids:
            await session.execute(
                text(
                    """
                    update catalog_crawl_job_items
                    set status = 'queued',
                        retry_count = retry_count + 1,
                        last_retry_at = :last_retry_at
                    where id = :item_id
                    """
                ),
                [{"item_id": item_id, "last_retry_at": now} for item_id in updated_ids],
            )
            await session.commit()

        retried_items = len(updated_ids)

    logger.info(
        "retry_failed_items_done",
        selected_for_retry=selected_for_retry,
        taken_for_retry=retried_items,
        enqueued_batches=enqueued_batches,
        skipped_retry_limit=skipped_due_limit,
        max_retries=max_retries,
    )
    return {
        "status": "ok",
        "selected_for_retry": selected_for_retry,
        "taken_for_retry": retried_items,
        "enqueued_batches": enqueued_batches,
        "skipped_retry_limit": skipped_due_limit,
        "max_retries": max_retries,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def scrape_store_category(self, store_id: int, category_id: int) -> dict:
    return {"status": "queued", "store_id": store_id, "category_id": category_id}


@celery_app.task(bind=True)
def scrape_priority_category(self, store_id: int, category_id: int) -> dict:
    return {"status": "queued_priority", "store_id": store_id, "category_id": category_id}


@celery_app.task(bind=True)
def enqueue_full_crawl(self) -> dict[str, Any]:
    started = perf_counter()
    status = "ok"
    try:
        return run_async_task(_enqueue_full_crawl())
    except Exception:  # noqa: BLE001
        status = "error"
        raise
    finally:
        observe_stage_duration(stage="scrape_full_crawl", seconds=perf_counter() - started, status=status)


@celery_app.task(bind=True)
def retry_failed_items(self) -> dict[str, Any]:
    return run_async_task(_retry_failed_items())


@celery_app.task(bind=True)
def enqueue_ingested_products_pipeline(self) -> str:
    return run_product_pipeline()
