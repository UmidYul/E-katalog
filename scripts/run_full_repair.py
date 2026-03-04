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
WORKER_ROOT = ROOT / "services" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from services.worker.app.db.session import AsyncSessionLocal
from services.worker.app.tasks.embedding_tasks import generate_embeddings_batch
from services.worker.app.tasks.normalize_tasks import normalize_full_catalog
from services.worker.app.tasks.reindex_tasks import reindex_product_search_batch
from services.worker.app.platform.services.embeddings import embedding_dimension, embedding_model_name


async def _scalar(query: str, params: dict[str, Any] | None = None) -> int:
    async with AsyncSessionLocal() as session:
        value = await session.scalar(text(query), params or {})
    return int(value or 0)


async def _list_bad_embedding_ids(*, expected_dim: int) -> list[int]:
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                text(
                    """
                    select cp.id
                    from catalog_canonical_products cp
                    where cp.is_active = true
                      and cp.normalized_title is not null
                      and btrim(cp.normalized_title) <> ''
                      and (cp.embedding is null or coalesce(vector_dims(cp.embedding), 0) <> :expected_dim)
                    order by cp.id asc
                    """
                ),
                {"expected_dim": expected_dim},
            )
        ).mappings().all()
    return [int(row["id"]) for row in rows]


async def _stats(*, expected_dim: int) -> dict[str, int]:
    broken_embeddings = await _scalar(
        """
        select count(*)::int
        from catalog_canonical_products cp
        where cp.is_active = true
          and cp.normalized_title is not null
          and btrim(cp.normalized_title) <> ''
          and (cp.embedding is null or coalesce(vector_dims(cp.embedding), 0) <> :expected_dim)
        """,
        {"expected_dim": expected_dim},
    )
    active_without_valid_offers = await _scalar(
        """
        select count(*)::int
        from catalog_canonical_products cp
        where cp.is_active = true
          and not exists (
              select 1
              from catalog_offers o
              where o.canonical_product_id = cp.id
                and o.is_valid = true
          )
        """
    )
    product_search_rows = await _scalar("select count(*)::int from catalog_product_search")
    return {
        "broken_embeddings": broken_embeddings,
        "active_without_valid_offers": active_without_valid_offers,
        "product_search_rows": product_search_rows,
    }


def _print_stats(label: str, stats: dict[str, int]) -> None:
    print(
        f"{label}: broken_embeddings={stats['broken_embeddings']} "
        f"active_without_valid_offers={stats['active_without_valid_offers']} "
        f"product_search_rows={stats['product_search_rows']}",
        flush=True,
    )


def _run_task(task, **kwargs) -> dict[str, Any]:
    result = task.apply(kwargs=kwargs).get(propagate=True)
    if isinstance(result, dict):
        return result
    return {"result": result}


def main() -> int:
    parser = argparse.ArgumentParser(description="Full repair for embeddings/normalization/reindex after broken runs.")
    parser.add_argument("--dry-run", action="store_true", help="Only print what would be repaired.")
    parser.add_argument("--embedding-batch-size", type=int, default=50)
    parser.add_argument("--normalize-chunk-size", type=int, default=50)
    parser.add_argument("--reindex-limit", type=int, default=200000)
    parser.add_argument("--progress-every", type=int, default=100)
    args = parser.parse_args()

    expected_dim = int(embedding_dimension())
    model_name = embedding_model_name()
    embedding_batch_size = max(1, int(args.embedding_batch_size))
    normalize_chunk_size = max(1, int(args.normalize_chunk_size))
    progress_every = max(1, int(args.progress_every))

    print(
        f"run_full_repair started dry_run={bool(args.dry_run)} embedding_dim={expected_dim} "
        f"embedding_model={model_name} embedding_batch_size={embedding_batch_size}",
        flush=True,
    )

    before = asyncio.run(_stats(expected_dim=expected_dim))
    _print_stats("before", before)

    bad_ids = asyncio.run(_list_bad_embedding_ids(expected_dim=expected_dim))
    print(f"embedding_targets={len(bad_ids)}", flush=True)

    if args.dry_run:
        print("dry-run: no mutations were applied", flush=True)
        return 0

    repaired_embeddings = 0
    for idx in range(0, len(bad_ids), embedding_batch_size):
        batch = bad_ids[idx : idx + embedding_batch_size]
        if not batch:
            continue
        _run_task(
            generate_embeddings_batch,
            limit=embedding_batch_size,
            reset_offset=False,
            followup=False,
            target_ids=batch,
        )
        repaired_embeddings += len(batch)
        if repaired_embeddings % progress_every == 0 or repaired_embeddings == len(bad_ids):
            print(f"embedding_progress repaired={repaired_embeddings}/{len(bad_ids)}", flush=True)

    normalize_runs = 0
    if before["active_without_valid_offers"] > 0:
        result = _run_task(normalize_full_catalog, chunk_size=normalize_chunk_size)
        normalize_runs += 1
        print(
            f"normalize_full_catalog_done run={normalize_runs} processed={int(result.get('processed', 0))}",
            flush=True,
        )
    else:
        print("normalize_full_catalog_skipped no_active_products_without_valid_offers", flush=True)

    reindex_result = _run_task(reindex_product_search_batch, limit=max(1, int(args.reindex_limit)))
    print(
        f"reindex_done limit={int(args.reindex_limit)} "
        f"result={reindex_result.get('reindexed_limit', reindex_result)}",
        flush=True,
    )

    after = asyncio.run(_stats(expected_dim=expected_dim))
    _print_stats("after", after)
    print(
        "summary: "
        f"embeddings {before['broken_embeddings']} -> {after['broken_embeddings']}; "
        f"active_without_valid_offers {before['active_without_valid_offers']} -> {after['active_without_valid_offers']}; "
        f"product_search_rows {before['product_search_rows']} -> {after['product_search_rows']}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
