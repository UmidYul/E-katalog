from __future__ import annotations

from decimal import Decimal

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.platform.models import (
    CatalogCanonicalProduct,
    CatalogDuplicateCandidate,
    CatalogOffer,
    CatalogProduct,
    CatalogStoreProduct,
)
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
    if a.embedding and b.embedding:
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
        await session.execute(CatalogCanonicalProduct.__table__.delete().where(CatalogCanonicalProduct.id == duplicate_id))

        candidate.status = "merged"
        merged += 1

    await session.commit()
    return merged
