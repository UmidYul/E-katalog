from __future__ import annotations

from datetime import datetime
from time import perf_counter
from shared.utils.time import UTC

from sqlalchemy import text

from app.core.config import settings
from app.core.logging import logger
from app.core.asyncio_runner import run_async_task
from app.core.metrics import add_products_processed, observe_stage_duration
from app.db.session import AsyncSessionLocal
from app.platform.models import CatalogAIEnrichmentJob
from app.platform.services.embeddings import (
    batch_embeddings,
    embedding_backend_name,
    embedding_dimension,
    embedding_model_name,
)
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
    target_ids: list[int] | None = None,
) -> dict:
    started = perf_counter()
    status = "ok"
    try:
        result = run_async_task(_run(limit, reset_offset=reset_offset, target_ids=target_ids))
        add_products_processed(stage="embedding", count=int(result.get("processed", 0)))
        if not target_ids and followup and bool(result.get("has_more")):
            self.apply_async(
                kwargs={
                    "limit": int(result.get("limit") or 400),
                    "reset_offset": False,
                    "followup": True,
                }
            )
        return result
    except Exception:  # noqa: BLE001
        status = "error"
        raise
    finally:
        observe_stage_duration(stage="embedding", seconds=perf_counter() - started, status=status)


def _to_pgvector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{float(value):.8f}" for value in values) + "]"


async def _run(limit: int, *, reset_offset: bool = False, target_ids: list[int] | None = None) -> dict:
    parsed_limit = int(limit) if isinstance(limit, int) and int(limit) > 0 else int(settings.embedding_batch_limit)
    effective_limit = max(100, parsed_limit)
    job_name = "canonical_embeddings"
    normalized_target_ids = sorted({int(item) for item in (target_ids or []) if int(item) > 0})
    async with AsyncSessionLocal() as session:
        if normalized_target_ids:
            rows = (
                await session.execute(
                    text(
                        """
                        select cp.id, cp.normalized_title, cp.updated_at
                        from catalog_canonical_products cp
                        where cp.id = any(cast(:target_ids as bigint[]))
                          and cp.is_active = true
                          and cp.normalized_title is not null
                          and btrim(cp.normalized_title) <> ''
                        order by cp.id asc
                        limit :limit
                        """
                    ),
                    {"target_ids": normalized_target_ids, "limit": effective_limit},
                )
            ).mappings().all()
            last_ts = None
            last_id = 0
        else:
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
        title_rows = []
        for row in rows:
            normalized_title = str(row["normalized_title"] or "").strip()
            if not normalized_title:
                skipped += 1
                continue
            title_rows.append((int(row["id"]), normalized_title, row["updated_at"]))

        expected_dim = embedding_dimension()
        vectors = batch_embeddings([row[1] for row in title_rows], dim=expected_dim)
        for (canonical_product_id, _normalized_title, updated_at), embedding in zip(title_rows, vectors, strict=True):
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
                    payload={
                        "model": embedding_model_name(),
                        "dimension": expected_dim,
                        "job": job_name,
                        "embedding_backend": embedding_backend_name(),
                    },
                )
            )
            processed += 1
            watermark_ts = updated_at
            watermark_id = canonical_product_id

        if rows and not normalized_target_ids:
            await set_offset(session, job_name, last_ts=watermark_ts, last_id=watermark_id)

        await session.commit()
        has_more = (len(rows) >= effective_limit) if not normalized_target_ids else False
        logger.info(
            "embedding_batch_completed",
            processed=processed,
            skipped=skipped,
            scanned=len(rows),
            limit=effective_limit,
            has_more=has_more,
            reset_offset=bool(reset_offset),
            target_mode=bool(normalized_target_ids),
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

