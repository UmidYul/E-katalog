from __future__ import annotations

from celery import chain

from app.tasks.dedupe_tasks import enqueue_dedupe_batches
from app.tasks.embedding_tasks import enqueue_embedding_batches
from app.tasks.normalize_tasks import enqueue_dirty_products
from app.tasks.reindex_tasks import enqueue_reindex_batches


def run_product_pipeline() -> str:
    workflow = chain(
        enqueue_dirty_products.s(),
        enqueue_dedupe_batches.s(),
        enqueue_embedding_batches.s(),
        enqueue_reindex_batches.s(),
    )
    result = workflow.apply_async()
    return result.id
