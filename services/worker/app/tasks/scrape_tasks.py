from __future__ import annotations

from app.celery_app import celery_app


@celery_app.task(bind=True)
def scrape_store_category(self, store_id: int, category_id: int) -> dict:
    return {"status": "queued", "store_id": store_id, "category_id": category_id}


@celery_app.task(bind=True)
def scrape_priority_category(self, store_id: int, category_id: int) -> dict:
    return {"status": "queued_priority", "store_id": store_id, "category_id": category_id}


@celery_app.task(bind=True)
def enqueue_full_crawl(self) -> str:
    return "scheduled"


@celery_app.task(bind=True)
def retry_failed_items(self) -> str:
    return "noop"
