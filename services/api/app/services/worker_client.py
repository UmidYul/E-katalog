from __future__ import annotations

from celery import Celery

from shared.config.settings import settings

celery_client = Celery(
    "api_client",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)


def _send(task_name: str) -> str:
    result = celery_client.send_task(task_name)
    return result.id


def enqueue_reindex_batches() -> str:
    return _send("app.tasks.reindex_tasks.enqueue_reindex_batches")


def enqueue_embedding_batches() -> str:
    return _send("app.tasks.embedding_tasks.enqueue_embedding_batches")


def enqueue_dedupe_batches() -> str:
    return _send("app.tasks.dedupe_tasks.enqueue_dedupe_batches")


def enqueue_full_crawl() -> str:
    return _send("app.tasks.scrape_tasks.enqueue_full_crawl")
