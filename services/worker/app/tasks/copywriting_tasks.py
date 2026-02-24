from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import select, text

from app.celery_app import celery_app
from app.core.config import settings
from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.platform.models import CatalogAIEnrichmentJob, CatalogCanonicalProduct
from app.platform.services.ai_copywriting import generate_product_copy


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=7,
)
def generate_product_copy_batch(self, limit: int | None = None) -> dict:
    requested_limit = int(limit or settings.ai_product_copy_batch_limit)
    requested_limit = max(1, min(requested_limit, 5000))
    return asyncio.run(_run(requested_limit))


async def _fetch_candidate_ids(session, limit: int) -> list[int]:
    stmt = text(
        """
        select cp.id
        from catalog_canonical_products cp
        where cp.is_active = true
          and (
            cp.ai_short_description is null
            or cp.ai_copy_source_hash is null
            or cp.ai_copy_generated_at is null
            or cp.updated_at > cp.ai_copy_generated_at
            or exists (
                select 1
                from catalog_store_products sp
                where sp.canonical_product_id = cp.id
                  and sp.updated_at > coalesce(cp.ai_copy_generated_at, to_timestamp(0))
            )
          )
        order by cp.updated_at asc, cp.id asc
        limit :limit
        """
    )
    rows = (await session.execute(stmt, {"limit": limit})).all()
    return [int(row.id) for row in rows]


async def _run(limit: int) -> dict:
    processed = 0
    updated = 0
    skipped = 0
    failed = 0

    if not settings.ai_product_copy_enabled:
        return {
            "processed": 0,
            "updated": 0,
            "skipped": 0,
            "failed": 0,
            "disabled": True,
            "at": datetime.now(UTC).isoformat(),
        }

    async with AsyncSessionLocal() as session:
        candidate_ids = await _fetch_candidate_ids(session, limit)
        if not candidate_ids:
            return {"processed": 0, "updated": 0, "skipped": 0, "failed": 0, "at": datetime.now(UTC).isoformat()}

        products = (
            await session.execute(
                select(CatalogCanonicalProduct)
                .where(CatalogCanonicalProduct.id.in_(candidate_ids))
                .order_by(CatalogCanonicalProduct.updated_at.asc(), CatalogCanonicalProduct.id.asc())
            )
        ).scalars().all()

        for product in products:
            processed += 1
            try:
                copy_payload = await generate_product_copy(
                    session,
                    product=product,
                    min_compare_confidence=settings.ai_product_copy_min_compare_confidence,
                )
                source_hash = str(copy_payload.get("source_hash") or "")
                current_whats_new = product.ai_whats_new if isinstance(product.ai_whats_new, list) else []
                current_has_copy = bool(product.ai_short_description and current_whats_new)
                if source_hash and source_hash == product.ai_copy_source_hash and current_has_copy:
                    skipped += 1
                    session.add(
                        CatalogAIEnrichmentJob(
                            product_id=product.id,
                            stage="copywriting",
                            status="done",
                            payload={"source": "celery", "skipped": True, "reason": "source_hash_unchanged"},
                        )
                    )
                    continue

                product.ai_short_description = copy_payload.get("short_description")
                product.ai_whats_new = copy_payload.get("whats_new") or []
                product.ai_copy_source_hash = source_hash or None
                product.ai_copy_generated_at = datetime.now(UTC)
                updated += 1

                session.add(
                    CatalogAIEnrichmentJob(
                        product_id=product.id,
                        stage="copywriting",
                        status="done",
                        payload={
                            "source": "celery",
                            "mode": copy_payload.get("mode"),
                            "compare_confidence": copy_payload.get("compare_confidence"),
                        },
                    )
                )
            except Exception as exc:  # noqa: BLE001
                failed += 1
                session.add(
                    CatalogAIEnrichmentJob(
                        product_id=product.id,
                        stage="copywriting",
                        status="failed",
                        payload={"source": "celery"},
                        error=str(exc)[:1000],
                    )
                )
                logger.warning("copywriting_generation_failed", product_id=product.id, error=str(exc))

        await session.commit()

    logger.info(
        "copywriting_batch_completed",
        processed=processed,
        updated=updated,
        skipped=skipped,
        failed=failed,
    )
    return {
        "processed": processed,
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def enqueue_product_copy_batches(self) -> str:
    return generate_product_copy_batch.delay().id
