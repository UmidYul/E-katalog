from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from celery import Celery
from sqlalchemy import select, text


def _bootstrap_paths() -> None:
    root = Path(__file__).resolve().parents[1]
    api_root = root / "services" / "api"
    if str(api_root) not in sys.path:
        sys.path.insert(0, str(api_root))
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))


_bootstrap_paths()

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.repositories.catalog import _merge_specs_maps, format_product_title  # noqa: E402
from shared.config.settings import settings  # noqa: E402
from shared.db.models import CatalogBrand, CatalogCanonicalProduct  # noqa: E402


async def _load_latest_store_specs(session, canonical_product_id: int) -> dict[str, str]:
    rows = (
        await session.execute(
            text(
                """
                with ranked_specs as (
                    select
                        case
                            when jsonb_typeof(metadata->'specifications') = 'object' then metadata->'specifications'
                            when jsonb_typeof(metadata->'specs') = 'object' then metadata->'specs'
                            else '{}'::jsonb
                        end as specs,
                        case
                            when jsonb_typeof(metadata->'specifications') = 'object' then (select count(*) from jsonb_each(metadata->'specifications'))
                            when jsonb_typeof(metadata->'specs') = 'object' then (select count(*) from jsonb_each(metadata->'specs'))
                            else 0
                        end as specs_count,
                        row_number() over (
                            order by
                                case
                                    when jsonb_typeof(metadata->'specifications') = 'object' then (select count(*) from jsonb_each(metadata->'specifications'))
                                    when jsonb_typeof(metadata->'specs') = 'object' then (select count(*) from jsonb_each(metadata->'specs'))
                                    else 0
                                end desc,
                                last_seen_at desc,
                                id desc
                        ) as row_rank
                    from catalog_store_products
                    where canonical_product_id = :product_id
                )
                select specs
                from ranked_specs
                where row_rank <= 8
                  and specs <> '{}'::jsonb
                order by row_rank asc
                """
            ),
            {"product_id": canonical_product_id},
        )
    ).all()
    merged: dict[str, str] = {}
    for row in rows:
        specs = row.specs if isinstance(row.specs, dict) else {}
        if not specs:
            continue
        merged = _merge_specs_maps(merged, specs)
    return merged


async def _backfill_titles(
    *,
    batch_size: int,
    max_products: int,
    include_inactive: bool,
    dry_run: bool,
) -> dict[str, int]:
    scanned = 0
    updated = 0
    unchanged = 0
    conflicts = 0
    invalid = 0
    last_id = 0

    async with AsyncSessionLocal() as session:
        while True:
            stmt = (
                select(
                    CatalogCanonicalProduct.id,
                    CatalogCanonicalProduct.normalized_title,
                    CatalogCanonicalProduct.specs,
                    CatalogCanonicalProduct.brand_id,
                    CatalogCanonicalProduct.category_id,
                    CatalogCanonicalProduct.is_active,
                    CatalogBrand.name.label("brand_name"),
                )
                .outerjoin(CatalogBrand, CatalogBrand.id == CatalogCanonicalProduct.brand_id)
                .where(CatalogCanonicalProduct.id > last_id)
                .order_by(CatalogCanonicalProduct.id.asc())
                .limit(batch_size)
            )
            if not include_inactive:
                stmt = stmt.where(CatalogCanonicalProduct.is_active.is_(True))

            rows = (await session.execute(stmt)).all()
            if not rows:
                break

            for row in rows:
                if max_products > 0 and scanned >= max_products:
                    break
                scanned += 1
                last_id = int(row.id)

                current_title = str(row.normalized_title or "").strip()
                canonical_specs = row.specs if isinstance(row.specs, dict) else {}
                fallback_specs = await _load_latest_store_specs(session, int(row.id))
                specs = _merge_specs_maps(canonical_specs, fallback_specs)
                next_title = format_product_title(
                    current_title,
                    brand_name=row.brand_name,
                    specs=specs,
                ).strip()

                if not next_title:
                    invalid += 1
                    continue
                if next_title == current_title:
                    unchanged += 1
                    continue

                if bool(row.is_active):
                    conflict_id = (
                        await session.execute(
                            select(CatalogCanonicalProduct.id).where(
                                CatalogCanonicalProduct.id != int(row.id),
                                CatalogCanonicalProduct.is_active.is_(True),
                                CatalogCanonicalProduct.category_id == int(row.category_id),
                                CatalogCanonicalProduct.brand_id.is_not_distinct_from(row.brand_id),
                                text("lower(normalized_title) = lower(:title)"),
                            ),
                            {"title": next_title},
                        )
                    ).scalar_one_or_none()
                    if conflict_id is not None:
                        conflicts += 1
                        continue

                if not dry_run:
                    await session.execute(
                        text(
                            """
                            update catalog_canonical_products
                            set normalized_title = :title,
                                updated_at = now()
                            where id = :id
                            """
                        ),
                        {"id": int(row.id), "title": next_title},
                    )
                updated += 1

            if max_products > 0 and scanned >= max_products:
                break

        if not dry_run:
            await session.commit()

    return {
        "scanned": scanned,
        "updated": updated,
        "unchanged": unchanged,
        "conflicts": conflicts,
        "invalid": invalid,
    }


def _enqueue_reindex() -> str:
    celery_client = Celery("scripts", broker=settings.celery_broker_url, backend=settings.celery_result_backend)
    task = celery_client.send_task("app.tasks.reindex_tasks.enqueue_reindex_batches")
    return task.id


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill canonical product titles to display standard.")
    parser.add_argument("--batch-size", type=int, default=500, help="Rows per chunk.")
    parser.add_argument("--max-products", type=int, default=0, help="Stop after N scanned rows (0 = all).")
    parser.add_argument("--include-inactive", action="store_true", help="Process inactive canonicals as well.")
    parser.add_argument("--dry-run", action="store_true", help="Calculate and report without DB updates.")
    parser.add_argument(
        "--no-reindex",
        action="store_true",
        help="Do not enqueue reindex task after successful updates.",
    )
    return parser.parse_args()


async def _main() -> int:
    args = _parse_args()
    result = await _backfill_titles(
        batch_size=max(1, int(args.batch_size)),
        max_products=max(0, int(args.max_products)),
        include_inactive=bool(args.include_inactive),
        dry_run=bool(args.dry_run),
    )

    print(result)
    if args.dry_run or args.no_reindex or result["updated"] == 0:
        return 0

    task_id = _enqueue_reindex()
    print({"reindex_task_id": task_id})
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
