from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import text

from shared.db.session import AsyncSessionLocal


DEMO_CATEGORY_ID = 1001
DEMO_STORE_IDS = [2001, 2002, 2003]

DEMO_PRODUCTS = [
    {"id": 3001, "title": "Apple iPhone 15 128GB", "brand_id": 4001, "ram": "6 GB", "storage": "128 GB"},
    {"id": 3002, "title": "Apple iPhone 14 128GB", "brand_id": 4001, "ram": "6 GB", "storage": "128 GB"},
    {"id": 3003, "title": "Samsung Galaxy S24 256GB", "brand_id": 4002, "ram": "8 GB", "storage": "256 GB"},
    {"id": 3004, "title": "Samsung Galaxy A55 128GB", "brand_id": 4002, "ram": "8 GB", "storage": "128 GB"},
    {"id": 3005, "title": "Xiaomi Redmi Note 13 Pro 256GB", "brand_id": 4003, "ram": "8 GB", "storage": "256 GB"},
    {"id": 3006, "title": "Xiaomi 13T 256GB", "brand_id": 4003, "ram": "12 GB", "storage": "256 GB"},
    {"id": 3007, "title": "Honor X9b 256GB", "brand_id": 4004, "ram": "12 GB", "storage": "256 GB"},
    {"id": 3008, "title": "Tecno Camon 30 256GB", "brand_id": 4005, "ram": "8 GB", "storage": "256 GB"},
]

DEMO_BRANDS = [
    {"id": 4001, "name": "Apple"},
    {"id": 4002, "name": "Samsung"},
    {"id": 4003, "name": "Xiaomi"},
    {"id": 4004, "name": "Honor"},
    {"id": 4005, "name": "Tecno"},
]


