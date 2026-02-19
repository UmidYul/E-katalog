from __future__ import annotations

import base64
import hashlib
import hmac
import json
from decimal import Decimal

from sqlalchemy import and_, func, literal_column, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db.models import (
    CatalogBrand,
    CatalogCanonicalProduct,
    CatalogCategory,
    CatalogOffer,
    CatalogProductSearch,
    CatalogSeller,
    CatalogStore,
    CatalogStoreProduct,
)


class CatalogRepository:
    def __init__(self, session: AsyncSession, *, cursor_secret: str) -> None:
        self.session = session
        self.cursor_secret = cursor_secret.encode("utf-8")

    def _encode_cursor(self, payload: dict) -> str:
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        sig = hmac.new(self.cursor_secret, raw, hashlib.sha256).hexdigest()
        wrapped = {"d": payload, "s": sig}
        return base64.urlsafe_b64encode(json.dumps(wrapped, separators=(",", ":")).encode("utf-8")).decode("utf-8")

    def decode_cursor(self, cursor: str | None) -> dict | None:
        if not cursor:
            return None
        data = json.loads(base64.urlsafe_b64decode(cursor.encode("utf-8") + b"=="))
        raw = json.dumps(data["d"], separators=(",", ":"), sort_keys=True).encode("utf-8")
        expected = hmac.new(self.cursor_secret, raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, data["s"]):
            raise ValueError("invalid cursor signature")
        return data["d"]

    async def get_product(self, product_id: int) -> dict | None:
        stmt = (
            select(
                CatalogCanonicalProduct.id,
                CatalogCanonicalProduct.normalized_title,
                CatalogCanonicalProduct.main_image,
                CatalogCanonicalProduct.specs,
                CatalogCategory.name_uz.label("category_name"),
                CatalogBrand.name.label("brand_name"),
            )
            .join(CatalogCategory, CatalogCategory.id == CatalogCanonicalProduct.category_id)
            .outerjoin(CatalogBrand, CatalogBrand.id == CatalogCanonicalProduct.brand_id)
            .where(CatalogCanonicalProduct.id == product_id)
        )
        row = (await self.session.execute(stmt)).one_or_none()
        if row is None:
            return None
        specs = row.specs if isinstance(row.specs, dict) else {}
        if not specs:
            fallback_specs_stmt = text(
                """
                select metadata->'specifications' as specs
                from catalog_store_products
                where canonical_product_id = :product_id
                  and jsonb_typeof(metadata->'specifications') = 'object'
                  and (metadata->'specifications') <> '{}'::jsonb
                order by (select count(*) from jsonb_each(metadata->'specifications')) desc, last_seen_at desc
                limit 1
                """
            )
            fallback_row = (await self.session.execute(fallback_specs_stmt, {"product_id": product_id})).one_or_none()
            if fallback_row and isinstance(fallback_row.specs, dict):
                specs = fallback_row.specs
        return {
            "id": row.id,
            "title": row.normalized_title,
            "category": row.category_name,
            "brand": row.brand_name,
            "main_image": row.main_image,
            "specs": specs,
        }

    async def get_offers_by_store(
        self,
        product_id: int,
        limit: int,
        in_stock: bool | None,
        sort: str = "price",
        store_ids: list[int] | None = None,
        seller_ids: list[int] | None = None,
        max_delivery_days: int | None = None,
    ) -> list[dict]:
        stmt = (
            select(
                CatalogOffer.id,
                CatalogOffer.store_id,
                CatalogStore.name.label("store_name"),
                CatalogOffer.seller_id,
                CatalogSeller.name.label("seller_name"),
                CatalogOffer.price_amount,
                CatalogOffer.old_price_amount,
                CatalogOffer.in_stock,
                CatalogOffer.currency,
                CatalogOffer.delivery_days,
                CatalogOffer.scraped_at,
                func.coalesce(CatalogOffer.offer_url, CatalogStoreProduct.external_url).label("link"),
            )
            .join(CatalogStore, CatalogStore.id == CatalogOffer.store_id)
            .join(CatalogStoreProduct, CatalogStoreProduct.id == CatalogOffer.store_product_id)
            .outerjoin(CatalogSeller, CatalogSeller.id == CatalogOffer.seller_id)
            .where(
                CatalogOffer.canonical_product_id == product_id,
                CatalogOffer.is_valid.is_(True),
            )
        )
        if in_stock is not None:
            stmt = stmt.where(CatalogOffer.in_stock == in_stock)
        if store_ids:
            stmt = stmt.where(CatalogOffer.store_id.in_(store_ids))
        if seller_ids:
            stmt = stmt.where(CatalogOffer.seller_id.in_(seller_ids))
        if max_delivery_days is not None:
            stmt = stmt.where(CatalogOffer.delivery_days.is_not(None), CatalogOffer.delivery_days <= max_delivery_days)

        order_map = {
            "price": CatalogOffer.price_amount.asc(),
            "delivery": CatalogOffer.delivery_days.asc().nulls_last(),
            "seller_rating": CatalogSeller.rating.desc().nulls_last(),
        }
        stmt = stmt.order_by(order_map.get(sort, order_map["price"]), CatalogOffer.id.asc()).limit(limit)
        rows = (await self.session.execute(stmt)).all()

        by_store: dict[int, dict] = {}
        for row in rows:
            if row.store_id not in by_store:
                by_store[row.store_id] = {
                    "store_id": row.store_id,
                    "store": row.store_name,
                    "minimal_price": None,
                    "offers_count": 0,
                    "offers": [],
                }
            bucket = by_store[row.store_id]
            offer_payload = {
                "id": row.id,
                "seller_id": row.seller_id,
                "seller_name": row.seller_name or row.store_name,
                "price_amount": float(row.price_amount),
                "old_price_amount": float(row.old_price_amount) if row.old_price_amount is not None else None,
                "in_stock": row.in_stock,
                "currency": row.currency,
                "delivery_days": row.delivery_days,
                "scraped_at": row.scraped_at,
                "link": row.link,
            }
            bucket["offers"].append(offer_payload)
            bucket["offers_count"] += 1
            if bucket["minimal_price"] is None or offer_payload["price_amount"] < bucket["minimal_price"]:
                bucket["minimal_price"] = offer_payload["price_amount"]

        result = sorted(
            by_store.values(),
            key=lambda item: (item["minimal_price"] if item["minimal_price"] is not None else 10**18),
        )
        return result

    async def get_offers(
        self,
        product_id: int,
        limit: int,
        in_stock: bool | None,
        sort: str = "price",
        store_ids: list[int] | None = None,
        seller_ids: list[int] | None = None,
        max_delivery_days: int | None = None,
    ) -> list[dict]:
        offers_by_store = await self.get_offers_by_store(
            product_id=product_id,
            limit=limit,
            in_stock=in_stock,
            sort=sort,
            store_ids=store_ids,
            seller_ids=seller_ids,
            max_delivery_days=max_delivery_days,
        )
        return [offer for group in offers_by_store for offer in group["offers"]]

    async def search_products(
        self,
        *,
        q: str | None,
        category_id: int | None,
        brand_ids: list[int] | None,
        min_price: Decimal | None,
        max_price: Decimal | None,
        in_stock: bool | None,
        store_ids: list[int] | None,
        seller_ids: list[int] | None,
        max_delivery_days: int | None,
        sort: str,
        limit: int,
        cursor: str | None,
    ) -> tuple[list[dict], str | None]:
        rank_expr = func.ts_rank_cd(CatalogProductSearch.tsv, func.websearch_to_tsquery("simple", q or ""))
        stmt = (
            select(
                CatalogCanonicalProduct.id,
                CatalogCanonicalProduct.normalized_title,
                CatalogCanonicalProduct.main_image,
                CatalogBrand.id.label("brand_id"),
                CatalogBrand.name.label("brand_name"),
                CatalogCategory.id.label("category_id"),
                CatalogCategory.name_uz.label("category_name"),
                CatalogProductSearch.min_price,
                CatalogProductSearch.max_price,
                CatalogProductSearch.store_count,
                rank_expr.label("rank"),
            )
            .join(CatalogProductSearch, CatalogProductSearch.product_id == CatalogCanonicalProduct.id)
            .join(CatalogCategory, CatalogCategory.id == CatalogCanonicalProduct.category_id)
            .outerjoin(CatalogBrand, CatalogBrand.id == CatalogCanonicalProduct.brand_id)
        )

        filters = []
        if q:
            filters.append(CatalogProductSearch.tsv.op("@@")(func.websearch_to_tsquery("simple", q)))
        if category_id:
            filters.append(CatalogCanonicalProduct.category_id == category_id)
        if brand_ids:
            filters.append(CatalogCanonicalProduct.brand_id.in_(brand_ids))
        if min_price is not None:
            filters.append(CatalogProductSearch.min_price >= min_price)
        if max_price is not None:
            filters.append(CatalogProductSearch.min_price <= max_price)
        if in_stock is True:
            filters.append(CatalogProductSearch.store_count > 0)
        if store_ids:
            filters.append(
                CatalogCanonicalProduct.id.in_(
                    select(CatalogOffer.canonical_product_id).where(
                        CatalogOffer.store_id.in_(store_ids),
                        CatalogOffer.is_valid.is_(True),
                    )
                )
            )
        if seller_ids:
            filters.append(
                CatalogCanonicalProduct.id.in_(
                    select(CatalogOffer.canonical_product_id).where(
                        CatalogOffer.seller_id.in_(seller_ids),
                        CatalogOffer.is_valid.is_(True),
                    )
                )
            )
        if max_delivery_days is not None:
            filters.append(
                CatalogCanonicalProduct.id.in_(
                    select(CatalogOffer.canonical_product_id).where(
                        CatalogOffer.delivery_days.is_not(None),
                        CatalogOffer.delivery_days <= max_delivery_days,
                        CatalogOffer.is_valid.is_(True),
                    )
                )
            )
        if filters:
            stmt = stmt.where(and_(*filters))

        sort_map = {
            "relevance": [literal_column("rank").desc(), CatalogCanonicalProduct.id.asc()],
            "price_asc": [CatalogProductSearch.min_price.asc().nulls_last(), CatalogCanonicalProduct.id.asc()],
            "price_desc": [CatalogProductSearch.min_price.desc().nulls_last(), CatalogCanonicalProduct.id.asc()],
            "newest": [CatalogCanonicalProduct.created_at.desc(), CatalogCanonicalProduct.id.asc()],
            "popular": [CatalogProductSearch.store_count.desc(), CatalogCanonicalProduct.id.asc()],
        }
        stmt = stmt.order_by(*sort_map.get(sort, sort_map["relevance"]))

        decoded = self.decode_cursor(cursor)
        if decoded:
            last_price = Decimal(decoded["last_price"]) if "last_price" in decoded else None
            if sort == "price_asc":
                stmt = stmt.where(
                    (CatalogProductSearch.min_price > last_price)
                    | ((CatalogProductSearch.min_price == last_price) & (CatalogCanonicalProduct.id > decoded["last_id"]))
                )
            elif sort == "price_desc":
                stmt = stmt.where(
                    (CatalogProductSearch.min_price < last_price)
                    | ((CatalogProductSearch.min_price == last_price) & (CatalogCanonicalProduct.id > decoded["last_id"]))
                )
            else:
                stmt = stmt.where(CatalogCanonicalProduct.id > decoded["last_id"])

        rows = (await self.session.execute(stmt.limit(limit + 1))).all()
        has_next = len(rows) > limit
        rows = rows[:limit]

        items = [
            {
                "id": r.id,
                "normalized_title": r.normalized_title,
                "image_url": r.main_image,
                "brand": {"id": r.brand_id, "name": r.brand_name} if r.brand_id else None,
                "category": {"id": r.category_id, "name": r.category_name},
                "min_price": float(r.min_price) if r.min_price is not None else None,
                "max_price": float(r.max_price) if r.max_price is not None else None,
                "store_count": r.store_count,
                "score": float(r.rank or 0),
            }
            for r in rows
        ]

        next_cursor = None
        if has_next and rows:
            last = rows[-1]
            payload = {"last_id": last.id, "sort": sort}
            if sort in {"price_asc", "price_desc"}:
                payload["last_price"] = str(last.min_price or "0")
            next_cursor = self._encode_cursor(payload)

        return items, next_cursor

    async def list_categories(self) -> list[dict]:
        rows = (
            await self.session.execute(
                select(CatalogCategory.id, CatalogCategory.slug, CatalogCategory.name_uz, CatalogCategory.parent_id)
                .where(CatalogCategory.is_active.is_(True))
                .order_by(CatalogCategory.lft.asc(), CatalogCategory.id.asc())
            )
        ).all()
        return [{"id": r.id, "slug": r.slug, "name": r.name_uz, "parent_id": r.parent_id} for r in rows]

    async def list_stores(self, active_only: bool) -> list[dict]:
        stmt = select(CatalogStore.id, CatalogStore.slug, CatalogStore.name, CatalogStore.is_active)
        if active_only:
            stmt = stmt.where(CatalogStore.is_active.is_(True))
        rows = (await self.session.execute(stmt.order_by(CatalogStore.name.asc()))).all()
        return [{"id": r.id, "slug": r.slug, "name": r.name, "is_active": r.is_active} for r in rows]

    async def list_brands(self, q: str | None = None, category_id: int | None = None, limit: int = 100) -> list[dict]:
        stmt = (
            select(CatalogBrand.id, CatalogBrand.name, func.count(CatalogCanonicalProduct.id).label("products_count"))
            .join(CatalogCanonicalProduct, CatalogCanonicalProduct.brand_id == CatalogBrand.id, isouter=True)
            .group_by(CatalogBrand.id, CatalogBrand.name)
            .order_by(CatalogBrand.name.asc())
            .limit(limit)
        )
        if q:
            stmt = stmt.where(CatalogBrand.name.ilike(f"%{q}%"))
        if category_id:
            stmt = stmt.where(CatalogCanonicalProduct.category_id == category_id)
        rows = (await self.session.execute(stmt)).all()
        return [{"id": r.id, "name": r.name, "products_count": r.products_count} for r in rows]

    async def get_filter_buckets(self, category_id: int | None = None, q: str | None = None) -> dict:
        base = (
            select(
                func.min(CatalogProductSearch.min_price),
                func.max(CatalogProductSearch.max_price),
                func.count(CatalogCanonicalProduct.id),
            )
            .join(CatalogCanonicalProduct, CatalogCanonicalProduct.id == CatalogProductSearch.product_id)
        )
        if category_id:
            base = base.where(CatalogCanonicalProduct.category_id == category_id)
        if q:
            base = base.where(CatalogProductSearch.tsv.op("@@")(func.websearch_to_tsquery("simple", q)))

        min_price, max_price, count = (await self.session.execute(base)).one()
        brands = await self.list_brands(category_id=category_id, limit=50)
        sellers_stmt = (
            select(CatalogSeller.id, CatalogSeller.name, func.count(CatalogOffer.id).label("offers_count"))
            .join(CatalogOffer, CatalogOffer.seller_id == CatalogSeller.id)
            .join(CatalogCanonicalProduct, CatalogCanonicalProduct.id == CatalogOffer.canonical_product_id)
            .group_by(CatalogSeller.id, CatalogSeller.name)
            .order_by(func.count(CatalogOffer.id).desc())
            .limit(100)
        )
        if category_id:
            sellers_stmt = sellers_stmt.where(CatalogCanonicalProduct.category_id == category_id)
        sellers_rows = (await self.session.execute(sellers_stmt)).all()
        return {
            "price": {"min": min_price, "max": max_price},
            "brands": brands,
            "stores": await self.list_stores(active_only=True),
            "sellers": [{"id": row.id, "name": row.name, "offers_count": row.offers_count} for row in sellers_rows],
            "total_products": count,
        }

    async def price_history(self, product_id: int, days: int) -> list[dict]:
        stmt = text(
            """
            select date_trunc('day', ph.captured_at) as day,
                   min(ph.price_amount) as min_price,
                   max(ph.price_amount) as max_price
            from catalog_price_history ph
            join catalog_offers o on o.id = ph.offer_id
            where o.canonical_product_id = :product_id
              and ph.captured_at >= now() - (:days || ' days')::interval
            group by 1
            order by 1 asc
            """
        )
        rows = (await self.session.execute(stmt, {"product_id": product_id, "days": days})).all()
        return [{"date": r.day.date().isoformat(), "min_price": r.min_price, "max_price": r.max_price} for r in rows]
