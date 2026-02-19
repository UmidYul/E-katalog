from __future__ import annotations

from fastapi import APIRouter

from app.services.worker_client import enqueue_dedupe_batches
from app.services.worker_client import enqueue_embedding_batches
from app.services.worker_client import enqueue_full_crawl
from app.services.worker_client import enqueue_reindex_batches

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/reindex/products")
async def reindex_products() -> dict:
    task_id = enqueue_reindex_batches()
    return {"task_id": task_id, "queued": "reindex"}


@router.post("/embeddings/rebuild")
async def rebuild_embeddings() -> dict:
    task_id = enqueue_embedding_batches()
    return {"task_id": task_id, "queued": "embedding"}


@router.post("/dedupe/run")
async def run_dedupe() -> dict:
    task_id = enqueue_dedupe_batches()
    return {"task_id": task_id, "queued": "dedupe"}


@router.post("/scrape/run")
async def run_scrape() -> dict:
    task_id = enqueue_full_crawl()
    return {"task_id": task_id, "queued": "scrape"}
