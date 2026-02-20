from __future__ import annotations

import asyncio
import uuid
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


@celery_app.task(bind=True)
def cleanup_empty_canonicals(self, limit: int = 1000) -> dict:
    return asyncio.run(_cleanup_empty_canonicals(limit))


async def _cleanup_empty_canonicals(limit: int) -> dict:
    run_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as session:
        updated_ids = (
            await session.execute(
                text(
                    """
                    with empty as (
                      select cp.id
                      from catalog_canonical_products cp
                      left join catalog_offers o on o.canonical_product_id = cp.id
                      where cp.is_active = true
                      group by cp.id
                      having count(o.id) = 0
                      order by cp.id
                      limit :limit
                    ),
                    deactivated as (
                      update catalog_canonical_products cp
                      set is_active = false,
                          updated_at = now()
                      from empty e
                      where cp.id = e.id
                      returning cp.id
                    )
                    select id from deactivated
                    """
                ),
                {"limit": limit},
            )
        ).scalars().all()

        if updated_ids:
            await session.execute(
                text(
                    """
                    insert into catalog_canonical_merge_events (from_product_id, to_product_id, reason, score, payload)
                    select
                      d.id,
                      null::bigint,
                      'cleanup_empty_canonical',
                      null::numeric(5,4),
                      jsonb_build_object(
                        'run_id', cast(:run_id as text),
                        'cleanup_type', 'deactivate_empty_without_offers'
                      )
                    from unnest(cast(:ids as bigint[])) as d(id)
                    """
                ),
                {"run_id": run_id, "ids": updated_ids},
            )

        await session.commit()
        logger.info(
            "cleanup_empty_canonicals_completed",
            run_id=run_id,
            deactivated=len(updated_ids),
            limit=limit,
        )
        return {
            "run_id": run_id,
            "deactivated": len(updated_ids),
            "limit": limit,
            "at": datetime.now(UTC).isoformat(),
        }
