"""canonical products and multi-seller offer mapping

Revision ID: 20260219_02
Revises: 20260219_01
Create Date: 2026-02-19
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql


revision = "20260219_02"
down_revision = "20260219_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_canonical_products",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("normalized_title", sa.String(length=512), nullable=False),
        sa.Column("main_image", sa.Text()),
        sa.Column("category_id", sa.BigInteger(), sa.ForeignKey("catalog_categories.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("brand_id", sa.BigInteger(), sa.ForeignKey("catalog_brands.id", ondelete="SET NULL")),
        sa.Column("specs", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("embedding", Vector(768)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_catalog_canonical_products_category_brand",
        "catalog_canonical_products",
        ["category_id", "brand_id"],
    )
    op.create_index("ix_catalog_canonical_products_specs", "catalog_canonical_products", ["specs"], postgresql_using="gin")
    op.execute(
        "CREATE UNIQUE INDEX uq_catalog_canonical_products_title_brand_category "
        "ON catalog_canonical_products (category_id, coalesce(brand_id, 0), lower(normalized_title))"
    )
    op.execute(
        "CREATE INDEX ix_catalog_canonical_products_title_trgm "
        "ON catalog_canonical_products USING gin (lower(normalized_title) gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX ix_catalog_canonical_products_embedding_vector "
        "ON catalog_canonical_products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 200)"
    )

    op.add_column("catalog_products", sa.Column("canonical_product_id", sa.BigInteger()))
    op.create_foreign_key(
        "fk_catalog_products_canonical_product_id",
        "catalog_products",
        "catalog_canonical_products",
        ["canonical_product_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_catalog_products_canonical_product_id", "catalog_products", ["canonical_product_id"])

    op.add_column("catalog_store_products", sa.Column("canonical_product_id", sa.BigInteger()))
    op.create_foreign_key(
        "fk_catalog_store_products_canonical_product_id",
        "catalog_store_products",
        "catalog_canonical_products",
        ["canonical_product_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_catalog_store_products_canonical_product_id", "catalog_store_products", ["canonical_product_id"])

    op.create_table(
        "catalog_sellers",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("store_id", sa.BigInteger(), sa.ForeignKey("catalog_stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("rating", sa.Numeric(3, 2)),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("store_id", "normalized_name", name="uq_catalog_sellers_store_normalized_name"),
    )
    op.create_index("ix_catalog_sellers_store_id", "catalog_sellers", ["store_id"])
    op.create_index("ix_catalog_sellers_normalized_name", "catalog_sellers", ["normalized_name"])

    op.add_column("catalog_offers", sa.Column("canonical_product_id", sa.BigInteger(), nullable=True))
    op.add_column("catalog_offers", sa.Column("store_id", sa.BigInteger(), nullable=True))
    op.add_column("catalog_offers", sa.Column("seller_id", sa.BigInteger(), nullable=True))
    op.add_column("catalog_offers", sa.Column("offer_url", sa.Text()))
    op.add_column("catalog_offers", sa.Column("delivery_days", sa.Integer()))

    op.create_foreign_key(
        "fk_catalog_offers_canonical_product_id",
        "catalog_offers",
        "catalog_canonical_products",
        ["canonical_product_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_catalog_offers_store_id",
        "catalog_offers",
        "catalog_stores",
        ["store_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_catalog_offers_seller_id",
        "catalog_offers",
        "catalog_sellers",
        ["seller_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_catalog_offers_canonical_product_id", "catalog_offers", ["canonical_product_id"])
    op.create_index("ix_catalog_offers_store_id", "catalog_offers", ["store_id"])
    op.create_index("ix_catalog_offers_seller_id", "catalog_offers", ["seller_id"])

    op.execute(
        """
        insert into catalog_canonical_products (id, normalized_title, main_image, category_id, brand_id, specs, created_at, updated_at)
        select
            p.id,
            p.normalized_title,
            (
                select sp.image_url
                from catalog_store_products sp
                where sp.product_id = p.id and sp.image_url is not null and sp.image_url <> ''
                order by sp.last_seen_at desc, sp.id desc
                limit 1
            ) as main_image,
            p.category_id,
            p.brand_id,
            p.specs,
            p.created_at,
            p.updated_at
        from catalog_products p
        on conflict (id) do nothing
        """
    )

    op.execute("update catalog_products set canonical_product_id = id where canonical_product_id is null")
    op.execute(
        """
        update catalog_store_products sp
        set canonical_product_id = p.canonical_product_id
        from catalog_products p
        where p.id = sp.product_id
          and sp.canonical_product_id is null
        """
    )

    op.execute(
        """
        insert into catalog_sellers (store_id, name, normalized_name, metadata)
        select distinct
            sp.store_id,
            coalesce(nullif(sp.metadata->>'seller_name', ''), s.name) as name,
            lower(regexp_replace(coalesce(nullif(sp.metadata->>'seller_name', ''), s.name), '[^a-zA-Z0-9а-яА-Я]+', ' ', 'g')) as normalized_name,
            jsonb_build_object('source', 'bootstrap')
        from catalog_store_products sp
        join catalog_stores s on s.id = sp.store_id
        on conflict (store_id, normalized_name) do update
        set name = excluded.name
        """
    )

    op.execute(
        """
        update catalog_offers o
        set
            canonical_product_id = sp.canonical_product_id,
            store_id = sp.store_id,
            offer_url = sp.external_url,
            seller_id = cs.id,
            delivery_days = nullif(regexp_replace(coalesce(sp.metadata->>'delivery_days', ''), '[^0-9]', '', 'g'), '')::int
        from catalog_store_products sp
        left join catalog_stores s on s.id = sp.store_id
        left join catalog_sellers cs
            on cs.store_id = sp.store_id
           and cs.normalized_name = lower(regexp_replace(coalesce(nullif(sp.metadata->>'seller_name', ''), s.name), '[^a-zA-Z0-9а-яА-Я]+', ' ', 'g'))
        where sp.id = o.store_product_id
        """
    )

    op.alter_column("catalog_offers", "canonical_product_id", nullable=False)
    op.alter_column("catalog_offers", "store_id", nullable=False)

    op.drop_constraint("catalog_product_search_product_id_fkey", "catalog_product_search", type_="foreignkey")
    op.create_foreign_key(
        "catalog_product_search_product_id_fkey",
        "catalog_product_search",
        "catalog_canonical_products",
        ["product_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("catalog_duplicate_candidates_product_id_a_fkey", "catalog_duplicate_candidates", type_="foreignkey")
    op.drop_constraint("catalog_duplicate_candidates_product_id_b_fkey", "catalog_duplicate_candidates", type_="foreignkey")
    op.create_foreign_key(
        "catalog_duplicate_candidates_product_id_a_fkey",
        "catalog_duplicate_candidates",
        "catalog_canonical_products",
        ["product_id_a"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "catalog_duplicate_candidates_product_id_b_fkey",
        "catalog_duplicate_candidates",
        "catalog_canonical_products",
        ["product_id_b"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("catalog_ai_enrichment_jobs_product_id_fkey", "catalog_ai_enrichment_jobs", type_="foreignkey")
    op.create_foreign_key(
        "catalog_ai_enrichment_jobs_product_id_fkey",
        "catalog_ai_enrichment_jobs",
        "catalog_canonical_products",
        ["product_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("catalog_ai_enrichment_jobs_product_id_fkey", "catalog_ai_enrichment_jobs", type_="foreignkey")
    op.create_foreign_key(
        "catalog_ai_enrichment_jobs_product_id_fkey",
        "catalog_ai_enrichment_jobs",
        "catalog_products",
        ["product_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("catalog_duplicate_candidates_product_id_b_fkey", "catalog_duplicate_candidates", type_="foreignkey")
    op.drop_constraint("catalog_duplicate_candidates_product_id_a_fkey", "catalog_duplicate_candidates", type_="foreignkey")
    op.create_foreign_key(
        "catalog_duplicate_candidates_product_id_a_fkey",
        "catalog_duplicate_candidates",
        "catalog_products",
        ["product_id_a"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "catalog_duplicate_candidates_product_id_b_fkey",
        "catalog_duplicate_candidates",
        "catalog_products",
        ["product_id_b"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("catalog_product_search_product_id_fkey", "catalog_product_search", type_="foreignkey")
    op.create_foreign_key(
        "catalog_product_search_product_id_fkey",
        "catalog_product_search",
        "catalog_products",
        ["product_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_index("ix_catalog_offers_seller_id", table_name="catalog_offers")
    op.drop_index("ix_catalog_offers_store_id", table_name="catalog_offers")
    op.drop_index("ix_catalog_offers_canonical_product_id", table_name="catalog_offers")
    op.drop_constraint("fk_catalog_offers_seller_id", "catalog_offers", type_="foreignkey")
    op.drop_constraint("fk_catalog_offers_store_id", "catalog_offers", type_="foreignkey")
    op.drop_constraint("fk_catalog_offers_canonical_product_id", "catalog_offers", type_="foreignkey")
    op.drop_column("catalog_offers", "delivery_days")
    op.drop_column("catalog_offers", "offer_url")
    op.drop_column("catalog_offers", "seller_id")
    op.drop_column("catalog_offers", "store_id")
    op.drop_column("catalog_offers", "canonical_product_id")

    op.drop_index("ix_catalog_sellers_normalized_name", table_name="catalog_sellers")
    op.drop_index("ix_catalog_sellers_store_id", table_name="catalog_sellers")
    op.drop_table("catalog_sellers")

    op.drop_index("ix_catalog_store_products_canonical_product_id", table_name="catalog_store_products")
    op.drop_constraint("fk_catalog_store_products_canonical_product_id", "catalog_store_products", type_="foreignkey")
    op.drop_column("catalog_store_products", "canonical_product_id")

    op.drop_index("ix_catalog_products_canonical_product_id", table_name="catalog_products")
    op.drop_constraint("fk_catalog_products_canonical_product_id", "catalog_products", type_="foreignkey")
    op.drop_column("catalog_products", "canonical_product_id")

    op.execute("drop index if exists ix_catalog_canonical_products_embedding_vector")
    op.execute("drop index if exists ix_catalog_canonical_products_title_trgm")
    op.execute("drop index if exists uq_catalog_canonical_products_title_brand_category")
    op.drop_index("ix_catalog_canonical_products_specs", table_name="catalog_canonical_products")
    op.drop_index("ix_catalog_canonical_products_category_brand", table_name="catalog_canonical_products")
    op.drop_table("catalog_canonical_products")
