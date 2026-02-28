from __future__ import annotations

from decimal import Decimal
from datetime import datetime
from shared.utils.time import UTC
import re

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
from app.platform.services.canonical_matching import extract_attributes
from app.platform.services.ai_matching import ai_should_merge_duplicates
from app.platform.services.embeddings import cosine_similarity
from app.platform.services.normalization import normalize_title


_SIM_TOKENS_PATTERN = re.compile(
    r"\b(?:nanosim|nano\s*sim|micro\s*sim|dual\s*sim|esim|sim)\b",
    flags=re.IGNORECASE,
)
_STORAGE_VALUE_PATTERN = re.compile(r"\b(\d{2,4})\b")
_COLOR_KEY_CANDIDATES = ("color", "colour")


def _normalize_color(raw_value: str | None) -> str | None:
    if not raw_value:
        return None
    text = normalize_title(str(raw_value)).strip().lower()
    if not text:
        return None
    compact = re.sub(r"[^a-z0-9]+", " ", text).strip()
    if not compact:
        return None

    if re.search(r"\b(black|midnight|graphite)\b", compact):
        return "black"
    if re.search(r"\b(white|starlight)\b", compact):
        return "white"
    if re.search(r"\b(silver|gray|grey)\b", compact):
        return "silver_gray"
    if re.search(r"\b(blue|navy)\b", compact):
        return "blue"
    if re.search(r"\b(green)\b", compact):
        return "green"
    if re.search(r"\b(red)\b", compact):
        return "red"
    if re.search(r"\b(purple|violet|lavender)\b", compact):
        return "purple"
    if re.search(r"\b(pink)\b", compact):
        return "pink"
    if re.search(r"\b(gold|yellow)\b", compact):
        return "gold_yellow"

    return compact


def _title_without_sim_tokens(value: str) -> str:
    text = normalize_title(value).replace("+", " ")
    text = _SIM_TOKENS_PATTERN.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _storage_from_specs(specs: dict | None) -> str | None:
    if not isinstance(specs, dict):
        return None
    for key in ("storage_gb", "storage", "built_in_memory", "built in memory", "встроенная память"):
        raw_value = specs.get(key)
        if raw_value is None:
            continue
        match = _STORAGE_VALUE_PATTERN.search(str(raw_value))
        if match:
            value = int(match.group(1))
            if 16 <= value <= 4096:
                return str(value)
    return None


def _color_from_specs(specs: dict | None) -> str | None:
    if not isinstance(specs, dict):
        return None
    for key in _COLOR_KEY_CANDIDATES:
        raw_value = specs.get(key)
        normalized = _normalize_color(str(raw_value) if raw_value is not None else None)
        if normalized:
            return normalized
    return None


def _structural_key(product: CatalogCanonicalProduct) -> str | None:
    attrs = extract_attributes(product.normalized_title or "")
    model = attrs.model
    if model == "unknown":
        return None

    storage = attrs.storage
    if storage == "unknown":
        from_specs = _storage_from_specs(product.specs if isinstance(product.specs, dict) else None)
        if from_specs:
            storage = from_specs
    if storage == "unknown":
        return None

    brand = attrs.brand
    if brand == "unknown" and product.brand_id is not None:
        brand = f"brand#{product.brand_id}"
    if brand == "unknown":
        return None
    color = _color_from_specs(product.specs if isinstance(product.specs, dict) else None)
    if color is None:
        # Use a medium-strength structural key when color is missing to avoid
        # under-merging sparse specs; color conflicts are still handled by score.
        return f"{brand}|{model}|{storage}"
    return f"{brand}|{model}|{storage}|{color}"


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
    title_wo_sim_score = (
        1.0 if _title_without_sim_tokens(a.normalized_title) == _title_without_sim_tokens(b.normalized_title) else 0.0
    )
    specs_score = _spec_overlap_score(a.specs if isinstance(a.specs, dict) else {}, b.specs if isinstance(b.specs, dict) else {})
    emb_score = 0.0
    if a.embedding is not None and b.embedding is not None:
        emb_score = cosine_similarity(a.embedding, b.embedding)
    score = 0.50 * title_score + 0.15 * title_wo_sim_score + 0.20 * specs_score + 0.15 * emb_score
    reason = "title_specs_embedding"
    if title_score == 1.0:
        # Exact normalized-title matches should be merged without relying on embeddings/AI.
        score = max(score, 0.97)
        reason = "same_normalized_title"
    elif title_wo_sim_score == 1.0:
        # Same model title except SIM-marketing tokens: treat as duplicate canonical.
        score = max(score, 0.96)
        reason = "same_title_without_sim_tokens"

    left_key = _structural_key(a)
    right_key = _structural_key(b)
    if left_key and right_key and left_key == right_key:
        # Strong duplicate signal for canonical products: same brand/model/storage/color key.
        score = max(score, 0.97)
        reason = "same_structural_key"

    if title_score == 1.0 and specs_score >= 0.6:
        reason = "same_normalized_title_and_specs"
    return score, reason


async def find_duplicate_candidates(session: AsyncSession, limit: int = 500) -> int:
    products = (
        await session.execute(
            select(CatalogCanonicalProduct)
            .where(CatalogCanonicalProduct.is_active.is_(True))
            .order_by(CatalogCanonicalProduct.updated_at.desc(), CatalogCanonicalProduct.id.desc())
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

