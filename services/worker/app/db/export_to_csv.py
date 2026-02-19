from __future__ import annotations

import argparse
import asyncio
import csv
from pathlib import Path

from sqlalchemy import select

from app.db.models import Offer, Product, Shop
from app.db.session import AsyncSessionLocal


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export latest offers to CSV.")
    parser.add_argument(
        "--output",
        default="/srv/scraper/exports/offers.csv",
        help="Path to output CSV file.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="How many latest offers to export.",
    )
    parser.add_argument(
        "--delimiter",
        default=";",
        help="CSV delimiter. Default ';' for Excel-friendly opening in RU locale.",
    )
    return parser.parse_args()


async def export_to_csv(output: str, limit: int, delimiter: str) -> Path:
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    stmt = (
        select(
            Offer.id,
            Offer.updated_at,
            Offer.price,
            Offer.old_price,
            Offer.availability,
            Offer.link,
            Product.id.label("product_id"),
            Product.title,
            Shop.id.label("shop_id"),
            Shop.name.label("shop_name"),
        )
        .join(Product, Product.id == Offer.product_id)
        .join(Shop, Shop.id == Offer.shop_id)
        .order_by(Offer.updated_at.desc(), Offer.id.desc())
        .limit(limit)
    )

    async with AsyncSessionLocal() as session:
        rows = (await session.execute(stmt)).all()

    with output_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=delimiter)
        writer.writerow(
            [
                "offer_id",
                "updated_at",
                "price",
                "old_price",
                "availability",
                "link",
                "product_id",
                "product_title",
                "shop_id",
                "shop_name",
            ]
        )
        writer.writerows(rows)

    return output_path


async def _main() -> None:
    args = parse_args()
    output_path = await export_to_csv(args.output, args.limit, args.delimiter)
    print(f"Exported CSV: {output_path}")


if __name__ == "__main__":
    asyncio.run(_main())
