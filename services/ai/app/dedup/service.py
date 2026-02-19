from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db.models import CatalogDuplicateCandidate, CatalogProduct
from ai.app.normalization.service import normalize_title


async def find_duplicate_candidates(session: AsyncSession, limit: int = 500) -> int:
    products = (
        await session.execute(
            select(CatalogProduct.id, CatalogProduct.category_id, CatalogProduct.brand_id, CatalogProduct.normalized_title)
            .where(CatalogProduct.status == "active")
            .limit(limit)
        )
    ).all()

    created = 0
    seen: dict[tuple[int, int | None, str], int] = {}
    for row in products:
        key = (row.category_id, row.brand_id, normalize_title(row.normalized_title))
        existing = seen.get(key)
        if existing and existing != row.id:
            a, b = sorted((existing, row.id))
            exists = await session.execute(
                select(CatalogDuplicateCandidate.id).where(
                    CatalogDuplicateCandidate.product_id_a == a,
                    CatalogDuplicateCandidate.product_id_b == b,
                )
            )
            if exists.scalar_one_or_none() is None:
                session.add(
                    CatalogDuplicateCandidate(
                        product_id_a=a,
                        product_id_b=b,
                        score=Decimal("0.9200"),
                        reason="same_category_brand_normalized_title",
                        status="pending",
                    )
                )
                created += 1
        else:
            seen[key] = row.id

    await session.commit()
    return created
