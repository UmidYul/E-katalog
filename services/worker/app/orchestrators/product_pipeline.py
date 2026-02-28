from __future__ import annotations

from celery import chain

from app.core.config import settings
from app.tasks.dedupe_tasks import find_duplicate_candidates_task
from app.tasks.embedding_tasks import generate_embeddings_batch
from app.tasks.normalize_tasks import normalize_full_catalog
from app.tasks.reindex_tasks import reindex_product_search_batch


def run_product_pipeline() -> str:
    # Use real batch/full tasks in chain so each stage finishes before the next one starts.
    workflow = chain(
        normalize_full_catalog.si(chunk_size=1000),
        find_duplicate_candidates_task.si(limit=1000),
        generate_embeddings_batch.si(limit=int(settings.embedding_batch_limit), reset_offset=False, followup=True),
        reindex_product_search_batch.si(limit=20000),
    )
    result = workflow.apply_async()
    return result.id
