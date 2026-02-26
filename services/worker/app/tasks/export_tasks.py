from __future__ import annotations

import asyncio
import csv
import json
from datetime import datetime
from shared.utils.time import UTC
from pathlib import Path

from sqlalchemy import text

from app.celery_app import celery_app
from app.core.logging import logger
from app.db.session import AsyncSessionLocal


@celery_app.task(bind=True)
def export_json(self, output: str = "/srv/data/exports/offers.json", limit: int = 10000) -> dict:
    return asyncio.run(_export_json(output, limit))


@celery_app.task(bind=True)
def export_csv(self, output: str = "/srv/data/exports/offers.csv", limit: int = 10000) -> dict:
    return asyncio.run(_export_csv(output, limit))


async def _fetch_rows(limit: int) -> list[dict]:
    stmt = text(
        """
        select o.id as offer_id,
               o.scraped_at,
               o.price_amount,
               o.old_price_amount,
               o.in_stock,
               sp.external_url,
               p.id as product_id,
               p.normalized_title,
               s.id as store_id,
               s.name as store_name
        from catalog_offers o
        join catalog_store_products sp on sp.id = o.store_product_id
        left join catalog_products p on p.id = sp.product_id
        join catalog_stores s on s.id = sp.store_id
        order by o.scraped_at desc, o.id desc
        limit :limit
        """
    )
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(stmt, {"limit": limit})).mappings().all()
    return [dict(r) for r in rows]


async def _export_json(output: str, limit: int) -> dict:
    rows = await _fetch_rows(limit)
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False, default=str, indent=2), encoding="utf-8")
    logger.info("export_json_completed", output=output, limit=limit)
    return {"output": output, "limit": limit, "at": datetime.now(UTC).isoformat()}


async def _export_csv(output: str, limit: int) -> dict:
    rows = await _fetch_rows(limit)
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "offer_id",
        "scraped_at",
        "price_amount",
        "old_price_amount",
        "in_stock",
        "external_url",
        "product_id",
        "normalized_title",
        "store_id",
        "store_name",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames, delimiter=";")
        writer.writeheader()
        writer.writerows(rows)
    logger.info("export_csv_completed", output=output, limit=limit)
    return {"output": output, "limit": limit, "at": datetime.now(UTC).isoformat()}

