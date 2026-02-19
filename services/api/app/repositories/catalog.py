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
    CatalogCategory,
    CatalogOffer,
    CatalogProduct,
    CatalogProductSearch,
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

    async def get_product(self, product_id: int) -> CatalogProduct | None:
        result = await self.session.execute(select(CatalogProduct).where(CatalogProduct.id == product_id))
        return result.scalar_one_or_none()

    async def get_offers(self, product_id: int, limit: int, in_stock: bool | None) -> list[dict]:
        stmt = (
            select(
                CatalogOffer.id,
                CatalogOffer.price_amount,
                CatalogOffer.old_price_amount,
                CatalogOffer.in_stock,
                CatalogOffer.currency,
                CatalogOffer.scraped_at,
                CatalogStore.id.label("store_id"),
                CatalogStore.name.label("store_name"),
                CatalogStoreProduct.external_url,
            )
            .join(CatalogStoreProduct, CatalogStoreProduct.id == CatalogOffer.store_product_id)
            .join(CatalogStore, CatalogStore.id == CatalogStoreProduct.store_id)
            .where(CatalogStoreProduct.product_id == product_id)
            .order_by(CatalogOffer.price_amount.asc(), CatalogOffer.id.asc())
            .limit(limit)
        )
        if in_stock is not None:
            stmt = stmt.where(CatalogOffer.in_stock == in_stock)
        rows = (await self.session.execute(stmt)).all()
        return [
            {
                "id": r.id,
                "price_amount": r.price_amount,
                "old_price_amount": r.old_price_amount,
                "in_stock": r.in_stock,
                "currency": r.currency,
                "scraped_at": r.scraped_at,
                "store": {"id": r.store_id, "name": r.store_name},
                "external_url": r.external_url,
            }
            for r in rows
        ]

    async def search_products(
        self,
        *,
        q: str | None,
        category_id: int | None,
        brand_ids: list[int] | None,
        min_price: Decimal | None,
        max_price: Decimal | None,
        in_stock: bool | None,
        sort: str,
        limit: int,
        cursor: str | None,
    ) -> tuple[list[dict], str | None]:
        rank_expr = func.ts_rank_cd(CatalogProductSearch.tsv, func.websearch_to_tsquery("simple", q or ""))

        stmt = (
            select(
                CatalogProduct.id,
                CatalogProduct.normalized_title,
                CatalogBrand.id.label("brand_id"),
                CatalogBrand.name.label("brand_name"),
                CatalogCategory.id.label("category_id"),
                CatalogCategory.name_uz.label("category_name"),
                CatalogProductSearch.min_price,
                CatalogProductSearch.max_price,
                CatalogProductSearch.store_count,
                rank_expr.label("rank"),
            )
            .join(CatalogProductSearch, CatalogProductSearch.product_id == CatalogProduct.id)
            .join(CatalogCategory, CatalogCategory.id == CatalogProduct.category_id)
            .outerjoin(CatalogBrand, CatalogBrand.id == CatalogProduct.brand_id)
        )

        filters = []
        if q:
            filters.append(CatalogProductSearch.tsv.op("@@")(func.websearch_to_tsquery("simple", q)))
        if category_id:
            filters.append(CatalogProduct.category_id == category_id)
        if brand_ids:
            filters.append(CatalogProduct.brand_id.in_(brand_ids))
        if min_price is not None:
            filters.append(CatalogProductSearch.min_price >= min_price)
        if max_price is not None:
            filters.append(CatalogProductSearch.min_price <= max_price)
        if in_stock is True:
            filters.append(CatalogProductSearch.store_count > 0)

        if filters:
            stmt = stmt.where(and_(*filters))

        sort_map = {
            "relevance": [literal_column("rank").desc(), CatalogProduct.id.asc()],
            "price_asc": [CatalogProductSearch.min_price.asc().nulls_last(), CatalogProduct.id.asc()],
            "price_desc": [CatalogProductSearch.min_price.desc().nulls_last(), CatalogProduct.id.asc()],
            "newest": [CatalogProduct.created_at.desc(), CatalogProduct.id.asc()],
            "popular": [CatalogProductSearch.store_count.desc(), CatalogProduct.id.asc()],
        }
        order = sort_map.get(sort, sort_map["relevance"])
        stmt = stmt.order_by(*order)

        decoded = self.decode_cursor(cursor)
        if decoded:
            last_price = Decimal(decoded["last_price"]) if "last_price" in decoded else None
            if sort == "price_asc":
                stmt = stmt.where(
                    (CatalogProductSearch.min_price > last_price) |
                    ((CatalogProductSearch.min_price == last_price) & (CatalogProduct.id > decoded["last_id"]))
                )
            elif sort == "price_desc":
                stmt = stmt.where(
                    (CatalogProductSearch.min_price < last_price) |
                    ((CatalogProductSearch.min_price == last_price) & (CatalogProduct.id > decoded["last_id"]))
                )
            else:
                stmt = stmt.where(CatalogProduct.id > decoded["last_id"])

        rows = (await self.session.execute(stmt.limit(limit + 1))).all()
        has_next = len(rows) > limit
        rows = rows[:limit]

        items = [
            {
                "id": r.id,
                "normalized_title": r.normalized_title,
                "brand": {"id": r.brand_id, "name": r.brand_name} if r.brand_id else None,
                "category": {"id": r.category_id, "name": r.category_name},
                "min_price": r.min_price,
                "max_price": r.max_price,
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
            select(CatalogBrand.id, CatalogBrand.name, func.count(CatalogProduct.id).label("products_count"))
            .join(CatalogProduct, CatalogProduct.brand_id == CatalogBrand.id, isouter=True)
            .group_by(CatalogBrand.id, CatalogBrand.name)
            .order_by(CatalogBrand.name.asc())
            .limit(limit)
        )
        if q:
            stmt = stmt.where(CatalogBrand.name.ilike(f"%{q}%"))
        if category_id:
            stmt = stmt.where(CatalogProduct.category_id == category_id)
        rows = (await self.session.execute(stmt)).all()
        return [{"id": r.id, "name": r.name, "products_count": r.products_count} for r in rows]

    async def get_filter_buckets(self, category_id: int | None = None, q: str | None = None) -> dict:
        base = (
            select(
                func.min(CatalogProductSearch.min_price),
                func.max(CatalogProductSearch.max_price),
                func.count(CatalogProduct.id),
            )
            .join(CatalogProduct, CatalogProduct.id == CatalogProductSearch.product_id)
        )
        if category_id:
            base = base.where(CatalogProduct.category_id == category_id)
        if q:
            base = base.where(CatalogProductSearch.tsv.op("@@")(func.websearch_to_tsquery("simple", q)))

        min_price, max_price, count = (await self.session.execute(base)).one()
        brands = await self.list_brands(category_id=category_id, limit=50)
        return {
            "price": {"min": min_price, "max": max_price},
            "brands": brands,
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
            join catalog_store_products sp on sp.id = o.store_product_id
            where sp.product_id = :product_id
              and ph.captured_at >= now() - (:days || ' days')::interval
            group by 1
            order by 1 asc
            """
        )
        rows = (await self.session.execute(stmt, {"product_id": product_id, "days": days})).all()
        return [{"date": r.day.date().isoformat(), "min_price": r.min_price, "max_price": r.max_price} for r in rows]
