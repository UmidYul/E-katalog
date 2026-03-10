from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import logger
from app.db.models import Offer, PriceHistory, Product, Shop
from app.parsers.base import ParsedProduct, ParsedVariant
from app.utils.variants import build_variant_key
from shared.db.models import (
    CatalogBrand,
    CatalogCategory,
    CatalogCanonicalProduct,
    CatalogIngestQuarantine,
    CatalogOffer,
    CatalogPriceHistory,
    CatalogProduct,
    CatalogProductVariant,
    CatalogSeller,
    CatalogStore,
    CatalogStoreProduct,
)
from shared.utils.time import UTC


@dataclass(slots=True)
class CategoryClassification:
    category_slug: str
    confidence: float
    reason: str


@dataclass(slots=True)
class IngestResult:
    status: Literal["done", "quarantined", "invalid"]
    reason: str | None = None
    category_slug: str | None = None
    confidence: float | None = None
    validation_errors: list[str] | None = None


class ProductService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @staticmethod
    def _infer_brand_name(*, title: str, specs: dict[str, str] | None) -> str | None:
        title_value = str(title or "").lower()
        spec_values = " ".join(str(value or "") for value in (specs or {}).values()).lower()
        signal = f"{title_value} {spec_values}".strip()
        if not signal:
            return None
        brand_aliases: tuple[tuple[str, tuple[str, ...]], ...] = (
            ("Apple", ("apple", "iphone")),
            ("Samsung", ("samsung", "galaxy")),
            ("Xiaomi", ("xiaomi", "redmi", "poco")),
            ("Honor", ("honor",)),
            ("Huawei", ("huawei",)),
            ("Google", ("google", "pixel")),
            ("OnePlus", ("oneplus", "one plus")),
            ("Nothing", ("nothing",)),
        )
        for brand_name, aliases in brand_aliases:
            for alias in aliases:
                if re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", signal, flags=re.IGNORECASE):
                    return brand_name
        return None

    @staticmethod
    def _normalize_brand_name(name: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", str(name or "").strip().lower()).strip()

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
        return value not in {"out_of_stock", "РЅРµС‚", "no"}

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

    @classmethod
    def _classify_category_from_text(
        cls, *, title: str, specs: dict[str, str] | None, category_slug_hint: str | None
    ) -> CategoryClassification:
        hint = str(category_slug_hint or "").strip().lower()
        if hint in cls._CATEGORY_REGISTRY and hint != "unknown":
            return CategoryClassification(category_slug=hint, confidence=1.0, reason="category_hint")

        signal = f"{str(title or '')} {' '.join(str(v or '') for v in (specs or {}).values())}".lower()
        rules: tuple[tuple[str, tuple[str, ...], float], ...] = (
            ("headphones", ("РЅР°СѓС€", "РіР°СЂРЅРёС‚СѓСЂ", "headphone", "earbud", "airpods", "buds"), 0.95),
            ("consoles", ("playstation", "xbox", "nintendo", "ps5", "ps4", "РєРѕРЅСЃРѕР»", "console"), 0.90),
            (
                "appliances",
                (
                    "С…РѕР»РѕРґРёР»",
                    "СЃС‚РёСЂР°Р»",
                    "РїС‹Р»РµСЃРѕСЃ",
                    "РјРёРєСЂРѕРІРѕР»РЅ",
                    "РґСѓС…РѕРІ",
                    "РїР»РёС‚Р°",
                    "vacuum",
                    "washer",
                    "conditioner",
                    "air fryer",
                    "С‡Р°Р№РЅРёРє",
                    "СѓС‚СЋРі",
                    "Р±РѕР№Р»РµСЂ",
                    "С‚РѕСЃС‚РµСЂ",
                ),
                0.90,
            ),
            (
                "cameras",
                (
                    "РєР°РјРµСЂР°",
                    "С„РѕС‚РѕР°РїРїР°СЂР°С‚",
                    "Р±РµР·Р·РµСЂРєР°Р»",
                    "РѕР±СЉРµРєС‚РёРІ",
                    "camera",
                    "dslr",
                    "gopro",
                    "mirrorless",
                    "lens",
                ),
                0.90,
            ),
            ("tvs", ("telev", "televizor", " smart tv", "oled", "qled", "android tv"), 0.88),
            ("watches", ("watch", "smart watch", "СЃРјР°СЂС‚ С‡Р°СЃС‹", "СѓРјРЅС‹Рµ С‡Р°СЃС‹", "soat", "saat"), 0.88),
            ("laptops", ("noutbuk", "laptop", "notebook", "macbook"), 0.86),
            ("tablets", ("planshet", "tablet", "ipad", "galaxy tab"), 0.84),
            ("phones", ("smartfon", "smartphone", "iphone", "galaxy", "xiaomi", "redmi", "poco"), 0.78),
        )
        for slug, tokens, confidence in rules:
            if any(token in signal for token in tokens):
                return CategoryClassification(
                    category_slug=slug,
                    confidence=float(confidence),
                    reason=f"token_match:{slug}",
                )
        return CategoryClassification(category_slug="unknown", confidence=0.0, reason="no_signal")

    @staticmethod
    def _normalize_availability(availability: str | None) -> str:
        value = str(availability or "").strip().lower()
        if value in {"in_stock", "available", "yes", "true", "есть", "в наличии"}:
            return "in_stock"
        if value in {"preorder", "pre-order", "soon", "ожидается"}:
            return "preorder"
        if value in {"out_of_stock", "РЅРµС‚", "нет", "no", "not available", "sold out"}:
            return "out_of_stock"
        return "unknown"

    @staticmethod
    def _is_valid_http_url(value: str | None) -> bool:
        source = str(value or "").strip()
        if not source:
            return False
        parsed = urlsplit(source)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

    @classmethod
    def _validate_parsed_product(cls, parsed: ParsedProduct) -> list[str]:
        errors: list[str] = []
        title = str(parsed.title or "").strip()
        normalized_title = re.sub(r"\s+", " ", title.lower())
        placeholders = {"unknown product", "product", "товар", "unknown", "n/a"}
        if not title or normalized_title in placeholders:
            errors.append("invalid_title")
        if parsed.price is None or parsed.price <= 0:
            errors.append("invalid_price")
        elif parsed.price > Decimal(str(settings.ingest_max_price_uzs)):
            errors.append("price_out_of_range")
        if not cls._is_valid_http_url(parsed.product_url):
            errors.append("invalid_product_url")
        return errors

    @classmethod
    def _validate_variant(cls, variant: ParsedVariant) -> list[str]:
        errors: list[str] = []
        if variant.price is None or variant.price <= 0:
            errors.append("invalid_variant_price")
        if variant.product_url and not cls._is_valid_http_url(variant.product_url):
            errors.append("invalid_variant_url")
        return errors
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
        result = await self.session.execute(select(Shop).where(Shop.name.in_(candidates)).order_by(Shop.id.asc()))
        shops = list(result.scalars().all())
        shop = shops[0] if shops else None
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
            result = await self.session.execute(select(Shop).where(Shop.name.in_(candidates)).order_by(Shop.id.asc()))
            existing_rows = list(result.scalars().all())
            existing = existing_rows[0] if existing_rows else None
            if existing is None:
                raise
            if existing.name != name:
                existing.name = name
                existing.url = url
            return existing

    async def upsert_offer(
        self,
        parsed: ParsedProduct,
        shop: Shop,
        category_id: int | None = None,
        category_slug: str | None = None,
        source_url: str | None = None,
        brand_hint_override: str | None = None,
    ) -> IngestResult:
        variants = self._iter_variants(parsed)
        catalog_store = await self._resolve_or_create_catalog_store(name=shop.name, url=shop.url)
        classification = self._classify_category_from_text(
            title=parsed.title,
            specs=parsed.specifications,
            category_slug_hint=category_slug,
        )

        validation_errors = self._validate_parsed_product(parsed)
        valid_variants: list[ParsedVariant] = []
        for variant in variants:
            variant_errors = self._validate_variant(variant)
            if variant_errors:
                validation_errors.extend(variant_errors)
                continue
            valid_variants.append(variant)
        if not valid_variants:
            validation_errors.append("no_valid_variants")
        if validation_errors:
            await self._upsert_quarantine_entry(
                store_id=int(catalog_store.id),
                source_url=source_url,
                parsed=parsed,
                classification=classification,
                validation_errors=validation_errors,
            )
            return IngestResult(
                status="invalid",
                reason="validation_failed",
                category_slug=classification.category_slug,
                confidence=classification.confidence,
                validation_errors=validation_errors,
            )

        threshold = max(0.0, min(1.0, float(settings.ingest_category_confidence_threshold)))
        if classification.category_slug == "unknown" or classification.confidence < threshold:
            policy = str(settings.ingest_unknown_policy or "quarantine").strip().lower()
            if policy != "fallback_phones" and settings.ingest_quarantine_enabled:
                await self._upsert_quarantine_entry(
                    store_id=int(catalog_store.id),
                    source_url=source_url,
                    parsed=parsed,
                    classification=classification,
                    validation_errors=[],
                )
                return IngestResult(
                    status="quarantined",
                    reason=classification.reason,
                    category_slug=classification.category_slug,
                    confidence=classification.confidence,
                    validation_errors=[],
                )
            category_slug_resolved = "phones"
            logger.warning(
                "ingest_unknown_category_fallback_phones",
                product_url=parsed.product_url,
                confidence=float(classification.confidence),
                reason=classification.reason,
            )
        else:
            category_slug_resolved = classification.category_slug

        catalog_category_id = await self._resolve_or_create_catalog_category(category_slug_resolved)
        normalized_brand_hint = str(brand_hint_override or "").strip()
        inferred_brand = normalized_brand_hint or self._infer_brand_name(title=parsed.title, specs=parsed.specifications)
        brand_id = await self._resolve_or_create_brand(brand_name=inferred_brand) if inferred_brand else None
        legacy_product: Product | None = None
        if settings.legacy_write_enabled:
            logger.warning("legacy_write_attempt")
            if shop.id is None:
                raise ValueError("legacy shop id is required when LEGACY_WRITE_ENABLED=true")
            legacy_product = await self._resolve_or_create_product(parsed=parsed, shop_id=shop.id, category_id=category_id)

        catalog_seller = await self._resolve_or_create_catalog_seller(store_id=int(catalog_store.id), seller_name=shop.name)
        catalog_canonical = await self._resolve_or_create_catalog_canonical(
            title=parsed.title,
            image=self._pick_main_image(parsed.images),
            specs=parsed.specifications,
            brand_id=brand_id,
            category_id=catalog_category_id,
        )
        catalog_product = await self._resolve_or_create_catalog_product(
            legacy_product_id=int(legacy_product.id) if legacy_product is not None else None,
            canonical_product_id=int(catalog_canonical.id),
            title=parsed.title,
            brand_id=brand_id,
            category_id=catalog_category_id,
        )

        processed_variant_keys: set[str] = set()
        upserted_legacy: Offer | None = None

        for variant in valid_variants:
            variant_key = self._normalize_variant_key(variant.variant_key, variant=variant)
            processed_variant_keys.add(variant_key)
            payload_price = variant.price
            payload_old_price = variant.old_price
            payload_availability = self._normalize_availability(variant.availability or parsed.availability)
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
        return IngestResult(
            status="done",
            reason=None,
            category_slug=classification.category_slug,
            confidence=classification.confidence,
            validation_errors=[],
        )

    @staticmethod
    def _quarantine_payload_hash(*, store_id: int, source_url: str | None, parsed: ParsedProduct) -> str:
        source = "||".join(
            [
                str(store_id),
                str(source_url or "").strip().lower(),
                str(parsed.product_url or "").strip().lower(),
                str(parsed.title or "").strip().lower(),
                str(parsed.price or ""),
            ]
        )
        return hashlib.sha256(source.encode("utf-8")).hexdigest()

    async def _upsert_quarantine_entry(
        self,
        *,
        store_id: int,
        source_url: str | None,
        parsed: ParsedProduct,
        classification: CategoryClassification,
        validation_errors: list[str],
    ) -> CatalogIngestQuarantine:
        payload_hash = self._quarantine_payload_hash(store_id=store_id, source_url=source_url, parsed=parsed)
        now = datetime.now(UTC)
        result = await self.session.execute(
            select(CatalogIngestQuarantine).where(
                CatalogIngestQuarantine.store_id == store_id,
                CatalogIngestQuarantine.payload_hash == payload_hash,
            )
        )
        row = result.scalar_one_or_none()
        normalized_errors = sorted({str(item).strip() for item in validation_errors if str(item).strip()})
        if row is not None:
            row.source_url = source_url
            row.product_url = parsed.product_url
            row.title_raw = parsed.title
            row.description_raw = parsed.description
            row.price_raw = str(parsed.price) if parsed.price is not None else None
            row.currency_raw = "UZS"
            row.availability_raw = parsed.availability
            row.images_raw = [str(item).strip() for item in (parsed.images or []) if str(item).strip()]
            row.specs_raw = dict(parsed.specifications or {})
            row.classifier_category = classification.category_slug
            row.classifier_confidence = Decimal(f"{max(0.0, min(1.0, float(classification.confidence))):.4f}")
            row.classifier_reason = classification.reason[:255]
            row.validation_errors = normalized_errors
            row.last_seen_at = now
            row.seen_count = int(row.seen_count or 0) + 1
            if row.status == "discarded":
                row.status = "open"
            return row

        row = CatalogIngestQuarantine(
            store_id=store_id,
            source_url=source_url,
            product_url=parsed.product_url,
            title_raw=parsed.title,
            description_raw=parsed.description,
            price_raw=str(parsed.price) if parsed.price is not None else None,
            currency_raw="UZS",
            availability_raw=parsed.availability,
            images_raw=[str(item).strip() for item in (parsed.images or []) if str(item).strip()],
            specs_raw=dict(parsed.specifications or {}),
            classifier_category=classification.category_slug,
            classifier_confidence=Decimal(f"{max(0.0, min(1.0, float(classification.confidence))):.4f}"),
            classifier_reason=classification.reason[:255],
            validation_errors=normalized_errors,
            status="open",
            first_seen_at=now,
            last_seen_at=now,
            seen_count=1,
            payload_hash=payload_hash,
        )
        self.session.add(row)
        try:
            await self.session.flush()
            return row
        except IntegrityError:
            if row in self.session:
                self.session.expunge(row)
            existing = (
                await self.session.execute(
                    select(CatalogIngestQuarantine).where(
                        CatalogIngestQuarantine.store_id == store_id,
                        CatalogIngestQuarantine.payload_hash == payload_hash,
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                raise
            existing.last_seen_at = now
            existing.seen_count = int(existing.seen_count or 0) + 1
            if existing.status == "discarded":
                existing.status = "open"
            return existing

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
        result = await self.session.execute(select(CatalogStore).where(CatalogStore.slug == slug).order_by(CatalogStore.id.asc()))
        stores = list(result.scalars().all())
        store = stores[0] if stores else None
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
            ).order_by(CatalogSeller.id.asc())
        )
        sellers = list(result.scalars().all())
        seller = sellers[0] if sellers else None
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

    async def _resolve_or_create_brand(self, *, brand_name: str) -> int | None:
        normalized_name = self._normalize_brand_name(brand_name)
        if not normalized_name:
            return None
        result = await self.session.execute(
            select(CatalogBrand).where(CatalogBrand.normalized_name == normalized_name).order_by(CatalogBrand.id.asc())
        )
        rows = list(result.scalars().all())
        brand = rows[0] if rows else None
        if brand is not None:
            if brand.name != brand_name:
                brand.name = brand_name
            return int(brand.id)
        brand = CatalogBrand(name=brand_name, normalized_name=normalized_name, aliases=[])
        self.session.add(brand)
        try:
            async with self.session.begin_nested():
                await self.session.flush()
            return int(brand.id)
        except IntegrityError:
            if brand in self.session:
                self.session.expunge(brand)
            result = await self.session.execute(
                select(CatalogBrand).where(CatalogBrand.normalized_name == normalized_name).order_by(CatalogBrand.id.asc())
            )
            rows = list(result.scalars().all())
            existing = rows[0] if rows else None
            if existing is None:
                raise
            if existing.name != brand_name:
                existing.name = brand_name
            return int(existing.id)

    async def _resolve_or_create_catalog_category(self, slug: str) -> int:
        normalized_slug = str(slug or "").strip().lower() or "phones"
        meta = self._CATEGORY_REGISTRY.get(normalized_slug) or self._CATEGORY_REGISTRY["phones"]
        result = await self.session.execute(
            select(CatalogCategory).where(CatalogCategory.slug == normalized_slug).order_by(CatalogCategory.id.asc())
        )
        rows = list(result.scalars().all())
        category = rows[0] if rows else None
        if category is not None:
            category.is_active = True
            category.name_uz = meta["name_uz"]
            category.name_ru = meta["name_ru"]
            category.name_en = meta["name_en"]
            return int(category.id)
        category = CatalogCategory(
            slug=normalized_slug,
            parent_id=None,
            name_uz=meta["name_uz"],
            name_ru=meta["name_ru"],
            name_en=meta["name_en"],
            lft=0,
            rgt=0,
            is_active=True,
        )
        self.session.add(category)
        await self.session.flush()
        return int(category.id)

    async def _resolve_or_create_catalog_canonical(
        self, *, title: str, image: str | None, specs: dict[str, str], brand_id: int | None, category_id: int
    ) -> CatalogCanonicalProduct:
        normalized_title = str(title or "").strip().lower()
        canonical: CatalogCanonicalProduct | None = await self._find_catalog_canonical_by_title_and_brand(
            normalized_title=normalized_title,
            brand_id=brand_id,
            category_id=category_id,
        )
        if canonical is not None:
            if brand_id is not None and canonical.brand_id is None:
                canonical.brand_id = brand_id
            if image and not canonical.main_image:
                canonical.main_image = image
            if specs and (not canonical.specs or canonical.specs == {}):
                canonical.specs = dict(specs)
            return canonical

        candidate = CatalogCanonicalProduct(
            normalized_title=normalized_title,
            main_image=image,
            category_id=category_id,
            brand_id=brand_id,
            specs=dict(specs or {}),
            is_active=True,
        )
        self.session.add(candidate)
        try:
            # Guard against concurrent workers inserting the same canonical row.
            async with self.session.begin_nested():
                await self.session.flush()
            canonical = candidate
        except IntegrityError:
            # Prevent repeated autoflush failures on the same transient row.
            if candidate in self.session:
                self.session.expunge(candidate)
            canonical = await self._find_catalog_canonical_by_title_and_brand(
                normalized_title=normalized_title,
                brand_id=brand_id,
                category_id=category_id,
            )
            if canonical is None:
                raise
        return canonical

    async def _find_catalog_canonical_by_title_and_brand(
        self, *, normalized_title: str, brand_id: int | None, category_id: int
    ) -> CatalogCanonicalProduct | None:
        with self.session.no_autoflush:
            if brand_id is not None:
                exact = await self.session.execute(
                    select(CatalogCanonicalProduct).where(
                        CatalogCanonicalProduct.category_id == category_id,
                        CatalogCanonicalProduct.normalized_title == normalized_title,
                        CatalogCanonicalProduct.brand_id == brand_id,
                    ).order_by(CatalogCanonicalProduct.id.asc())
                )
                exact_rows = list(exact.scalars().all())
                if exact_rows:
                    return exact_rows[0]
                neutral = await self.session.execute(
                    select(CatalogCanonicalProduct).where(
                        CatalogCanonicalProduct.category_id == category_id,
                        CatalogCanonicalProduct.normalized_title == normalized_title,
                        CatalogCanonicalProduct.brand_id.is_(None),
                    ).order_by(CatalogCanonicalProduct.id.asc())
                )
                neutral_rows = list(neutral.scalars().all())
                if neutral_rows:
                    return neutral_rows[0]

            result = await self.session.execute(
                select(CatalogCanonicalProduct).where(
                    CatalogCanonicalProduct.category_id == category_id,
                    CatalogCanonicalProduct.normalized_title == normalized_title,
                ).order_by(CatalogCanonicalProduct.id.asc())
            )
            canonicals = list(result.scalars().all())
            return canonicals[0] if canonicals else None

    async def _resolve_or_create_catalog_product(
        self,
        *,
        legacy_product_id: int | None,
        canonical_product_id: int,
        title: str,
        brand_id: int | None,
        category_id: int,
    ) -> CatalogProduct:
        product: CatalogProduct | None = None
        if legacy_product_id is not None:
            product = await self.session.get(CatalogProduct, legacy_product_id)
        if product is None:
            result = await self.session.execute(
                select(CatalogProduct).where(
                    CatalogProduct.canonical_product_id == canonical_product_id,
                    CatalogProduct.normalized_title == str(title or "").strip().lower(),
                ).order_by(CatalogProduct.id.asc())
            )
            products = list(result.scalars().all())
            product = products[0] if products else None
        if product is not None:
            product.canonical_product_id = canonical_product_id
            product.normalized_title = str(title or "").strip().lower()
            product.category_id = category_id
            if brand_id is not None and product.brand_id is None:
                product.brand_id = brand_id
            product.status = "active"
            return product

        product = CatalogProduct(
            id=legacy_product_id if legacy_product_id is not None else None,
            canonical_product_id=canonical_product_id,
            category_id=category_id,
            brand_id=brand_id,
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
            ).order_by(CatalogProductVariant.id.asc())
        )
        variants = list(result.scalars().all())
        variant = variants[0] if variants else None
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
                ).order_by(CatalogStoreProduct.id.asc())
            )
            store_products = list(result.scalars().all())
            store_product = store_products[0] if store_products else None

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
    _CATEGORY_REGISTRY: dict[str, dict[str, str]] = {
        "phones": {"name_uz": "Smartfonlar", "name_ru": "РЎРјР°СЂС‚С„РѕРЅС‹", "name_en": "Smartphones"},
        "tablets": {"name_uz": "Planshetlar", "name_ru": "РџР»Р°РЅС€РµС‚С‹", "name_en": "Tablets"},
        "laptops": {"name_uz": "Noutbuklar", "name_ru": "РќРѕСѓС‚Р±СѓРєРё", "name_en": "Laptops"},
        "watches": {"name_uz": "Soatlar", "name_ru": "РЎРјР°СЂС‚-С‡Р°СЃС‹", "name_en": "Smart Watches"},
        "tvs": {"name_uz": "Televizorlar", "name_ru": "РўРµР»РµРІРёР·РѕСЂС‹", "name_en": "TVs"},
        "headphones": {"name_uz": "Quloqchinlar", "name_ru": "РќР°СѓС€РЅРёРєРё", "name_en": "Headphones"},
        "consoles": {"name_uz": "Konsollar", "name_ru": "РРіСЂРѕРІС‹Рµ РєРѕРЅСЃРѕР»Рё", "name_en": "Consoles"},
        "appliances": {"name_uz": "Maishiy texnika", "name_ru": "Р‘С‹С‚РѕРІР°СЏ С‚РµС…РЅРёРєР°", "name_en": "Appliances"},
        "cameras": {"name_uz": "Kameralar", "name_ru": "РљР°РјРµСЂС‹", "name_en": "Cameras"},
    }

