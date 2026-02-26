"""add offer trust score fields

Revision ID: 20260226_05
Revises: 20260226_04
Create Date: 2026-02-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260226_05"
down_revision = "20260226_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("catalog_offers", sa.Column("trust_score", sa.Numeric(5, 4), nullable=True))
    op.add_column("catalog_offers", sa.Column("trust_freshness", sa.Numeric(5, 4), nullable=True))
    op.add_column("catalog_offers", sa.Column("trust_seller_rating", sa.Numeric(5, 4), nullable=True))
    op.add_column("catalog_offers", sa.Column("trust_price_anomaly", sa.Numeric(5, 4), nullable=True))
    op.add_column("catalog_offers", sa.Column("trust_stock_consistency", sa.Numeric(5, 4), nullable=True))

    op.create_check_constraint(
        "ck_catalog_offers_trust_score",
        "catalog_offers",
        "trust_score is null or (trust_score >= 0 and trust_score <= 1)",
    )
    op.create_check_constraint(
        "ck_catalog_offers_trust_freshness",
        "catalog_offers",
        "trust_freshness is null or (trust_freshness >= 0 and trust_freshness <= 1)",
    )
    op.create_check_constraint(
        "ck_catalog_offers_trust_seller_rating",
        "catalog_offers",
        "trust_seller_rating is null or (trust_seller_rating >= 0 and trust_seller_rating <= 1)",
    )
    op.create_check_constraint(
        "ck_catalog_offers_trust_price_anomaly",
        "catalog_offers",
        "trust_price_anomaly is null or (trust_price_anomaly >= 0 and trust_price_anomaly <= 1)",
    )
    op.create_check_constraint(
        "ck_catalog_offers_trust_stock_consistency",
        "catalog_offers",
        "trust_stock_consistency is null or (trust_stock_consistency >= 0 and trust_stock_consistency <= 1)",
    )

    op.create_index("ix_catalog_offers_trust_score", "catalog_offers", [sa.text("trust_score desc")])


def downgrade() -> None:
    op.drop_index("ix_catalog_offers_trust_score", table_name="catalog_offers")
    op.drop_constraint("ck_catalog_offers_trust_stock_consistency", "catalog_offers", type_="check")
    op.drop_constraint("ck_catalog_offers_trust_price_anomaly", "catalog_offers", type_="check")
    op.drop_constraint("ck_catalog_offers_trust_seller_rating", "catalog_offers", type_="check")
    op.drop_constraint("ck_catalog_offers_trust_freshness", "catalog_offers", type_="check")
    op.drop_constraint("ck_catalog_offers_trust_score", "catalog_offers", type_="check")
    op.drop_column("catalog_offers", "trust_stock_consistency")
    op.drop_column("catalog_offers", "trust_price_anomaly")
    op.drop_column("catalog_offers", "trust_seller_rating")
    op.drop_column("catalog_offers", "trust_freshness")
    op.drop_column("catalog_offers", "trust_score")

