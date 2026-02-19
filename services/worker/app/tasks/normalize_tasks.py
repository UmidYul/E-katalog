from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.platform.models import CatalogAIEnrichmentJob, CatalogProduct
from app.platform.services.normalization import normalize_title
from app.celery_app import celery_app


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=7,
)
def normalize_product_batch(self, limit: int = 500) -> dict:
    return asyncio.run(_normalize_product_batch(limit))


async def _normalize_product_batch(limit: int) -> dict:
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(CatalogProduct)
                .where(CatalogProduct.status == "active")
                .order_by(CatalogProduct.updated_at.asc())
                .limit(limit)
            )
        ).scalars().all()

        for product in rows:
            product.normalized_title = normalize_title(product.normalized_title)
            session.add(
                CatalogAIEnrichmentJob(
                    product_id=product.id,
                    stage="normalize",
                    status="done",
                    payload={"source": "celery"},
                )
            )
        await session.commit()
        logger.info("normalize_batch_completed", processed=len(rows))
        return {"processed": len(rows), "at": datetime.now(UTC).isoformat()}


@celery_app.task(bind=True)
def enqueue_dirty_products(self) -> int:
    return 1 if normalize_product_batch.delay().id else 0
