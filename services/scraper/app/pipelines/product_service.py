from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Offer, PriceHistory, Product, Shop
from app.parsers.base import ParsedProduct, ParsedVariant
from app.utils.variants import build_variant_key


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

    async def get_or_create_shop(self, name: str, url: str) -> Shop:
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

    async def upsert_offer(self, parsed: ParsedProduct, shop: Shop, category_id: int | None = None) -> Offer:
        variants = self._iter_variants(parsed)
        product = await self._resolve_or_create_product(parsed=parsed, shop_id=shop.id, category_id=category_id)
        processed_variant_keys: set[str] = set()

        upserted: Offer | None = None
        for variant in variants:
            variant_key = self._normalize_variant_key(variant.variant_key, variant=variant)
            processed_variant_keys.add(variant_key)
            payload_price = variant.price
            payload_old_price = variant.old_price
            payload_availability = variant.availability
            payload_images = variant.images or parsed.images
            payload_specs = self._merge_specifications(parsed.specifications, variant.specifications)
            payload_attrs = self._variant_attrs(variant, payload_specs)
            result = await self.session.execute(
                select(Offer)
                .where(
                    Offer.shop_id == shop.id,
                    Offer.link == parsed.product_url,
                    Offer.variant_key == variant_key,
                )
                .order_by(Offer.id.asc())
            )
            existing_offers = list(result.scalars().all())
            offer = existing_offers[0] if existing_offers else None
            duplicate_offers = existing_offers[1:]

            if offer:
                if offer.price != payload_price:
                    self.session.add(PriceHistory(offer_id=offer.id, price=payload_price))
                offer.price = payload_price
                offer.old_price = payload_old_price
                offer.availability = payload_availability
                offer.images = payload_images
                offer.specifications = payload_specs
                offer.variant_attrs = payload_attrs
                for duplicate in duplicate_offers:
                    await self.session.delete(duplicate)
                upserted = upserted or offer
                continue

            offer = Offer(
                product_id=product.id,
                shop_id=shop.id,
                price=payload_price,
                old_price=payload_old_price,
                availability=payload_availability,
                link=parsed.product_url,
                variant_key=variant_key,
                variant_attrs=payload_attrs,
                images=payload_images,
                specifications=payload_specs,
            )
            self.session.add(offer)
            await self.session.flush()
            self.session.add(PriceHistory(offer_id=offer.id, price=payload_price))
            upserted = upserted or offer

        # Alifshop had legacy noisy synthetic variant keys; clean stale rows per URL on successful upsert.
        if "alif" in shop.name.lower() and processed_variant_keys:
            stale_result = await self.session.execute(
                select(Offer).where(
                    Offer.shop_id == shop.id,
                    Offer.link == parsed.product_url,
                    Offer.variant_key.notin_(processed_variant_keys),
                )
            )
            for stale_offer in stale_result.scalars().all():
                await self.session.delete(stale_offer)

        if upserted is None:
            raise ValueError("no variants to persist")
        return upserted

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
    def _normalize_variant_key(raw_key: str | None, *, variant: ParsedVariant) -> str:
        key = str(raw_key or "").strip()
        if key:
            return key
        return build_variant_key(variant.color, variant.storage, variant.ram)

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
