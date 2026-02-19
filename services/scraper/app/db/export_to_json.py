from __future__ import annotations

import argparse
import asyncio
import json
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select

from app.db.models import Offer, Product, Shop
from app.db.session import AsyncSessionLocal


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export latest offers to JSON.")
    parser.add_argument(
        "--output",
        default="/srv/scraper/exports/offers.json",
        help="Path to output JSON file.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="How many latest offers to export.",
    )
    return parser.parse_args()


def _to_json_value(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return str(value) if hasattr(value, "isoformat") else value


async def export_to_json(output: str, limit: int) -> Path:
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    stmt = (
        select(
            Offer.id.label("offer_id"),
            Offer.updated_at,
            Offer.price,
            Offer.old_price,
            Offer.availability,
            Offer.specifications,
            Offer.link,
            Product.id.label("product_id"),
            Product.title.label("product_title"),
            Shop.id.label("shop_id"),
            Shop.name.label("shop_name"),
        )
        .join(Product, Product.id == Offer.product_id)
        .join(Shop, Shop.id == Offer.shop_id)
        .order_by(Offer.updated_at.desc(), Offer.id.desc())
        .limit(limit)
    )

    async with AsyncSessionLocal() as session:
        rows = (await session.execute(stmt)).mappings().all()

    payload = []
    for row in rows:
        payload.append({key: _to_json_value(value) for key, value in row.items()})

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return output_path


async def _main() -> None:
    args = parse_args()
    output_path = await export_to_json(args.output, args.limit)
    print(f"Exported JSON: {output_path}")


if __name__ == "__main__":
    asyncio.run(_main())
