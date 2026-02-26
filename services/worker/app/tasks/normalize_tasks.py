from __future__ import annotations

import asyncio
import re
from datetime import UTC, datetime
from urllib.parse import unquote

from sqlalchemy import func, select, text

from app.core.config import settings
from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.platform.models import (
    CatalogAIEnrichmentJob,
    CatalogBrand,
    CatalogCanonicalProduct,
    CatalogOffer,
    CatalogProduct,
    CatalogSeller,
    CatalogStore,
    CatalogStoreProduct,
)
from app.platform.services.normalization import (
    build_canonical_title,
    detect_brand,
    enrich_specs_from_title,
    normalize_seller_name,
    normalize_specs,
    normalize_title,
)
from app.platform.services.pipeline_offsets import ensure_offsets_table, get_offset, set_offset
from app.platform.services.ai_matching import ai_choose_canonical_candidate
from app.platform.services.canonical_index import resolve_canonical_by_key, upsert_canonical_index_entry
from app.platform.services.canonical_matching import canonical_key, extract_attributes
from app.celery_app import celery_app

_LOW_QUALITY_IMAGE_HINTS: tuple[str, ...] = (
    "banner",
    "poster",
    "promo",
    "advert",
    "logo",
    "watermark",
    "placeholder",
    "preview",
    "thumbnail",
    "thumb",
)
_WEAK_QUALITY_IMAGE_HINTS: tuple[str, ...] = ("moderation",)
_POSTER_IMAGE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?<!\w)frame(?!\w)", re.IGNORECASE),
    re.compile(r"(?<!\w)photo\s+\d{4}(?!\d)", re.IGNORECASE),
)
_IMAGE_URL_EXTENSIONS: tuple[str, ...] = (
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".avif",
    ".bmp",
    ".heic",
    ".heif",
)

_COLOR_HINTS: tuple[tuple[str, str], ...] = (
    ("cosmic orange", "cosmic orange"),
    ("deep blue", "deep blue"),
    ("mist blue", "mist blue"),
    ("ultramarine", "ultramarine"),
    ("midnight", "midnight"),
    ("graphite", "graphite"),
    ("silver", "silver"),
    ("white", "white"),
    ("black", "black"),
    ("blue", "blue"),
    ("green", "green"),
    ("pink", "pink"),
    ("yellow", "yellow"),
    ("orange", "orange"),
    ("серебрист", "silver"),
    ("бел", "white"),
    ("черн", "black"),
    ("син", "blue"),
    ("зелен", "green"),
    ("розов", "pink"),
    ("желт", "yellow"),
    ("оранж", "orange"),
)


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=7,
)
def normalize_product_batch(self, limit: int = 500, reset_offset: bool = False) -> dict:
    return asyncio.run(_normalize_product_batch(limit, reset_offset=reset_offset))


def _normalize_image_text(value: str | None) -> str:
    text = unquote(str(value or "")).lower()
    text = text.replace("_", " ").replace("-", " ").replace("/", " ")
    text = re.sub(r"[^\w\s]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def _contains_image_hint(normalized_text: str, token: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(token)}(?!\w)", normalized_text, flags=re.IGNORECASE) is not None


def _has_known_image_extension(url: str | None) -> bool:
    normalized = unquote(str(url or "")).strip().lower()
    if not normalized:
        return False
    base = normalized.split("?", 1)[0].split("#", 1)[0]
    return any(base.endswith(extension) for extension in _IMAGE_URL_EXTENSIONS)


def _looks_like_poster_image(url: str | None) -> bool:
    normalized = _normalize_image_text(url)
    if not normalized:
        return True
    return any(pattern.search(normalized) is not None for pattern in _POSTER_IMAGE_PATTERNS)


def _image_quality_penalty(url: str | None) -> int:
    normalized = _normalize_image_text(url)
    if not normalized:
        return 200

    penalty = 0
    if any(_contains_image_hint(normalized, token) for token in _LOW_QUALITY_IMAGE_HINTS):
        penalty += 55
    if any(_contains_image_hint(normalized, token) for token in _WEAK_QUALITY_IMAGE_HINTS):
        penalty += 15
    if _looks_like_poster_image(url):
        penalty += 50
    if not _has_known_image_extension(url):
        penalty += 25
    return penalty


def _is_low_quality_image(url: str | None) -> bool:
    return _image_quality_penalty(url) >= 50


def _extract_color_hint(value: str | None) -> str | None:
    normalized = _normalize_image_text(value)
    if not normalized:
        return None
    for token, canonical in _COLOR_HINTS:
        if token in normalized:
            return canonical
    return None


