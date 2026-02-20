from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Offer, PriceHistory, Product, Shop
from app.parsers.base import ParsedProduct


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
        result = await self.session.execute(select(Offer).where(Offer.shop_id == shop.id, Offer.link == parsed.product_url))
        offer = result.scalar_one_or_none()

        if offer:
            if offer.price != parsed.price:
                self.session.add(PriceHistory(offer_id=offer.id, price=parsed.price))
            offer.price = parsed.price
            offer.old_price = parsed.old_price
            offer.availability = parsed.availability
            offer.images = parsed.images
            offer.specifications = parsed.specifications
            return offer

        product = Product(
            title=parsed.title,
            description=parsed.description,
            category_id=category_id,
            metadata_json={"source_url": parsed.product_url},
        )
        self.session.add(product)
        await self.session.flush()

        offer = Offer(
            product_id=product.id,
            shop_id=shop.id,
            price=parsed.price,
            old_price=parsed.old_price,
            availability=parsed.availability,
            link=parsed.product_url,
            images=parsed.images,
            specifications=parsed.specifications,
        )
        self.session.add(offer)
        await self.session.flush()
        self.session.add(PriceHistory(offer_id=offer.id, price=parsed.price))
        return offer
