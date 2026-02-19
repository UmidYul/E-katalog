from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.platform.models import (
    CatalogAIEnrichmentJob,
    CatalogCanonicalProduct,
    CatalogOffer,
    CatalogProduct,
    CatalogSeller,
    CatalogStore,
    CatalogStoreProduct,
)
from app.platform.services.normalization import normalize_seller_name, normalize_specs, normalize_title
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


async def _resolve_or_create_canonical(session, *, title: str, category_id: int, brand_id: int | None, specs: dict, image: str | None):
    canonical = (
        await session.execute(
            select(CatalogCanonicalProduct).where(
                CatalogCanonicalProduct.category_id == category_id,
                CatalogCanonicalProduct.brand_id == brand_id,
                CatalogCanonicalProduct.normalized_title == title,
            )
        )
    ).scalar_one_or_none()
    if canonical:
        if image and not canonical.main_image:
            canonical.main_image = image
        if specs and (not isinstance(canonical.specs, dict) or not canonical.specs):
            canonical.specs = specs
        return canonical

    canonical = CatalogCanonicalProduct(
        normalized_title=title,
        category_id=category_id,
        brand_id=brand_id,
        specs=specs or {},
        main_image=image,
    )
    session.add(canonical)
    await session.flush()
    return canonical


async def _resolve_or_create_seller(session, *, store_id: int, store_name: str, metadata: dict) -> CatalogSeller:
    seller_name = normalize_seller_name(metadata.get("seller_name"), store_name)
    normalized_name = normalize_title(seller_name)
    seller = (
        await session.execute(
            select(CatalogSeller).where(
                CatalogSeller.store_id == store_id,
                CatalogSeller.normalized_name == normalized_name,
            )
        )
    ).scalar_one_or_none()
    if seller:
        return seller
    seller = CatalogSeller(store_id=store_id, name=seller_name, normalized_name=normalized_name)
    session.add(seller)
    await session.flush()
    return seller


async def _normalize_product_batch(limit: int) -> dict:
    processed = 0
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(CatalogStoreProduct, CatalogProduct, CatalogStore)
                .join(CatalogStore, CatalogStore.id == CatalogStoreProduct.store_id)
                .outerjoin(CatalogProduct, CatalogProduct.id == CatalogStoreProduct.product_id)
                .order_by(CatalogStoreProduct.updated_at.asc())
                .limit(limit)
            )
        ).all()

        for store_product, product, store in rows:
            title_source = store_product.title_clean or store_product.title_raw
            normalized = normalize_title(title_source)
            metadata = store_product.metadata_json if isinstance(store_product.metadata_json, dict) else {}
            specs = normalize_specs(metadata.get("specifications") or metadata.get("specs"))
            category_id = product.category_id if product and product.category_id else 1
            brand_id = product.brand_id if product else None

            canonical = await _resolve_or_create_canonical(
                session,
                title=normalized,
                category_id=category_id,
                brand_id=brand_id,
                specs=specs,
                image=store_product.image_url,
            )

            store_product.canonical_product_id = canonical.id
            if product:
                product.normalized_title = normalized
                product.canonical_product_id = canonical.id

            seller = await _resolve_or_create_seller(
                session,
                store_id=store_product.store_id,
                store_name=store.name,
                metadata=metadata,
            )

            delivery_value = metadata.get("delivery_days")
            try:
                delivery_days = int(delivery_value) if delivery_value is not None else None
            except (ValueError, TypeError):
                delivery_days = None

            await session.execute(
                CatalogOffer.__table__.update()
                .where(CatalogOffer.store_product_id == store_product.id)
                .values(
                    canonical_product_id=canonical.id,
                    store_id=store_product.store_id,
                    seller_id=seller.id,
                    offer_url=store_product.external_url,
                    delivery_days=delivery_days,
                )
            )

            session.add(
                CatalogAIEnrichmentJob(
                    product_id=canonical.id,
                    stage="normalize",
                    status="done",
                    payload={"source": "celery", "store_product_id": store_product.id},
                )
            )
            processed += 1

        await session.commit()
        logger.info("normalize_batch_completed", processed=processed)
        return {"processed": processed, "at": datetime.now(UTC).isoformat()}


@celery_app.task(bind=True)
def enqueue_dirty_products(self) -> int:
    return 1 if normalize_product_batch.delay().id else 0
