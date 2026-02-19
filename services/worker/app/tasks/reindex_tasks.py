from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import text

from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.celery_app import celery_app


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=7,
)
def reindex_product_search_batch(self, limit: int = 2000) -> dict:
    return asyncio.run(_run(limit))


async def _run(limit: int) -> dict:
    async with AsyncSessionLocal() as session:
        await session.execute(
            text(
                """
                insert into catalog_product_search (product_id, tsv, min_price, max_price, store_count, updated_at)
                select p.id,
                       to_tsvector('simple', coalesce(p.normalized_title, '')),
                       min(o.price_amount) as min_price,
                       max(o.price_amount) as max_price,
                       count(distinct sp.store_id) as store_count,
                       now()
                from catalog_products p
                left join catalog_store_products sp on sp.product_id = p.id
                left join catalog_offers o on o.store_product_id = sp.id and o.is_valid = true and o.in_stock = true
                group by p.id
                order by p.id
                limit :limit
                on conflict (product_id) do update
                  set tsv = excluded.tsv,
                      min_price = excluded.min_price,
                      max_price = excluded.max_price,
                      store_count = excluded.store_count,
                      updated_at = now()
                """
            ),
            {"limit": limit},
        )
        await session.commit()
        logger.info("reindex_batch_completed", limit=limit)
        return {"reindexed": limit, "at": datetime.now(UTC).isoformat()}


@celery_app.task(bind=True)
def enqueue_reindex_batches(self) -> str:
    return reindex_product_search_batch.delay().id