async def main() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        await session.execute(
            text(
                """
                insert into catalog_categories (id, parent_id, slug, name_uz, name_ru, name_en, lft, rgt, is_active)
                values (:id, null, 'phones', 'Smartfonlar', 'Смартфоны', 'Smartphones', 1, 2, true)
                on conflict (id) do nothing
                """
            ),
            {"id": DEMO_CATEGORY_ID},
        )

        for brand in DEMO_BRANDS:
            await session.execute(
                text(
                    """
                    insert into catalog_brands (id, name, normalized_name, aliases)
                    values (:id, :name, :normalized_name, '[]'::jsonb)
                    on conflict (id) do update
                    set name = excluded.name, normalized_name = excluded.normalized_name
                    """
                ),
                {**brand, "normalized_name": brand["name"].lower()},
            )

        stores = [
            {"id": DEMO_STORE_IDS[0], "slug": "texnomart", "name": "Texnomart"},
            {"id": DEMO_STORE_IDS[1], "slug": "mediapark", "name": "Mediapark"},
            {"id": DEMO_STORE_IDS[2], "slug": "idea", "name": "IDEA"},
        ]
        for store in stores:
            await session.execute(
                text(
                    """
                    insert into catalog_stores (id, slug, name, country_code, is_active, trust_score, crawl_priority)
                    values (:id, :slug, :name, 'UZ', true, 0.85, 100)
                    on conflict (id) do update
                    set slug = excluded.slug, name = excluded.name, is_active = true
                    """
                ),
                store,
            )

        offer_id = 6000
        store_product_id = 5000
        for idx, product in enumerate(DEMO_PRODUCTS):
            await session.execute(
                text(
                    """
                    insert into catalog_canonical_products (id, normalized_title, main_image, category_id, brand_id, specs)
                    values (:id, :title, :main_image, :category_id, :brand_id, cast(:specs as jsonb))
                    on conflict (id) do update
                    set normalized_title = excluded.normalized_title,
                        main_image = excluded.main_image,
                        category_id = excluded.category_id,
                        brand_id = excluded.brand_id,
                        specs = excluded.specs
                    """
                ),
                {
                    "id": product["id"],
                    "title": product["title"],
                    "main_image": f"https://picsum.photos/seed/phone-{product['id']}/900/700",
                    "category_id": DEMO_CATEGORY_ID,
                    "brand_id": product["brand_id"],
                    "specs": json.dumps({"ram": product["ram"], "storage": product["storage"]}),
                },
            )

            await session.execute(
                text(
                    """
                    insert into catalog_products (id, canonical_product_id, category_id, brand_id, normalized_title, attributes, specs, status)
                    values (
                        :id,
                        :canonical_product_id,
                        :category_id,
                        :brand_id,
                        :title,
                        cast(:attributes as jsonb),
                        cast(:specs as jsonb),
                        'active'
                    )
                    on conflict (id) do update
                    set canonical_product_id = excluded.canonical_product_id,
                        normalized_title = excluded.normalized_title,
                        brand_id = excluded.brand_id,
                        attributes = excluded.attributes,
                        specs = excluded.specs,
                        status = 'active'
                    """
                ),
                {
                    "id": product["id"],
                    "canonical_product_id": product["id"],
                    "category_id": DEMO_CATEGORY_ID,
                    "brand_id": product["brand_id"],
                    "title": product["title"],
                    "attributes": json.dumps({"ram": product["ram"], "storage": product["storage"]}),
                    "specs": json.dumps({"ram": product["ram"], "storage": product["storage"]}),
                },
            )

            base_price = Decimal(6_000_000 + idx * 350_000)
            prices = [
                base_price,
                base_price - Decimal(120_000),
                base_price + Decimal(80_000),
            ]

            for store_idx, store_id in enumerate(DEMO_STORE_IDS):
                await session.execute(
                    text(
                        """
                        insert into catalog_sellers (store_id, name, normalized_name, metadata)
                        values (:store_id, :name, :normalized_name, '{}'::jsonb)
                        on conflict (store_id, normalized_name) do update
                        set name = excluded.name
                        """
                    ),
                    {
                        "store_id": store_id,
                        "name": f"{stores[store_idx]['name']} Official",
                        "normalized_name": f"{stores[store_idx]['name'].lower()} official",
                    },
                )

                store_product_id += 1
                offer_id += 1
                price = prices[store_idx]
                await session.execute(
                    text(
                        """
                        insert into catalog_store_products (
                            id, store_id, canonical_product_id, product_id, external_id, external_url,
                            title_raw, title_clean, image_url, availability, metadata, last_seen_at
                        )
                        values (
                            :id, :store_id, :canonical_product_id, :product_id, :external_id, :external_url,
                            :title_raw, :title_clean, :image_url, 'in_stock', '{}'::jsonb, :last_seen_at
                        )
                        on conflict (id) do update
                        set canonical_product_id = excluded.canonical_product_id,
                            product_id = excluded.product_id,
                            title_raw = excluded.title_raw,
                            title_clean = excluded.title_clean,
                            image_url = excluded.image_url,
                            last_seen_at = excluded.last_seen_at
                        """
                    ),
                    {
                        "id": store_product_id,
                        "store_id": store_id,
                        "canonical_product_id": product["id"],
                        "product_id": product["id"],
                        "external_id": f"{product['id']}-{store_id}",
                        "external_url": f"https://{stores[store_idx]['slug']}.uz/product/{product['id']}",
                        "title_raw": product["title"],
                        "title_clean": product["title"].lower(),
                        "image_url": f"https://picsum.photos/seed/phone-{product['id']}/900/700",
                        "last_seen_at": now,
                    },
                )

                seller_name = f"{stores[store_idx]['name']} Official"
                await session.execute(
                    text(
                        """
                        insert into catalog_offers (
                            id, canonical_product_id, store_id, seller_id, store_product_id, product_variant_id, offer_url,
                            currency, price_amount, old_price_amount, in_stock, delivery_days, shipping_cost, scraped_at, is_valid
                        )
                        values (
                            :id, :canonical_product_id, :store_id,
                            (select id from catalog_sellers where store_id = :store_id and normalized_name = :seller_normalized limit 1),
                            :store_product_id, null, :offer_url,
                            'UZS', :price_amount, :old_price_amount, true, :delivery_days, 0, :scraped_at, true
                        )
                        on conflict (id) do update
                        set canonical_product_id = excluded.canonical_product_id,
                            store_id = excluded.store_id,
                            seller_id = excluded.seller_id,
                            offer_url = excluded.offer_url,
                            price_amount = excluded.price_amount,
                            old_price_amount = excluded.old_price_amount,
                            scraped_at = excluded.scraped_at,
                            in_stock = true,
                            is_valid = true
                        """
                    ),
                    {
                        "id": offer_id,
                        "canonical_product_id": product["id"],
                        "store_id": store_id,
                        "seller_normalized": seller_name.lower(),
                        "store_product_id": store_product_id,
                        "offer_url": f"https://{stores[store_idx]['slug']}.uz/product/{product['id']}",
                        "price_amount": price,
                        "old_price_amount": price + Decimal(250_000),
                        "delivery_days": store_idx + 1,
                        "scraped_at": now - timedelta(minutes=store_idx * 5),
                    },
                )

                await session.execute(
                    text(
                        """
                        insert into catalog_price_history (offer_id, price_amount, in_stock, captured_at)
                        values (:offer_id, :price_amount, true, :captured_at)
                        """
                    ),
                    {"offer_id": offer_id, "price_amount": price, "captured_at": now - timedelta(hours=6)},
                )

            await session.execute(
                text(
                    """
                    insert into catalog_product_search (product_id, tsv, min_price, max_price, store_count, updated_at)
                    values (
                        :product_id,
                        to_tsvector('simple', :title),
                        :min_price,
                        :max_price,
                        3,
                        :updated_at
                    )
                    on conflict (product_id) do update
                    set tsv = excluded.tsv,
                        min_price = excluded.min_price,
                        max_price = excluded.max_price,
                        store_count = excluded.store_count,
                        updated_at = excluded.updated_at
                    """
                ),
                {
                    "product_id": product["id"],
                    "title": product["title"],
                    "min_price": min(prices),
                    "max_price": max(prices),
                    "updated_at": now,
                },
            )

        await session.commit()
        print("seed completed: demo catalog phones inserted")


if __name__ == "__main__":
    asyncio.run(main())
