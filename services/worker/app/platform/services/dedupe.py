from __future__ import annotations

from decimal import Decimal
from datetime import UTC, datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.platform.models import (
    CatalogCanonicalMergeEvent,
    CatalogCanonicalProduct,
    CatalogDuplicateCandidate,
    CatalogOffer,
    CatalogProduct,
    CatalogStoreProduct,
)
from app.platform.services.ai_matching import ai_should_merge_duplicates
from app.platform.services.embeddings import cosine_similarity
from app.platform.services.normalization import normalize_title


def _spec_overlap_score(specs_a: dict, specs_b: dict) -> float:
    if not specs_a or not specs_b:
        return 0.0
    keys = set(specs_a.keys()) & set(specs_b.keys())
    if not keys:
        return 0.0
    same = sum(1 for key in keys if str(specs_a.get(key)).strip().lower() == str(specs_b.get(key)).strip().lower())
    return same / max(len(keys), 1)


def _pair_score(a: CatalogCanonicalProduct, b: CatalogCanonicalProduct) -> tuple[float, str]:
    title_score = 1.0 if normalize_title(a.normalized_title) == normalize_title(b.normalized_title) else 0.0
    specs_score = _spec_overlap_score(a.specs if isinstance(a.specs, dict) else {}, b.specs if isinstance(b.specs, dict) else {})
    emb_score = 0.0
    if a.embedding is not None and b.embedding is not None:
        emb_score = cosine_similarity(a.embedding, b.embedding)
    score = 0.55 * title_score + 0.25 * specs_score + 0.20 * emb_score
    reason = "title_specs_embedding"
    if title_score == 1.0 and specs_score >= 0.6:
        reason = "same_normalized_title_and_specs"
    return score, reason


async def find_duplicate_candidates(session: AsyncSession, limit: int = 500) -> int:
    products = (
        await session.execute(
            select(CatalogCanonicalProduct)
            .where(CatalogCanonicalProduct.is_active.is_(True))
            .order_by(CatalogCanonicalProduct.updated_at.asc(), CatalogCanonicalProduct.id.asc())
            .limit(limit)
        )
    ).scalars().all()

    created = 0
    for idx, left in enumerate(products):
        for right in products[idx + 1 :]:
            if left.category_id != right.category_id:
                continue
            if left.brand_id != right.brand_id:
                continue
            score, reason = _pair_score(left, right)
            if score < 0.88:
                continue
            a, b = sorted((left.id, right.id))
            exists = await session.execute(
                select(CatalogDuplicateCandidate.id).where(
                    CatalogDuplicateCandidate.product_id_a == a,
                    CatalogDuplicateCandidate.product_id_b == b,
                )
            )
            if exists.scalar_one_or_none() is not None:
                continue
            session.add(
                CatalogDuplicateCandidate(
                    product_id_a=a,
                    product_id_b=b,
                    score=Decimal(f"{score:.4f}"),
                    reason=reason,
                    status="pending",
                )
            )
            created += 1

    await session.commit()
    return created


async def merge_high_confidence_duplicates(session: AsyncSession, limit: int = 200, threshold: float = 0.95) -> int:
    candidates = (
        await session.execute(
            select(CatalogDuplicateCandidate)
            .where(
                and_(
                    CatalogDuplicateCandidate.status == "pending",
                    CatalogDuplicateCandidate.score >= Decimal(f"{threshold:.4f}"),
                )
            )
            .order_by(CatalogDuplicateCandidate.score.desc(), CatalogDuplicateCandidate.id.asc())
            .limit(limit)
        )
    ).scalars().all()

    merged = 0
    for candidate in candidates:
        master_id = min(candidate.product_id_a, candidate.product_id_b)
        duplicate_id = max(candidate.product_id_a, candidate.product_id_b)
        if master_id == duplicate_id:
            candidate.status = "rejected"
            candidate.reviewed_at = datetime.now(UTC)
            continue

        master = (
            await session.execute(
                select(CatalogCanonicalProduct).where(CatalogCanonicalProduct.id == master_id)
            )
        ).scalar_one_or_none()
        duplicate = (
            await session.execute(
                select(CatalogCanonicalProduct).where(CatalogCanonicalProduct.id == duplicate_id)
            )
        ).scalar_one_or_none()
        if not master or not duplicate:
            candidate.status = "rejected"
            candidate.reviewed_at = datetime.now(UTC)
            continue
        if not master.is_active or not duplicate.is_active:
            candidate.status = "rejected"
            candidate.reviewed_at = datetime.now(UTC)
            continue

        ai_merge, ai_confidence, ai_reason = await ai_should_merge_duplicates(
            left={
                "id": master.id,
                "title": master.normalized_title,
                "category_id": master.category_id,
                "brand_id": master.brand_id,
                "specs": master.specs if isinstance(master.specs, dict) else {},
            },
            right={
                "id": duplicate.id,
                "title": duplicate.normalized_title,
                "category_id": duplicate.category_id,
                "brand_id": duplicate.brand_id,
                "specs": duplicate.specs if isinstance(duplicate.specs, dict) else {},
            },
        )
        if settings.ai_dedupe_merge_enabled and (not ai_merge or ai_confidence < settings.ai_dedupe_min_confidence):
            candidate.status = "rejected"
            candidate.reviewed_at = datetime.now(UTC)
            session.add(
                CatalogCanonicalMergeEvent(
                    from_product_id=duplicate_id,
                    to_product_id=master_id,
                    reason="ai_rejected_merge",
                    score=candidate.score,
                    payload={
                        "candidate_id": candidate.id,
                        "ai_merge": ai_merge,
                        "ai_confidence": ai_confidence,
                        "ai_reason": ai_reason,
                    },
                )
            )
            continue

        await session.execute(
            CatalogStoreProduct.__table__.update()
            .where(CatalogStoreProduct.canonical_product_id == duplicate_id)
            .values(canonical_product_id=master_id)
        )
        await session.execute(
            CatalogOffer.__table__.update()
            .where(CatalogOffer.canonical_product_id == duplicate_id)
            .values(canonical_product_id=master_id)
        )
        await session.execute(
            CatalogProduct.__table__.update()
            .where(CatalogProduct.canonical_product_id == duplicate_id)
            .values(canonical_product_id=master_id)
        )
        duplicate.is_active = False
        duplicate.merged_into_id = master_id
        session.add(
            CatalogCanonicalMergeEvent(
                from_product_id=duplicate_id,
                to_product_id=master_id,
                reason=candidate.reason,
                score=candidate.score,
                payload={
                    "candidate_id": candidate.id,
                    "ai_merge": ai_merge,
                    "ai_confidence": ai_confidence,
                    "ai_reason": ai_reason,
                },
            )
        )

        candidate.status = "merged"
        candidate.reviewed_at = datetime.now(UTC)
        merged += 1

    await session.commit()
    return merged
