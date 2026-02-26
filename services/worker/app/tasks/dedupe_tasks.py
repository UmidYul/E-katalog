from __future__ import annotations

import asyncio
from datetime import datetime
from shared.utils.time import UTC

from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.platform.services.dedupe import find_duplicate_candidates, merge_high_confidence_duplicates
from app.celery_app import celery_app


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=7,
)
def find_duplicate_candidates_task(self, limit: int = 1000) -> dict:
    return asyncio.run(_run(limit))


async def _run(limit: int) -> dict:
    async with AsyncSessionLocal() as session:
        created = await find_duplicate_candidates(session, limit=limit)
        merged = await merge_high_confidence_duplicates(session, limit=limit)
        logger.info("dedupe_candidates_completed", created=created, merged=merged)
        return {"created": created, "merged": merged, "at": datetime.now(UTC).isoformat()}


@celery_app.task(bind=True)
def enqueue_dedupe_batches(self) -> str:
    return find_duplicate_candidates_task.delay().id

