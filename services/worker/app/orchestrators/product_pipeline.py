from __future__ import annotations

from celery import chain

from app.tasks.copywriting_tasks import enqueue_product_copy_batches
from app.tasks.dedupe_tasks import enqueue_dedupe_batches
from app.tasks.embedding_tasks import enqueue_embedding_batches
from app.tasks.normalize_tasks import enqueue_dirty_products
from app.tasks.reindex_tasks import enqueue_reindex_batches


def run_product_pipeline() -> str:
    workflow = chain(
        enqueue_dirty_products.si(),
        enqueue_product_copy_batches.si(),
        enqueue_dedupe_batches.si(),
        enqueue_embedding_batches.si(),
        enqueue_reindex_batches.si(),
    )
    result = workflow.apply_async()
    return result.id