def _choose_preferred_image(
    *,
    primary_image: str | None,
    metadata_images: object,
    target_color: str | None,
) -> str | None:
    candidates: list[tuple[str, int, int]] = []
    seen: set[str] = set()
    order = 0

    if isinstance(metadata_images, list):
        for item in metadata_images:
            url = str(item or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            candidates.append((url, 0, order))
            order += 1

    primary = str(primary_image or "").strip()
    if primary and primary not in seen:
        seen.add(primary)
        candidates.append((primary, 1, order))

    if not candidates:
        return primary or None

    target = _extract_color_hint(target_color)
    scored: list[tuple[int, int, int, int, str]] = []
    for url, source_priority, insertion_order in candidates:
        quality_penalty = _image_quality_penalty(url)
        score = 100 - (source_priority * 8) - quality_penalty
        has_extension = _has_known_image_extension(url)
        if has_extension:
            score += 10
        color_hint = _extract_color_hint(url)
        if target and color_hint:
            if color_hint == target:
                score += 30
            else:
                score -= 20
        scored.append((score, int(has_extension), -source_priority, -insertion_order, url))

    scored.sort(reverse=True)
    return scored[0][4]


async def _resolve_or_create_canonical(session, *, title: str, category_id: int, brand_id: int | None, specs: dict, image: str | None):
    canonical_attrs = extract_attributes(title)
    key_value = canonical_key(canonical_attrs)
    indexed_canonical_id = await resolve_canonical_by_key(session, canonical_key_value=key_value)
    if indexed_canonical_id is not None:
        indexed_canonical = (
            await session.execute(
                select(CatalogCanonicalProduct).where(
                    CatalogCanonicalProduct.id == indexed_canonical_id,
                    CatalogCanonicalProduct.category_id == category_id,
                    CatalogCanonicalProduct.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if indexed_canonical is not None:
            if brand_id is not None and indexed_canonical.brand_id is None:
                indexed_canonical.brand_id = brand_id
            if image and (
                not indexed_canonical.main_image
                or (_is_low_quality_image(indexed_canonical.main_image) and not _is_low_quality_image(image))
            ):
                indexed_canonical.main_image = image
            if specs and (not isinstance(indexed_canonical.specs, dict) or not indexed_canonical.specs):
                indexed_canonical.specs = specs
            return indexed_canonical

    canonical = (
        await session.execute(
            select(CatalogCanonicalProduct).where(
                CatalogCanonicalProduct.category_id == category_id,
                CatalogCanonicalProduct.brand_id == brand_id,
                CatalogCanonicalProduct.normalized_title == title,
                CatalogCanonicalProduct.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if canonical:
        if image and (
            not canonical.main_image
            or (_is_low_quality_image(canonical.main_image) and not _is_low_quality_image(image))
        ):
            canonical.main_image = image
        if specs and (not isinstance(canonical.specs, dict) or not canonical.specs):
            canonical.specs = specs
        return canonical

    # Upgrade existing neutral canonical records once brand becomes known.
    if brand_id is not None:
        neutral = (
            await session.execute(
                select(CatalogCanonicalProduct).where(
                    CatalogCanonicalProduct.category_id == category_id,
                    CatalogCanonicalProduct.brand_id.is_(None),
                    CatalogCanonicalProduct.normalized_title == title,
                    CatalogCanonicalProduct.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if neutral:
            neutral.brand_id = brand_id
            if image and (
                not neutral.main_image
                or (_is_low_quality_image(neutral.main_image) and not _is_low_quality_image(image))
            ):
                neutral.main_image = image
            if specs and (not isinstance(neutral.specs, dict) or not neutral.specs):
                neutral.specs = specs
            return neutral

    ai_candidate_id = await _find_ai_canonical_candidate(
        session,
        title=title,
        category_id=category_id,
        brand_id=brand_id,
        specs=specs,
    )
    if ai_candidate_id is not None:
        canonical = (
            await session.execute(
                select(CatalogCanonicalProduct).where(
                    CatalogCanonicalProduct.id == ai_candidate_id,
                    CatalogCanonicalProduct.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if canonical:
            if image and (
                not canonical.main_image
                or (_is_low_quality_image(canonical.main_image) and not _is_low_quality_image(image))
            ):
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


async def _find_ai_canonical_candidate(
    session,
    *,
    title: str,
    category_id: int,
    brand_id: int | None,
    specs: dict,
) -> int | None:
    if not settings.ai_canonical_matching_enabled:
        return None
    query = text(
        """
        select id, normalized_title, specs
        from catalog_canonical_products
        where is_active = true
          and category_id = :category_id
          and brand_id is not distinct from cast(:brand_id as bigint)
          and similarity(lower(normalized_title), lower(:title)) >= 0.25
        order by similarity(lower(normalized_title), lower(:title)) desc, id asc
        limit :limit
        """
    )
    rows = (
        await session.execute(
            query,
            {
                "category_id": category_id,
                "brand_id": brand_id,
                "title": title,
                "limit": settings.ai_canonical_candidates_limit,
            },
        )
    ).mappings().all()
    if not rows:
        return None
    candidates = [
        {
            "id": int(row["id"]),
            "title": str(row["normalized_title"]),
            "specs": row["specs"] if isinstance(row["specs"], dict) else {},
        }
        for row in rows
    ]
    candidate_id, confidence, reason = await ai_choose_canonical_candidate(
        input_title=title,
        input_specs=specs,
        candidates=candidates,
    )
    logger.info(
        "ai_canonical_resolution",
        title=title,
        candidate_id=candidate_id,
        confidence=confidence,
        reason=reason,
        candidates=len(candidates),
    )
    if candidate_id is None:
        return None
    if confidence < settings.ai_canonical_min_confidence:
        return None
    return int(candidate_id)


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


async def _resolve_or_create_brand(session, *, brand_name: str) -> int | None:
    normalized = normalize_title(brand_name)
    if not normalized:
        return None

    brand = (
        await session.execute(
            select(CatalogBrand).where(
                (CatalogBrand.normalized_name == normalized) | (func.lower(CatalogBrand.name) == normalized)
            )
        )
    ).scalar_one_or_none()
    if brand:
        if brand.name != brand_name:
            brand.name = brand_name
        return int(brand.id)

    brand = CatalogBrand(name=brand_name, normalized_name=normalized, aliases=[])
    session.add(brand)
    await session.flush()
    return int(brand.id)


async def _normalize_product_batch(limit: int, *, reset_offset: bool = False) -> dict:
    processed = 0
    watermark_ts = None
    watermark_id = 0
    async with AsyncSessionLocal() as session:
        await ensure_offsets_table(session)
        if reset_offset:
            last_ts, last_id = None, 0
        else:
            last_ts, last_id = await get_offset(session, "normalize_store_products")

        filters = []
        if last_ts is not None:
            filters.append(
                (CatalogStoreProduct.updated_at > last_ts)
                | ((CatalogStoreProduct.updated_at == last_ts) & (CatalogStoreProduct.id > last_id))
            )
        stmt = (
            select(CatalogStoreProduct, CatalogProduct, CatalogStore)
            .join(CatalogStore, CatalogStore.id == CatalogStoreProduct.store_id)
            .outerjoin(CatalogProduct, CatalogProduct.id == CatalogStoreProduct.product_id)
        )
        if filters:
            stmt = stmt.where(*filters)
        stmt = stmt.order_by(CatalogStoreProduct.updated_at.asc(), CatalogStoreProduct.id.asc()).limit(limit)
        rows = (
            await session.execute(
                stmt
            )
        ).all()

        for store_product, product, store in rows:
            store_product_updated_at = store_product.updated_at
            title_source = store_product.title_clean or store_product.title_raw
            normalized = normalize_title(title_source)
            canonical_title = build_canonical_title(title_source)
            metadata = store_product.metadata_json if isinstance(store_product.metadata_json, dict) else {}
            specs = normalize_specs(metadata.get("specifications") or metadata.get("specs"))
            specs = enrich_specs_from_title(title_source, specs)
            preferred_image = _choose_preferred_image(
                primary_image=store_product.image_url,
                metadata_images=metadata.get("images"),
                target_color=str(specs.get("color") or ""),
            )
            category_id = product.category_id if product and product.category_id else 1
            inferred_brand = detect_brand(title_source, specs)
            if inferred_brand:
                brand_id = await _resolve_or_create_brand(
                    session,
                    brand_name=inferred_brand.title(),
                )
            else:
                brand_id = product.brand_id if product else None

            canonical = await _resolve_or_create_canonical(
                session,
                title=canonical_title,
                category_id=category_id,
                brand_id=brand_id,
                specs=specs,
                image=preferred_image,
            )
            await upsert_canonical_index_entry(
                session,
                canonical_product_id=int(canonical.id),
                canonical_title=str(canonical.normalized_title or canonical_title),
                source="normalize",
            )

            store_product.canonical_product_id = canonical.id
            if product:
                product.normalized_title = normalized
                product.canonical_product_id = canonical.id
                if brand_id is not None and product.brand_id != brand_id:
                    product.brand_id = brand_id

            if brand_id is not None and canonical.brand_id != brand_id:
                canonical.brand_id = brand_id

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
            watermark_ts = store_product_updated_at
            watermark_id = int(store_product.id)

        if processed:
            await set_offset(
                session,
                "normalize_store_products",
                last_ts=watermark_ts,
                last_id=watermark_id,
            )
        await session.commit()
        logger.info("normalize_batch_completed", processed=processed)
        return {"processed": processed, "at": datetime.now(UTC).isoformat()}


@celery_app.task(bind=True)
def enqueue_dirty_products(self) -> int:
    return 1 if normalize_product_batch.delay().id else 0


@celery_app.task(bind=True)
def normalize_full_catalog(self, chunk_size: int = 500) -> dict:
    return asyncio.run(_normalize_full_catalog(chunk_size))


async def _normalize_full_catalog(chunk_size: int) -> dict:
    total = 0
    reset = True
    while True:
        result = await _normalize_product_batch(chunk_size, reset_offset=reset)
        reset = False
        processed = int(result.get("processed", 0))
        total += processed
        if processed == 0:
            break
    return {"processed": total, "at": datetime.now(UTC).isoformat()}
