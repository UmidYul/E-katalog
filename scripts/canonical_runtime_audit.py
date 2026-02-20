from __future__ import annotations

import argparse
import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from statistics import mean
from typing import Any

from sqlalchemy import text

from app.db.session import AsyncSessionLocal
from app.platform.services.canonical_matching import extract_attributes, fuzzy_similarity
from app.platform.services.normalization import build_canonical_title


@dataclass
class OfferRow:
    offer_id: int
    canonical_id: int
    canonical_title: str
    offer_title: str
    price_amount: Decimal


def _to_float(value: Decimal | float | int | None) -> float:
    if value is None:
        return 0.0
    return float(value)


async def build_audit_report() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    problems: list[dict[str, Any]] = []
    report: dict[str, Any] = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "counts": {},
        "invariants": {},
        "issues": {},
        "quality": {},
    }

    async with AsyncSessionLocal() as session:
        count_rows = (
            await session.execute(
                text(
                    """
                    select
                      (select count(*) from catalog_canonical_products where is_active = true) as canonical_count,
                      (select count(*) from catalog_offers) as offers_count,
                      (select count(*) from products) as legacy_products_count,
                      (select count(*) from offers) as legacy_offers_count
                    """
                )
            )
        ).mappings().one()
        report["counts"] = {
            "canonical_count": int(count_rows["canonical_count"]),
            "offers_count": int(count_rows["offers_count"]),
            "legacy_products_count": int(count_rows["legacy_products_count"]),
            "legacy_offers_count": int(count_rows["legacy_offers_count"]),
        }

        offer_rows = (
            await session.execute(
                text(
                    """
                    select
                      o.id as offer_id,
                      o.canonical_product_id as canonical_id,
                      cp.normalized_title as canonical_title,
                      coalesce(sp.title_clean, sp.title_raw) as offer_title,
                      o.price_amount
                    from catalog_offers o
                    join catalog_canonical_products cp on cp.id = o.canonical_product_id
                    join catalog_store_products sp on sp.id = o.store_product_id
                    """
                )
            )
        ).mappings().all()

        offers_by_canonical: dict[int, list[OfferRow]] = defaultdict(list)
        for row in offer_rows:
            offers_by_canonical[int(row["canonical_id"])].append(
                OfferRow(
                    offer_id=int(row["offer_id"]),
                    canonical_id=int(row["canonical_id"]),
                    canonical_title=str(row["canonical_title"] or ""),
                    offer_title=str(row["offer_title"] or ""),
                    price_amount=row["price_amount"],
                )
            )

        offers_per_canonical = [len(items) for items in offers_by_canonical.values()]
        report["quality"]["avg_offers_per_canonical"] = mean(offers_per_canonical) if offers_per_canonical else 0.0
        report["quality"]["max_offers_in_single_canonical"] = max(offers_per_canonical) if offers_per_canonical else 0
        report["quality"]["canonical_with_offers_count"] = len(offers_by_canonical)

        empty_active_canonical_count = (
            await session.execute(
                text(
                    """
                    select count(*)
                    from catalog_canonical_products cp
                    left join catalog_offers o on o.canonical_product_id = cp.id
                    where cp.is_active = true
                    group by cp.id
                    having count(o.id) = 0
                    """
                )
            )
        ).all()
        report["quality"]["empty_active_canonical_count"] = len(empty_active_canonical_count)

        memory_mixed = 0
        model_mixed = 0
        ambiguous_storage_count = 0
        cross_brand_count = 0
        low_confidence_count = 0

        canonical_signatures: dict[tuple[str, str], list[int]] = defaultdict(list)

        for canonical_id, rows in offers_by_canonical.items():
            canonical_attrs = extract_attributes(rows[0].canonical_title)
            known_storages: set[str] = set()
            known_models: set[str] = set()
            known_brands: set[str] = set()
            unknown_storage_offer_ids: list[int] = []

            for item in rows:
                attrs = extract_attributes(item.offer_title)
                if attrs.storage != "unknown":
                    known_storages.add(attrs.storage)
                else:
                    unknown_storage_offer_ids.append(item.offer_id)
                if attrs.model != "unknown":
                    known_models.add(attrs.model)
                if attrs.brand != "unknown":
                    known_brands.add(attrs.brand)

                brand_mismatch = (
                    canonical_attrs.brand != "unknown"
                    and attrs.brand != "unknown"
                    and canonical_attrs.brand != attrs.brand
                )
                model_mismatch = (
                    canonical_attrs.model != "unknown"
                    and attrs.model != "unknown"
                    and canonical_attrs.model != attrs.model
                )
                storage_mismatch = (
                    canonical_attrs.storage != "unknown"
                    and attrs.storage != "unknown"
                    and canonical_attrs.storage != attrs.storage
                )
                if brand_mismatch or model_mismatch or storage_mismatch:
                    low_confidence_count += 1
                    problems.append(
                        {
                            "type": "low_confidence",
                            "canonical_id": canonical_id,
                            "offer_id": item.offer_id,
                            "score": 0.0,
                            "canonical_title": rows[0].canonical_title,
                            "offer_title": item.offer_title,
                            "reason": "attribute_mismatch",
                        }
                    )
                    continue

                offer_canonical_title = build_canonical_title(item.offer_title)
                similarity = fuzzy_similarity(rows[0].canonical_title.lower(), offer_canonical_title.lower())
                if similarity < 0.55:
                    low_confidence_count += 1
                    problems.append(
                        {
                            "type": "low_confidence",
                            "canonical_id": canonical_id,
                            "offer_id": item.offer_id,
                            "score": round(similarity, 4),
                            "canonical_title": rows[0].canonical_title,
                            "offer_title": item.offer_title,
                            "reason": "title_similarity",
                        }
                    )

            if len(known_storages) > 1:
                memory_mixed += 1
                problems.append(
                    {
                        "type": "invariant_memory_mix",
                        "canonical_id": canonical_id,
                        "storages": sorted(known_storages),
                    }
                )

            if len(known_models) > 1:
                model_mixed += 1
                problems.append(
                    {
                        "type": "invariant_model_mix",
                        "canonical_id": canonical_id,
                        "models": sorted(known_models),
                    }
                )

            if unknown_storage_offer_ids:
                ambiguous_storage_count += len(unknown_storage_offer_ids)
                for offer_id in unknown_storage_offer_ids:
                    problems.append(
                        {
                            "type": "ambiguous_storage",
                            "canonical_id": canonical_id,
                            "offer_id": offer_id,
                        }
                    )

            if len(known_brands) > 1:
                cross_brand_count += 1
                problems.append(
                    {
                        "type": "cross_brand",
                        "canonical_id": canonical_id,
                        "brands": sorted(known_brands),
                    }
                )

            if canonical_attrs.model != "unknown" and canonical_attrs.storage != "unknown":
                canonical_signatures[(canonical_attrs.model, canonical_attrs.storage)].append(canonical_id)

        duplicate_signatures = {
            f"{model}|{storage}": sorted(ids)
            for (model, storage), ids in canonical_signatures.items()
            if len(ids) > 1
        }
        for signature, ids in duplicate_signatures.items():
            problems.append(
                {
                    "type": "duplicate_model_storage_signature",
                    "signature": signature,
                    "canonical_ids": ids,
                }
            )

        orphan_rows = (
            await session.execute(
                text(
                    """
                    select o.id
                    from catalog_offers o
                    left join catalog_canonical_products cp on cp.id = o.canonical_product_id
                    left join catalog_store_products sp on sp.id = o.store_product_id
                    where cp.id is null or sp.id is null
                    """
                )
            )
        ).scalars().all()
        orphan_offers_count = len(orphan_rows)
        for offer_id in orphan_rows:
            problems.append({"type": "orphan_offer", "offer_id": int(offer_id)})

        min_price_mismatch = (
            await session.execute(
                text(
                    """
                    with agg as (
                      select canonical_product_id, min(price_amount) as min_price
                      from catalog_offers
                      where is_valid = true
                      group by canonical_product_id
                    )
                    select count(*)
                    from catalog_product_search ps
                    join agg on agg.canonical_product_id = ps.product_id
                    where ps.min_price is distinct from agg.min_price
                    """
                )
            )
        ).scalar_one()

        report["invariants"] = {
            "memory_mixed_canonical_count": memory_mixed,
            "model_mixed_canonical_count": model_mixed,
            "orphan_offers_count": orphan_offers_count,
            "min_price_mismatch_count": int(min_price_mismatch),
        }
        report["issues"] = {
            "ambiguous_storage_cases": ambiguous_storage_count,
            "cross_brand_cases": cross_brand_count,
            "low_confidence_cases": low_confidence_count,
            "duplicate_model_storage_signatures": duplicate_signatures,
            "total_problem_cases": len(problems),
        }

    return report, problems


def main() -> None:
    parser = argparse.ArgumentParser(description="Canonical runtime audit report")
    parser.add_argument("--output", required=True, help="Path to summary report json")
    parser.add_argument("--problems", required=True, help="Path to problems jsonl")
    args = parser.parse_args()

    output_path = Path(args.output)
    problems_path = Path(args.problems)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    problems_path.parent.mkdir(parents=True, exist_ok=True)

    report, problems = asyncio.run(build_audit_report())

    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with problems_path.open("w", encoding="utf-8") as file:
        for problem in problems:
            file.write(json.dumps(problem, ensure_ascii=False))
            file.write("\n")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"problems_written={len(problems)} -> {problems_path}")


if __name__ == "__main__":
    main()
