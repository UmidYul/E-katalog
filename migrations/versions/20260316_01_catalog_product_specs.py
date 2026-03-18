"""add normalized catalog product specs table

Revision ID: 20260316_01
Revises: 20260315_02
Create Date: 2026-03-16 10:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260316_01"
down_revision = "20260315_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_product_specs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_canonical_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("spec_key", sa.String(length=128), nullable=False),
        sa.Column("spec_value", sa.String(length=512), nullable=False),
        sa.Column("spec_value_num", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("product_id", "spec_key", "spec_value", name="uq_catalog_product_specs_product_key_value"),
    )

    op.create_index(
        "ix_catalog_product_specs_product_key",
        "catalog_product_specs",
        ["product_id", "spec_key"],
    )
    op.create_index(
        "ix_catalog_product_specs_key_value",
        "catalog_product_specs",
        ["spec_key", "spec_value"],
    )
    op.create_index(
        "ix_catalog_product_specs_key_value_num",
        "catalog_product_specs",
        ["spec_key", "spec_value_num"],
    )

    op.execute(
        """
        with expanded as (
            select
                cp.id as product_id,
                lower(regexp_replace(kv.key, '[^a-zA-Z0-9]+', '_', 'g')) as raw_key,
                btrim(kv.value) as spec_value
            from catalog_canonical_products cp
            cross join lateral jsonb_each_text(cp.specs) as kv(key, value)
            where cp.specs is not null
              and jsonb_typeof(cp.specs) = 'object'
        ),
        normalized as (
            select
                product_id,
                case
                    when raw_key in ('ram', 'ram_gb') then 'ram'
                    when raw_key in ('storage', 'storage_gb', 'built_in_memory') then 'storage'
                    when raw_key = 'storage_size' then 'storage_size'
                    when raw_key in ('display_inches', 'screen_size') then 'screen_size'
                    when raw_key = 'monitor_size' then 'monitor_size'
                    when raw_key in ('refresh_rate_hz', 'screen_hz') then 'screen_hz'
                    when raw_key = 'monitor_hz' then 'monitor_hz'
                    when raw_key in ('battery', 'battery_mah') then 'battery'
                    when raw_key in ('main_camera_mp', 'camera_mp') then 'camera_mp'
                    when raw_key = 'megapixels' then 'megapixels'
                    when raw_key in ('os', 'operating_system') then 'os'
                    when raw_key in ('display_type') then 'screen_type'
                    when raw_key in ('sound_power_w') then 'sound_power'
                    when raw_key in ('charging_power_w') then 'charge_power'
                    when raw_key in ('charging_connector') then 'connector'
                    else raw_key
                end as spec_key,
                spec_value
            from expanded
            where raw_key <> ''
              and spec_value <> ''
        )
        insert into catalog_product_specs (product_id, spec_key, spec_value, spec_value_num, created_at)
        select
            product_id,
            spec_key,
            spec_value,
            nullif(replace(substring(spec_value from '(-?\\d+(?:[.,]\\d+)?)'), ',', '.'), '')::numeric(14, 4),
            now()
        from normalized
        on conflict (product_id, spec_key, spec_value) do nothing
        """
    )


def downgrade() -> None:
    op.drop_index("ix_catalog_product_specs_key_value_num", table_name="catalog_product_specs")
    op.drop_index("ix_catalog_product_specs_key_value", table_name="catalog_product_specs")
    op.drop_index("ix_catalog_product_specs_product_key", table_name="catalog_product_specs")
    op.drop_table("catalog_product_specs")
