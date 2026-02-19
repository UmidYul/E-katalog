from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


SYNC_SQL_STATEMENTS = [
    """
    insert into catalog_categories (id, parent_id, slug, name_uz, name_ru, name_en, lft, rgt, is_active)
    values (1, null, 'phones', 'Smartfonlar', 'Смартфоны', 'Smartphones', 1, 2, true)
    on conflict (id) do update set is_active = true
    """,
    """
    insert into catalog_stores (id, slug, name, country_code, is_active, trust_score, crawl_priority)
    select
      s.id,
      regexp_replace(lower(s.name), '[^a-z0-9]+', '-', 'g'),
      s.name,
      'UZ',
      true,
      0.80,
      100
    from shops s
    on conflict (id) do update
    set name = excluded.name,
        slug = excluded.slug,
        is_active = true
    """,
    """
    insert into catalog_canonical_products (id, normalized_title, main_image, category_id, brand_id, specs)
    select
      p.id,
      lower(p.title),
      (
        select nullif(o2.images->>0, '')
        from offers o2
        where o2.product_id = p.id
        order by o2.id desc
        limit 1
      ),
      1,
      null,
      '{}'::jsonb
    from products p
    on conflict (id) do update
    set normalized_title = excluded.normalized_title,
        main_image = coalesce(excluded.main_image, catalog_canonical_products.main_image)
    """,
    """
    insert into catalog_products (id, canonical_product_id, category_id, brand_id, normalized_title, attributes, specs, status)
    select
      p.id,
      p.id,
      1,
      null,
      lower(p.title),
      '{}'::jsonb,
      '{}'::jsonb,
      'active'
    from products p
    on conflict (id) do update
    set canonical_product_id = excluded.canonical_product_id,
        normalized_title = excluded.normalized_title,
        status = 'active'
    """,
    """
    insert into catalog_store_products (
      id, store_id, canonical_product_id, product_id, external_id, external_url, title_raw, title_clean,
      image_url, availability, metadata, last_seen_at
    )
    select
      o.id,
      o.shop_id,
      p.id,
      o.product_id,
      o.id::text,
      o.link,
      p.title,
      lower(p.title),
      nullif(o.images->>0, ''),
      coalesce(o.availability, 'unknown'),
      jsonb_build_object(
        'images', coalesce(o.images, '[]'::jsonb),
        'specifications', coalesce(o.specifications, '{}'::jsonb)
      ),
      now()
    from offers o
    join products p on p.id = o.product_id
    on conflict (id) do update
    set store_id = excluded.store_id,
        canonical_product_id = excluded.canonical_product_id,
        product_id = excluded.product_id,
        external_url = excluded.external_url,
        title_raw = excluded.title_raw,
        title_clean = excluded.title_clean,
        image_url = excluded.image_url,
        availability = excluded.availability,
        metadata = excluded.metadata,
        last_seen_at = excluded.last_seen_at
    """,
    """
    insert into catalog_sellers (store_id, name, normalized_name, metadata)
    select distinct
      o.shop_id,
      s.name,
      lower(regexp_replace(s.name, '[^a-zA-Z0-9а-яА-Я]+', ' ', 'g')),
      jsonb_build_object('source', 'legacy-sync')
    from offers o
    join shops s on s.id = o.shop_id
    on conflict (store_id, normalized_name) do update
    set name = excluded.name
    """,
    """
    insert into catalog_offers (
      id, canonical_product_id, store_id, seller_id, store_product_id, product_variant_id, offer_url, currency,
      price_amount, old_price_amount, in_stock, delivery_days, shipping_cost, scraped_at, is_valid
    )
    select
      o.id,
      p.id,
      o.shop_id,
      cs.id,
      o.id,
      null,
      o.link,
      'UZS',
      o.price,
      o.old_price,
      (coalesce(o.availability, '') not in ('out_of_stock', 'нет', 'no')),
      null,
      0,
      now(),
      true
    from offers o
    join products p on p.id = o.product_id
    join shops s on s.id = o.shop_id
    left join catalog_sellers cs
      on cs.store_id = o.shop_id
     and cs.normalized_name = lower(regexp_replace(s.name, '[^a-zA-Z0-9а-яА-Я]+', ' ', 'g'))
    on conflict (id) do update
    set canonical_product_id = excluded.canonical_product_id,
        store_id = excluded.store_id,
        seller_id = excluded.seller_id,
        offer_url = excluded.offer_url,
        price_amount = excluded.price_amount,
        old_price_amount = excluded.old_price_amount,
        in_stock = excluded.in_stock,
        scraped_at = excluded.scraped_at,
        is_valid = true
    """,
    """
    insert into catalog_product_search (product_id, tsv, min_price, max_price, store_count, updated_at)
    select
      cp.id,
      to_tsvector('simple', lower(cp.normalized_title)),
      min(o.price_amount),
      max(o.price_amount),
      count(distinct o.store_id),
      now()
    from catalog_canonical_products cp
    left join catalog_offers o on o.canonical_product_id = cp.id and o.is_valid = true
    group by cp.id, cp.normalized_title
    on conflict (product_id) do update
    set tsv = excluded.tsv,
        min_price = excluded.min_price,
        max_price = excluded.max_price,
        store_count = excluded.store_count,
        updated_at = excluded.updated_at
    """,
]


async def sync_legacy_to_catalog(session: AsyncSession) -> None:
    for statement in SYNC_SQL_STATEMENTS:
        await session.execute(text(statement))
    await session.commit()
