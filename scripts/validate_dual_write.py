from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sys
from typing import Any

from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shared.db.session import AsyncSessionLocal


CHECKS: dict[str, str] = {
    "legacy_products_total": "select count(*)::int from products",
    "legacy_offers_total": "select count(*)::int from offers",
    "legacy_price_history_total": "select count(*)::int from price_history",
    "catalog_products_total": "select count(*)::int from catalog_products",
    "catalog_store_products_total": "select count(*)::int from catalog_store_products",
    "catalog_offers_total": "select count(*)::int from catalog_offers",
    "catalog_price_history_total": "select count(*)::int from catalog_price_history",
    "missing_catalog_products_by_legacy_id": """
        select count(*)::int
        from products p
        left join catalog_products cp on cp.id = p.id
        where cp.id is null
    """,
    "missing_catalog_store_products_by_legacy_offer_id": """
        select count(*)::int
        from offers o
        left join catalog_store_products csp on csp.id = o.id
        where csp.id is null
    """,
    "missing_catalog_offers_by_legacy_offer_id": """
        select count(*)::int
        from offers o
        left join catalog_offers co on co.id = o.id
        where co.id is null
    """,
    "price_mismatches": """
        select count(*)::int
        from offers o
        join catalog_offers co on co.id = o.id
        where coalesce(co.price_amount, -1) <> coalesce(o.price, -1)
    """,
    "stock_mismatches": """
        select count(*)::int
        from offers o
        join catalog_offers co on co.id = o.id
        where coalesce(co.in_stock, false) <>
              (
                lower(coalesce(o.availability, '')) not in ('out_of_stock', 'no')
                and coalesce(o.availability, '') <> convert_from(decode('D0BDD0B5D182', 'hex'), 'UTF8')
              )
    """,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate dual-write consistency between legacy and catalog tables.")
    parser.add_argument("--sample-limit", type=int, default=20, help="How many mismatched IDs to print for each sample.")
    parser.add_argument("--max-missing-products", type=int, default=0)
    parser.add_argument("--max-missing-store-products", type=int, default=0)
    parser.add_argument("--max-missing-offers", type=int, default=0)
    parser.add_argument("--max-price-mismatches", type=int, default=0)
    parser.add_argument("--max-stock-mismatches", type=int, default=0)
    return parser.parse_args()


async def _scalar(sql: str, params: dict[str, Any] | None = None) -> int:
    async with AsyncSessionLocal() as session:
        value = await session.scalar(text(sql), params or {})
    return int(value or 0)


async def _list_ids(sql: str, *, sample_limit: int) -> list[int]:
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(text(sql), {"sample_limit": sample_limit})).mappings().all()
    return [int(row["id"]) for row in rows]


async def collect_metrics() -> dict[str, int]:
    results: dict[str, int] = {}
    for key, query in CHECKS.items():
        results[key] = await _scalar(query)
    return results


async def collect_samples(sample_limit: int) -> dict[str, list[int]]:
    return {
        "missing_catalog_products": await _list_ids(
            """
            select p.id
            from products p
            left join catalog_products cp on cp.id = p.id
            where cp.id is null
            order by p.id asc
            limit :sample_limit
            """,
            sample_limit=sample_limit,
        ),
        "missing_catalog_store_products": await _list_ids(
            """
            select o.id
            from offers o
            left join catalog_store_products csp on csp.id = o.id
            where csp.id is null
            order by o.id asc
            limit :sample_limit
            """,
            sample_limit=sample_limit,
        ),
        "missing_catalog_offers": await _list_ids(
            """
            select o.id
            from offers o
            left join catalog_offers co on co.id = o.id
            where co.id is null
            order by o.id asc
            limit :sample_limit
            """,
            sample_limit=sample_limit,
        ),
    }


def print_report(metrics: dict[str, int], samples: dict[str, list[int]]) -> None:
    print("dual_write_validation_metrics", flush=True)
    for key in sorted(metrics.keys()):
        print(f"  {key}={metrics[key]}", flush=True)
    print("dual_write_validation_samples", flush=True)
    for key in sorted(samples.keys()):
        values = ", ".join(str(v) for v in samples[key]) if samples[key] else "-"
        print(f"  {key}={values}", flush=True)


def evaluate_thresholds(metrics: dict[str, int], args: argparse.Namespace) -> list[str]:
    failures: list[str] = []
    if metrics["missing_catalog_products_by_legacy_id"] > int(args.max_missing_products):
        failures.append(
            "missing_catalog_products_by_legacy_id="
            f"{metrics['missing_catalog_products_by_legacy_id']} > {int(args.max_missing_products)}"
        )
    if metrics["missing_catalog_store_products_by_legacy_offer_id"] > int(args.max_missing_store_products):
        failures.append(
            "missing_catalog_store_products_by_legacy_offer_id="
            f"{metrics['missing_catalog_store_products_by_legacy_offer_id']} > {int(args.max_missing_store_products)}"
        )
    if metrics["missing_catalog_offers_by_legacy_offer_id"] > int(args.max_missing_offers):
        failures.append(
            "missing_catalog_offers_by_legacy_offer_id="
            f"{metrics['missing_catalog_offers_by_legacy_offer_id']} > {int(args.max_missing_offers)}"
        )
    if metrics["price_mismatches"] > int(args.max_price_mismatches):
        failures.append(f"price_mismatches={metrics['price_mismatches']} > {int(args.max_price_mismatches)}")
    if metrics["stock_mismatches"] > int(args.max_stock_mismatches):
        failures.append(f"stock_mismatches={metrics['stock_mismatches']} > {int(args.max_stock_mismatches)}")
    return failures


def main() -> int:
    args = parse_args()
    metrics = asyncio.run(collect_metrics())
    samples = asyncio.run(collect_samples(sample_limit=max(1, int(args.sample_limit))))
    print_report(metrics, samples)

    failures = evaluate_thresholds(metrics, args)
    if failures:
        print("dual_write_validation_status=FAILED", flush=True)
        for item in failures:
            print(f"  fail={item}", flush=True)
        return 2

    print("dual_write_validation_status=OK", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
