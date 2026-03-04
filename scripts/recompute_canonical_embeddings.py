from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sys

from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
WORKER_ROOT = ROOT / "services" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from services.worker.app.db.session import AsyncSessionLocal
from services.worker.app.platform.services.embeddings import batch_embeddings, embedding_dimension, embedding_model_name


def _to_pgvector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{float(value):.8f}" for value in values) + "]"


async def _count_targets(*, expected_dim: int, active_only: bool) -> int:
    active_clause = "and cp.is_active = true" if active_only else ""
    async with AsyncSessionLocal() as session:
        value = await session.scalar(
            text(
                f"""
                select count(*)
                from catalog_canonical_products cp
                where cp.normalized_title is not null
                  and btrim(cp.normalized_title) <> ''
                  {active_clause}
                  and (cp.embedding is null or coalesce(vector_dims(cp.embedding), 0) <> :expected_dim)
                """
            ),
            {"expected_dim": expected_dim},
        )
    return int(value or 0)


async def _recompute(
    *,
    batch_size: int,
    expected_dim: int,
    max_rows: int | None,
    active_only: bool,
    dry_run: bool,
) -> tuple[int, int]:
    processed = 0
    scanned = 0
    last_id = 0
    active_clause = "and cp.is_active = true" if active_only else ""

    async with AsyncSessionLocal() as session:
        while True:
            if max_rows is not None and processed >= max_rows:
                break

            current_limit = int(batch_size)
            if max_rows is not None:
                current_limit = min(current_limit, max_rows - processed)
                if current_limit <= 0:
                    break

            rows = (
                await session.execute(
                    text(
                        f"""
                        select cp.id, cp.normalized_title
                        from catalog_canonical_products cp
                        where cp.id > :last_id
                          and cp.normalized_title is not null
                          and btrim(cp.normalized_title) <> ''
                          {active_clause}
                          and (cp.embedding is null or coalesce(vector_dims(cp.embedding), 0) <> :expected_dim)
                        order by cp.id asc
                        limit :limit
                        """
                    ),
                    {
                        "last_id": last_id,
                        "expected_dim": expected_dim,
                        "limit": current_limit,
                    },
                )
            ).mappings().all()

            if not rows:
                break

            scanned += len(rows)
            payload: list[tuple[int, str]] = [(int(row["id"]), str(row["normalized_title"] or "").strip()) for row in rows]
            payload = [(row_id, title) for row_id, title in payload if title]
            if not payload:
                last_id = int(rows[-1]["id"])
                continue

            if not dry_run:
                vectors = batch_embeddings([title for _, title in payload], dim=expected_dim)
                for (product_id, _), embedding in zip(payload, vectors, strict=True):
                    await session.execute(
                        text(
                            """
                            update catalog_canonical_products
                            set embedding = cast(:embedding as vector)
                            where id = :product_id
                            """
                        ),
                        {
                            "product_id": product_id,
                            "embedding": _to_pgvector_literal(embedding),
                        },
                    )
                await session.commit()

            processed += len(payload)
            last_id = int(rows[-1]["id"])
            print(f"processed={processed} scanned={scanned} last_id={last_id}", flush=True)

    return processed, scanned


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recompute canonical embeddings for rows with NULL embedding or wrong vector dimensionality."
    )
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--max-rows", type=int, default=0, help="0 means no limit")
    parser.add_argument("--dimension", type=int, default=0, help="0 means EMBEDDING_DIMENSION from settings")
    parser.add_argument("--include-inactive", action="store_true", help="Process inactive canonical products too")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    batch_size = max(1, int(args.batch_size))
    expected_dim = int(args.dimension) if int(args.dimension) > 0 else int(embedding_dimension())
    active_only = not bool(args.include_inactive)
    max_rows = int(args.max_rows) if int(args.max_rows) > 0 else None

    model = embedding_model_name()
    print(
        f"starting recompute: model={model} expected_dim={expected_dim} batch_size={batch_size} "
        f"active_only={active_only} dry_run={bool(args.dry_run)}",
        flush=True,
    )

    targets = asyncio.run(_count_targets(expected_dim=expected_dim, active_only=active_only))
    print(f"target_rows={targets}", flush=True)
    if targets == 0:
        return 0

    processed, scanned = asyncio.run(
        _recompute(
            batch_size=batch_size,
            expected_dim=expected_dim,
            max_rows=max_rows,
            active_only=active_only,
            dry_run=bool(args.dry_run),
        )
    )
    print(f"done processed={processed} scanned={scanned} target_rows={targets}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
