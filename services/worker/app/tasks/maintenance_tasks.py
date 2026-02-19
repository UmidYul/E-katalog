from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import text

from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.celery_app import celery_app


@celery_app.task(bind=True)
def cleanup_stale_offers(self, days: int = 14) -> dict:
    return asyncio.run(_cleanup(days))


async def _cleanup(days: int) -> dict:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                update catalog_offers
                set is_valid = false
                where scraped_at < now() - (:days || ' days')::interval
                  and is_valid = true
                """
            ),
            {"days": days},
        )
        await session.commit()
        logger.info("cleanup_stale_offers_completed", rows=result.rowcount or 0)
        return {"invalidated": result.rowcount or 0, "at": datetime.now(UTC).isoformat()}


@celery_app.task(bind=True)
def rotate_price_history_partitions(self) -> dict:
    return {"status": "noop", "at": datetime.now(UTC).isoformat()}
