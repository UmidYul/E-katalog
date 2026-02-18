from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    products: Mapped[list[Product]] = relationship(back_populates="category")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    normalized_name: Mapped[str | None] = mapped_column(String(500))
    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    category: Mapped[Category | None] = relationship(back_populates="products")
    offers: Mapped[list[Offer]] = relationship(back_populates="product", cascade="all,delete-orphan")


class Shop(Base):
    __tablename__ = "shops"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    offers: Mapped[list[Offer]] = relationship(back_populates="shop", cascade="all,delete-orphan")


class Offer(Base):
    __tablename__ = "offers"
    __table_args__ = (UniqueConstraint("shop_id", "link", name="uq_offer_shop_link"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    old_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    availability: Mapped[str] = mapped_column(String(255), nullable=False, default="unknown")
    link: Mapped[str] = mapped_column(String(1000), nullable=False)
    images: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    specifications: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    product: Mapped[Product] = relationship(back_populates="offers")
    shop: Mapped[Shop] = relationship(back_populates="offers")
    price_history: Mapped[list[PriceHistory]] = relationship(back_populates="offer", cascade="all,delete-orphan")


class PriceHistory(Base):
    __tablename__ = "price_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    offer_id: Mapped[int] = mapped_column(ForeignKey("offers.id", ondelete="CASCADE"), nullable=False, index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    offer: Mapped[Offer] = relationship(back_populates="price_history")
