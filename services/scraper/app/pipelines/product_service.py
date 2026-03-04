from __future__ import annotations

import hashlib
import re
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Offer, PriceHistory, Product, Shop
from app.parsers.base import ParsedProduct, ParsedVariant
from app.utils.variants import build_variant_key
from shared.db.models import (
    CatalogCanonicalProduct,
    CatalogOffer,
    CatalogPriceHistory,
    CatalogProduct,
    CatalogProductVariant,
    CatalogSeller,
    CatalogStore,
    CatalogStoreProduct,
)
from shared.utils.time import UTC


class ProductService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @staticmethod
    def _shop_name_candidates(name: str) -> set[str]:
        clean = " ".join(name.split()).strip()
        if not clean:
            return {name}
        lowered = clean.lower()
        candidates = {clean}
        if lowered.endswith(" uz"):
            candidates.add(clean[:-3].strip())
        else:
            candidates.add(f"{clean} UZ")
        return {item for item in candidates if item}

    @staticmethod
    def _store_slug(name: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-")
        if slug.endswith("-uz"):
            slug = slug[:-3].strip("-")
        return slug or "store"

    @staticmethod
    def _store_provider(slug: str) -> str:
        if slug == "texnomart":
            return "texnomart"
        if slug == "mediapark":
            return "mediapark"
        if slug == "alifshop":
            return "alifshop"
        return "generic"

    @staticmethod
    def _is_in_stock(availability: str | None) -> bool:
        value = str(availability or "").strip().lower()
        return value not in {"out_of_stock", "нет", "no"}

    @staticmethod
    def _pick_main_image(images: list[str]) -> str | None:
        if not images:
            return None
        for image in images:
            candidate = str(image or "").strip()
            if not candidate:
                continue
            lower = candidate.lower()
            if re.search(r"(logo|icon|shopping-card|cart|basket|sprite|telegram|whatsapp)", lower):
                continue
            if re.search(r"[.](jpg|jpeg|png|webp|avif)([?]|$)", lower):
                return candidate
        return str(images[0]).strip() if images else None

    @staticmethod
    def _normalize_variant_key(raw_key: str | None, *, variant: ParsedVariant) -> str:
        key = str(raw_key or "").strip()
        if key:
            return key
        return build_variant_key(variant.color, variant.storage, variant.ram)

    @staticmethod
    def _merge_specifications(base: dict[str, str], override: dict[str, str]) -> dict[str, str]:
        merged = dict(base or {})
        for key, value in (override or {}).items():
            if value is None:
                continue
            merged[str(key)] = str(value)
        return merged

    @staticmethod
    def _variant_attrs(variant: ParsedVariant, specs: dict[str, str]) -> dict:
        attrs = {
            "color": variant.color or specs.get("color"),
            "storage": variant.storage or specs.get("storage_gb"),
            "ram": variant.ram or specs.get("ram_gb"),
        }
        return {key: value for key, value in attrs.items() if value}

    @staticmethod
    def _iter_variants(parsed: ParsedProduct) -> list[ParsedVariant]:
        if parsed.variants:
            return parsed.variants
        return [
            ParsedVariant(
                variant_key=build_variant_key(
                    parsed.specifications.get("color"),
                    parsed.specifications.get("storage_gb"),
                    parsed.specifications.get("ram_gb"),
                ),
                price=parsed.price,
                old_price=parsed.old_price,
                availability=parsed.availability,
                images=parsed.images,
                specifications=parsed.specifications,
                product_url=parsed.product_url,
            )
        ]

    @staticmethod
    def _catalog_external_id(product_url: str, variant_key: str) -> str:
        source = f"{product_url}::{variant_key}"
        digest = hashlib.sha1(source.encode("utf-8")).hexdigest()
        return f"v1_{digest}"[:255]

    async def get_or_create_shop(self, name: str, url: str) -> Shop:
        if not settings.legacy_write_enabled:
            return Shop(name=name, url=url)
        candidates = self._shop_name_candidates(name)
        result = await self.session.execute(select(Shop).where(Shop.name.in_(candidates)))
        shop = result.scalar_one_or_none()
        if shop:
            if shop.name != name:
                shop.name = name
                shop.url = url
            return shop
        shop = Shop(name=name, url=url)
        self.session.add(shop)
        try:
            await self.session.flush()
            return shop
        except IntegrityError:
            await self.session.rollback()
            result = await self.session.execute(select(Shop).where(Shop.name.in_(candidates)))
            existing = result.scalar_one_or_none()
            if existing is None:
                raise
            if existing.name != name:
                existing.name = name
                existing.url = url
            return existing

    async def upsert_offer(self, parsed: ParsedProduct, shop: Shop, category_id: int | None = None) -> Offer | None:
        variants = self._iter_variants(parsed)
        legacy_product: Product | None = None
        if settings.legacy_write_enabled:
            if shop.id is None:
                raise ValueError("legacy shop id is required when LEGACY_WRITE_ENABLED=true")
            legacy_product = await self._resolve_or_create_product(parsed=parsed, shop_id=shop.id, category_id=category_id)

        catalog_store = await self._resolve_or_create_catalog_store(name=shop.name, url=shop.url)
        catalog_seller = await self._resolve_or_create_catalog_seller(store_id=int(catalog_store.id), seller_name=shop.name)
        catalog_canonical = await self._resolve_or_create_catalog_canonical(
            title=parsed.title,
            image=self._pick_main_image(parsed.images),
            specs=parsed.specifications,
        )
        catalog_product = await self._resolve_or_create_catalog_product(
            legacy_product_id=int(legacy_product.id) if legacy_product is not None else None,
            canonical_product_id=int(catalog_canonical.id),
            title=parsed.title,
        )

        processed_variant_keys: set[str] = set()
        upserted_legacy: Offer | None = None

        for variant in variants:
            variant_key = self._normalize_variant_key(variant.variant_key, variant=variant)
            processed_variant_keys.add(variant_key)
            payload_price = variant.price
            payload_old_price = variant.old_price
            payload_availability = variant.availability
            payload_images = variant.images or parsed.images
            payload_specs = self._merge_specifications(parsed.specifications, variant.specifications)
            payload_attrs = self._variant_attrs(variant, payload_specs)

            legacy_offer: Offer | None = None
            if settings.legacy_write_enabled:
                if legacy_product is None or shop.id is None:
                    raise ValueError("legacy state is not initialized")
                legacy_offer = await self._upsert_legacy_offer(
                    product_id=int(legacy_product.id),
                    shop_id=int(shop.id),
                    product_url=parsed.product_url,
                    variant_key=variant_key,
                    price=payload_price,
                    old_price=payload_old_price,
                    availability=payload_availability,
                    images=payload_images,
                    specifications=payload_specs,
                    variant_attrs=payload_attrs,
                )
                upserted_legacy = upserted_legacy or legacy_offer

            catalog_variant = await self._resolve_or_create_catalog_variant(
                product_id=int(catalog_product.id),
                variant_key=variant_key,
                variant_attrs=payload_attrs,
            )
            store_product = await self._upsert_catalog_store_product(
                legacy_offer_id=int(legacy_offer.id) if legacy_offer is not None else None,
                store_id=int(catalog_store.id),
                canonical_product_id=int(catalog_canonical.id),
                product_id=int(catalog_product.id),
                product_url=parsed.product_url,
                variant_key=variant_key,
                title=parsed.title,
                description=parsed.description,
                images=payload_images,
                availability=payload_availability,
                specifications=payload_specs,
                variant_attrs=payload_attrs,
            )
            await self._upsert_catalog_offer(
                legacy_offer_id=int(legacy_offer.id) if legacy_offer is not None else None,
                store_product_id=int(store_product.id),
                canonical_product_id=int(catalog_canonical.id),
                store_id=int(catalog_store.id),
                seller_id=int(catalog_seller.id),
                product_variant_id=int(catalog_variant.id),
                product_url=parsed.product_url,
                price=payload_price,
                old_price=payload_old_price,
                availability=payload_availability,
            )

        if settings.legacy_write_enabled and "alif" in shop.name.lower() and processed_variant_keys:
            stale_result = await self.session.execute(
                select(Offer).where(
                    Offer.shop_id == shop.id,
                    Offer.link == parsed.product_url,
                    Offer.variant_key.notin_(processed_variant_keys),
                )
            )
            for stale_offer in stale_result.scalars().all():
                await self.session.delete(stale_offer)

        if settings.legacy_write_enabled and upserted_legacy is None:
            raise ValueError("no variants to persist")
        return upserted_legacy

    async def _upsert_legacy_offer(
        self,
        *,
        product_id: int,
        shop_id: int,
        product_url: str,
        variant_key: str,
        price: Decimal,
        old_price: Decimal | None,
        availability: str,
        images: list[str],
        specifications: dict[str, str],
        variant_attrs: dict,
    ) -> Offer:
        result = await self.session.execute(
            select(Offer)
            .where(
                Offer.shop_id == shop_id,
                Offer.link == product_url,
                Offer.variant_key == variant_key,
            )
            .order_by(Offer.id.asc())
        )
        existing_offers = list(result.scalars().all())
        offer = existing_offers[0] if existing_offers else None
        duplicate_offers = existing_offers[1:]
        if offer is not None:
            if offer.price != price:
                self.session.add(PriceHistory(offer_id=offer.id, price=price))
            offer.price = price
            offer.old_price = old_price
            offer.availability = availability
            offer.images = images
            offer.specifications = specifications
            offer.variant_attrs = variant_attrs
            for duplicate in duplicate_offers:
                await self.session.delete(duplicate)
            return offer

        offer = Offer(
            product_id=product_id,
            shop_id=shop_id,
            price=price,
            old_price=old_price,
            availability=availability,
            link=product_url,
            variant_key=variant_key,
            variant_attrs=variant_attrs,
            images=images,
            specifications=specifications,
        )
        self.session.add(offer)
        await self.session.flush()
        self.session.add(PriceHistory(offer_id=offer.id, price=price))
        return offer

    async def _resolve_or_create_product(self, *, parsed: ParsedProduct, shop_id: int, category_id: int | None) -> Product:
        existing_offer = (
            await self.session.execute(
                select(Offer).where(Offer.shop_id == shop_id, Offer.link == parsed.product_url).order_by(Offer.id.asc())
            )
        ).scalars().first()
        if existing_offer:
            product = await self.session.get(Product, existing_offer.product_id)
            if product is not None:
                product.title = parsed.title
                product.description = parsed.description
                if category_id is not None and not product.category_id:
                    product.category_id = category_id
                return product

        product = Product(
            title=parsed.title,
            description=parsed.description,
            category_id=category_id,
            metadata_json={"source_url": parsed.product_url},
        )
        self.session.add(product)
        await self.session.flush()
        return product

    async def _resolve_or_create_catalog_store(self, *, name: str, url: str) -> CatalogStore:
        slug = self._store_slug(name)
        result = await self.session.execute(select(CatalogStore).where(CatalogStore.slug == slug))
        store = result.scalar_one_or_none()
        if store is not None:
            store.name = name
            store.base_url = url
            store.is_active = True
            return store
        store = CatalogStore(
            slug=slug,
            name=name,
            provider=self._store_provider(slug),
            base_url=url,
            country_code="UZ",
            is_active=True,
            trust_score=Decimal("0.80"),
            crawl_priority=100,
        )
        self.session.add(store)
        await self.session.flush()
        return store

    async def _resolve_or_create_catalog_seller(self, *, store_id: int, seller_name: str) -> CatalogSeller:
        normalized_name = re.sub(r"[^a-zA-Z0-9]+", " ", str(seller_name or "")).strip().lower()
        result = await self.session.execute(
            select(CatalogSeller).where(
                CatalogSeller.store_id == store_id,
                CatalogSeller.normalized_name == normalized_name,
            )
        )
        seller = result.scalar_one_or_none()
        if seller is not None:
            seller.name = seller_name
            return seller
        seller = CatalogSeller(
            store_id=store_id,
            name=seller_name,
            normalized_name=normalized_name,
            metadata_json={"source": "dual-write"},
        )
        self.session.add(seller)
        await self.session.flush()
        return seller

    async def _resolve_or_create_catalog_canonical(
        self, *, title: str, image: str | None, specs: dict[str, str]
    ) -> CatalogCanonicalProduct:
        normalized_title = str(title or "").strip().lower()
        result = await self.session.execute(
            select(CatalogCanonicalProduct).where(
                CatalogCanonicalProduct.category_id == 1,
                CatalogCanonicalProduct.normalized_title == normalized_title,
            )
        )
        canonical = result.scalar_one_or_none()
        if canonical is not None:
            if image and not canonical.main_image:
                canonical.main_image = image
            if specs and (not canonical.specs or canonical.specs == {}):
                canonical.specs = dict(specs)
            return canonical
        canonical = CatalogCanonicalProduct(
            normalized_title=normalized_title,
            main_image=image,
            category_id=1,
            specs=dict(specs or {}),
            is_active=True,
        )
        self.session.add(canonical)
        await self.session.flush()
        return canonical

    async def _resolve_or_create_catalog_product(
        self, *, legacy_product_id: int | None, canonical_product_id: int, title: str
    ) -> CatalogProduct:
        product: CatalogProduct | None = None
        if legacy_product_id is not None:
            product = await self.session.get(CatalogProduct, legacy_product_id)
        if product is None:
            result = await self.session.execute(
                select(CatalogProduct).where(
                    CatalogProduct.canonical_product_id == canonical_product_id,
                    CatalogProduct.normalized_title == str(title or "").strip().lower(),
                )
            )
            product = result.scalar_one_or_none()
        if product is not None:
            product.canonical_product_id = canonical_product_id
            product.normalized_title = str(title or "").strip().lower()
            product.status = "active"
            return product

        product = CatalogProduct(
            id=legacy_product_id if legacy_product_id is not None else None,
            canonical_product_id=canonical_product_id,
            category_id=1,
            normalized_title=str(title or "").strip().lower(),
            attributes={},
            specs={},
            status="active",
        )
        self.session.add(product)
        await self.session.flush()
        return product

    async def _resolve_or_create_catalog_variant(
        self, *, product_id: int, variant_key: str, variant_attrs: dict
    ) -> CatalogProductVariant:
        result = await self.session.execute(
            select(CatalogProductVariant).where(
                CatalogProductVariant.product_id == product_id,
                CatalogProductVariant.variant_key == variant_key,
            )
        )
        variant = result.scalar_one_or_none()
        if variant is not None:
            variant.color = str(variant_attrs.get("color") or variant.color or "")[:64] or None
            variant.storage = str(variant_attrs.get("storage") or variant.storage or "")[:64] or None
            variant.ram = str(variant_attrs.get("ram") or variant.ram or "")[:64] or None
            if variant_attrs:
                variant.other_attrs = dict(variant_attrs)
            return variant
        variant = CatalogProductVariant(
            product_id=product_id,
            variant_key=variant_key,
            color=str(variant_attrs.get("color") or "")[:64] or None,
            storage=str(variant_attrs.get("storage") or "")[:64] or None,
            ram=str(variant_attrs.get("ram") or "")[:64] or None,
            other_attrs=dict(variant_attrs or {}),
        )
        self.session.add(variant)
        await self.session.flush()
        return variant

    async def _upsert_catalog_store_product(
        self,
        *,
        legacy_offer_id: int | None,
        store_id: int,
        canonical_product_id: int,
        product_id: int,
        product_url: str,
        variant_key: str,
        title: str,
        description: str | None,
        images: list[str],
        availability: str,
        specifications: dict[str, str],
        variant_attrs: dict,
    ) -> CatalogStoreProduct:
        external_id = self._catalog_external_id(product_url=product_url, variant_key=variant_key)
        store_product: CatalogStoreProduct | None = None
        if legacy_offer_id is not None:
            store_product = await self.session.get(CatalogStoreProduct, legacy_offer_id)
        if store_product is None:
            result = await self.session.execute(
                select(CatalogStoreProduct).where(
                    CatalogStoreProduct.store_id == store_id,
                    CatalogStoreProduct.external_id == external_id,
                )
            )
            store_product = result.scalar_one_or_none()

        metadata_json = {
            "images": list(images or []),
            "specifications": dict(specifications or {}),
            "variant_key": variant_key,
            "variant_attrs": dict(variant_attrs or {}),
        }
        main_image = self._pick_main_image(images)
        if store_product is not None:
            store_product.canonical_product_id = canonical_product_id
            store_product.product_id = product_id
            store_product.external_url = product_url
            store_product.title_raw = title
            store_product.title_clean = str(title or "").strip().lower()
            store_product.description_raw = description
            store_product.image_url = main_image
            store_product.availability = availability
            store_product.metadata_json = metadata_json
            store_product.last_seen_at = datetime.now(UTC)
            return store_product

        store_product = CatalogStoreProduct(
            id=legacy_offer_id if legacy_offer_id is not None else None,
            store_id=store_id,
            canonical_product_id=canonical_product_id,
            product_id=product_id,
            external_id=external_id,
            external_url=product_url,
            title_raw=title,
            title_clean=str(title or "").strip().lower(),
            description_raw=description,
            image_url=main_image,
            availability=availability,
            metadata_json=metadata_json,
            last_seen_at=datetime.now(UTC),
        )
        self.session.add(store_product)
        await self.session.flush()
        return store_product

    async def _upsert_catalog_offer(
        self,
        *,
        legacy_offer_id: int | None,
        store_product_id: int,
        canonical_product_id: int,
        store_id: int,
        seller_id: int,
        product_variant_id: int,
        product_url: str,
        price: Decimal,
        old_price: Decimal | None,
        availability: str,
    ) -> CatalogOffer:
        catalog_offer: CatalogOffer | None = None
        if legacy_offer_id is not None:
            catalog_offer = await self.session.get(CatalogOffer, legacy_offer_id)
        if catalog_offer is None:
            result = await self.session.execute(
                select(CatalogOffer).where(CatalogOffer.store_product_id == store_product_id).order_by(CatalogOffer.id.asc())
            )
            offers = list(result.scalars().all())
            catalog_offer = offers[0] if offers else None
            duplicate_offers = offers[1:]
            for duplicate in duplicate_offers:
                duplicate.is_valid = False

        in_stock = self._is_in_stock(availability)
        now = datetime.now(UTC)
        if catalog_offer is not None:
            if catalog_offer.price_amount != price or catalog_offer.in_stock != in_stock:
                self.session.add(
                    CatalogPriceHistory(
                        offer_id=int(catalog_offer.id),
                        price_amount=price,
                        in_stock=in_stock,
                        captured_at=now,
                    )
                )
            catalog_offer.canonical_product_id = canonical_product_id
            catalog_offer.store_id = store_id
            catalog_offer.seller_id = seller_id
            catalog_offer.store_product_id = store_product_id
            catalog_offer.product_variant_id = product_variant_id
            catalog_offer.offer_url = product_url
            catalog_offer.currency = "UZS"
            catalog_offer.price_amount = price
            catalog_offer.old_price_amount = old_price
            catalog_offer.in_stock = in_stock
            catalog_offer.shipping_cost = Decimal("0")
            catalog_offer.scraped_at = now
            catalog_offer.is_valid = True
            return catalog_offer

        catalog_offer = CatalogOffer(
            id=legacy_offer_id if legacy_offer_id is not None else None,
            canonical_product_id=canonical_product_id,
            store_id=store_id,
            seller_id=seller_id,
            store_product_id=store_product_id,
            product_variant_id=product_variant_id,
            offer_url=product_url,
            currency="UZS",
            price_amount=price,
            old_price_amount=old_price,
            in_stock=in_stock,
            shipping_cost=Decimal("0"),
            scraped_at=now,
            is_valid=True,
        )
        self.session.add(catalog_offer)
        await self.session.flush()
        self.session.add(
            CatalogPriceHistory(
                offer_id=int(catalog_offer.id),
                price_amount=price,
                in_stock=in_stock,
                captured_at=now,
            )
        )
        return catalog_offer
