from __future__ import annotations

import asyncio
from datetime import datetime
from shared.utils.time import UTC

from sqlalchemy import text

from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.platform.services.pipeline_offsets import ensure_offsets_table, get_offset, set_offset
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
        await ensure_offsets_table(session)
        last_ts, _ = await get_offset(session, "reindex_product_search")
        run_ts = datetime.now(UTC)
        baseline = last_ts or datetime(1970, 1, 1, tzinfo=UTC)

        await session.execute(
            text(
                """
                with affected as (
                    select distinct o.canonical_product_id as product_id
                    from catalog_offers o
                    where o.canonical_product_id is not null
                      and o.scraped_at > :last_ts
                      and o.scraped_at <= :run_ts
                    union
                    select cme.from_product_id as product_id
                    from catalog_canonical_merge_events cme
                    where cme.from_product_id is not null
                      and cme.created_at > :last_ts
                      and cme.created_at <= :run_ts
                    union
                    select cme.to_product_id as product_id
                    from catalog_canonical_merge_events cme
                    where cme.to_product_id is not null
                      and cme.created_at > :last_ts
                      and cme.created_at <= :run_ts
                    union
                    select cp.id as product_id
                    from catalog_canonical_products cp
                    where cp.updated_at > :last_ts
                      and cp.updated_at <= :run_ts
                    order by product_id
                    limit :limit
                )
                insert into catalog_product_search (product_id, tsv, min_price, max_price, store_count, updated_at)
                select cp.id,
                       to_tsvector('simple', coalesce(cp.normalized_title, '')),
                       min(o.price_amount) as min_price,
                       max(o.price_amount) as max_price,
                       count(distinct o.store_id) as store_count,
                       now()
                from affected a
                join catalog_canonical_products cp on cp.id = a.product_id
                left join catalog_offers o
                  on o.canonical_product_id = cp.id
                 and o.is_valid = true
                 and o.in_stock = true
                group by cp.id
                on conflict (product_id) do update
                  set tsv = excluded.tsv,
                      min_price = excluded.min_price,
                      max_price = excluded.max_price,
                      store_count = excluded.store_count,
                      updated_at = now()
                """
            ),
            {"limit": limit, "last_ts": baseline, "run_ts": run_ts},
        )
        await set_offset(session, "reindex_product_search", last_ts=run_ts, last_id=0)
        await session.commit()
        logger.info("reindex_batch_completed", limit=limit, since=str(baseline), until=str(run_ts))
        return {"reindexed_limit": limit, "at": datetime.now(UTC).isoformat(), "since": baseline.isoformat(), "until": run_ts.isoformat()}


@celery_app.task(bind=True)
def enqueue_reindex_batches(self) -> str:
    return reindex_product_search_batch.delay().id

