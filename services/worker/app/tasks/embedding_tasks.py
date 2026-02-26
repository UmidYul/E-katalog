from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import text

from app.core.config import settings
from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.platform.models import CatalogAIEnrichmentJob
from app.platform.services.embeddings import simple_embedding
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
def generate_embeddings_batch(
    self,
    limit: int = 400,
    reset_offset: bool = False,
    followup: bool = True,
) -> dict:
    result = asyncio.run(_run(limit, reset_offset=reset_offset))
    if followup and bool(result.get("has_more")):
        self.apply_async(
            kwargs={
                "limit": int(result.get("limit") or 400),
                "reset_offset": False,
                "followup": True,
            }
        )
    return result


def _to_pgvector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{float(value):.8f}" for value in values) + "]"


async def _run(limit: int, *, reset_offset: bool = False) -> dict:
    parsed_limit = int(limit) if isinstance(limit, int) and int(limit) > 0 else int(settings.embedding_batch_limit)
    effective_limit = max(100, parsed_limit)
    job_name = "canonical_embeddings"
    async with AsyncSessionLocal() as session:
        await ensure_offsets_table(session)
        if reset_offset:
            last_ts = None
            last_id = 0
        else:
            last_ts, last_id = await get_offset(session, job_name)

        params: dict[str, object] = {"limit": effective_limit}
        where_clause = ""
        if last_ts is not None:
            where_clause = "and (cp.updated_at > :last_ts or (cp.updated_at = :last_ts and cp.id > :last_id))"
            params["last_ts"] = last_ts
            params["last_id"] = int(last_id)

        rows = (
            await session.execute(
                text(
                    f"""
                    select cp.id, cp.normalized_title, cp.updated_at
                    from catalog_canonical_products cp
                    where cp.is_active = true
                      and cp.normalized_title is not null
                      and btrim(cp.normalized_title) <> ''
                      {where_clause}
                    order by cp.updated_at asc, cp.id asc
                    limit :limit
                    """
                ),
                params,
            )
        ).mappings().all()

        processed = 0
        skipped = 0
        watermark_ts = last_ts
        watermark_id = int(last_id)
        for row in rows:
            canonical_product_id = int(row["id"])
            normalized_title = str(row["normalized_title"] or "").strip()
            if not normalized_title:
                skipped += 1
                continue

            embedding = simple_embedding(normalized_title)
            await session.execute(
                text(
                    """
                    update catalog_canonical_products
                    set embedding = cast(:embedding as vector)
                    where id = :product_id
                    """
                ),
                {
                    "embedding": _to_pgvector_literal(embedding),
                    "product_id": canonical_product_id,
                },
            )
            session.add(
                CatalogAIEnrichmentJob(
                    product_id=canonical_product_id,
                    stage="embedding",
                    status="done",
                    payload={"model": settings.openai_model, "job": job_name},
                )
            )
            processed += 1
            watermark_ts = row["updated_at"]
            watermark_id = canonical_product_id

        if rows:
            await set_offset(session, job_name, last_ts=watermark_ts, last_id=watermark_id)

        await session.commit()
        has_more = len(rows) >= effective_limit
        logger.info(
            "embedding_batch_completed",
            processed=processed,
            skipped=skipped,
            scanned=len(rows),
            limit=effective_limit,
            has_more=has_more,
            reset_offset=bool(reset_offset),
        )
        return {
            "processed": processed,
            "skipped": skipped,
            "scanned": len(rows),
            "limit": effective_limit,
            "has_more": has_more,
            "mode": "incremental",
            "at": datetime.now(UTC).isoformat(),
        }


@celery_app.task(bind=True)
def enqueue_embedding_batches(self) -> str:
    return generate_embeddings_batch.delay().id
