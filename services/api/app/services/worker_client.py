from __future__ import annotations

from celery import Celery
from celery.result import AsyncResult

from shared.config.settings import settings

celery_client = Celery(
    "api_client",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)


def _send(task_name: str, *, queue: str, routing_key: str) -> str:
    result = celery_client.send_task(task_name, queue=queue, routing_key=routing_key)
    return result.id


def get_task_status(task_id: str) -> dict:
    result = AsyncResult(task_id, app=celery_client)
    info = result.info
    if not isinstance(info, dict):
        info = {"message": str(info)} if info else {}
    return {"task_id": task_id, "state": result.state, "ready": result.ready(), "successful": result.successful(), "info": info}


def enqueue_reindex_batches() -> str:
    return _send("app.tasks.reindex_tasks.enqueue_reindex_batches", queue="reindex", routing_key="reindex")


def enqueue_embedding_batches() -> str:
    return _send("app.tasks.embedding_tasks.enqueue_embedding_batches", queue="embedding", routing_key="embedding")


def enqueue_dedupe_batches() -> str:
    return _send("app.tasks.dedupe_tasks.enqueue_dedupe_batches", queue="dedupe", routing_key="dedupe")


def enqueue_full_crawl() -> str:
    return _send("app.tasks.scrape_tasks.enqueue_full_crawl", queue="scrape.high", routing_key="scrape.high")


def enqueue_ingested_products_pipeline() -> str:
    return _send(
        "app.tasks.scrape_tasks.enqueue_ingested_products_pipeline",
        queue="normalize",
        routing_key="normalize",
    )


def enqueue_full_catalog_rebuild() -> str:
    return _send(
        "app.tasks.maintenance_tasks.enqueue_full_catalog_rebuild",
        queue="maintenance",
        routing_key="maintenance",
    )


def enqueue_catalog_quality_report() -> str:
    return _send(
        "app.tasks.maintenance_tasks.enqueue_catalog_quality_reports",
        queue="maintenance",
        routing_key="maintenance",
    )


def enqueue_test_quality_alert() -> str:
    return _send(
        "app.tasks.maintenance_tasks.send_test_quality_alert",
        queue="maintenance",
        routing_key="maintenance",
    )


def enqueue_admin_alert_evaluation() -> str:
    return _send(
        "app.tasks.maintenance_tasks.enqueue_admin_alert_evaluation",
        queue="maintenance",
        routing_key="maintenance",
    )
