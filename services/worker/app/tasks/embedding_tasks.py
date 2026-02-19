from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.config import settings
from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.platform.models import CatalogAIEnrichmentJob, CatalogCanonicalProduct
from app.platform.services.embeddings import simple_embedding
from app.celery_app import celery_app


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=7,
)
def generate_embeddings_batch(self, limit: int = 400) -> dict:
    return asyncio.run(_run(limit))


async def _run(limit: int) -> dict:
    async with AsyncSessionLocal() as session:
        products = (
            await session.execute(
                select(CatalogCanonicalProduct).order_by(CatalogCanonicalProduct.updated_at.asc()).limit(limit)
            )
        ).scalars().all()

        for product in products:
            embedding = simple_embedding(product.normalized_title)
            product.embedding = embedding
            session.add(
                CatalogAIEnrichmentJob(
                    product_id=product.id,
                    stage="embedding",
                    status="done",
                    payload={"model": settings.openai_model},
                )
            )

        await session.commit()
        logger.info("embedding_batch_completed", processed=len(products))
        return {"processed": len(products), "at": datetime.now(UTC).isoformat()}


@celery_app.task(bind=True)
def enqueue_embedding_batches(self) -> str:
    return generate_embeddings_batch.delay().id
