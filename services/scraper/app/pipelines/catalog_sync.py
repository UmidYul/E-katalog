from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


STORE_SLUG_EXPR = "regexp_replace(regexp_replace(lower(s.name), '[^a-z0-9]+', '-', 'g'), '-uz$', '')"
VARIANT_KEY_EXPR = (
    "case "
    "when nullif(btrim(o.variant_key), '') is null then 'default' "
    "when char_length(btrim(o.variant_key)) <= 64 then btrim(o.variant_key) "
    "else 'vk_' || substr(md5(btrim(o.variant_key)), 1, 61) "
    "end"
)


SYNC_SQL_STATEMENTS = [
    """
    insert into catalog_categories (id, parent_id, slug, name_uz, name_ru, name_en, lft, rgt, is_active)
    values (1, null, 'phones', 'Smartfonlar', 'РЎРјР°СЂС‚С„РѕРЅС‹', 'Smartphones', 1, 2, true)
    on conflict (id) do update set is_active = true
    """,
    """
    insert into catalog_stores (slug, name, provider, country_code, is_active, trust_score, crawl_priority)
    select
      __STORE_SLUG_EXPR__,
      s.name,
      case
        when __STORE_SLUG_EXPR__ = 'mediapark' then 'mediapark'
        when __STORE_SLUG_EXPR__ = 'texnomart' then 'texnomart'
        when __STORE_SLUG_EXPR__ = 'alifshop' then 'alifshop'
        else 'generic'
      end,
      'UZ',
      true,
      0.80,
      100
    from shops s
    on conflict (slug) do update
    set name = excluded.name,
        provider = excluded.provider,
        is_active = true
    """,
    """
    insert into catalog_canonical_products (normalized_title, main_image, category_id, brand_id, specs)
    select
      lower(p.title),
      (
        select nullif(img.value, '')
        from offers o2
        join lateral jsonb_array_elements_text(coalesce(o2.images, '[]'::jsonb)) as img(value) on true
        where o2.product_id = p.id
          and nullif(img.value, '') is not null
          and img.value !~* '(logo|icon|shopping-card|cart|basket|sprite|telegram|whatsapp)'
          and img.value ~* '[.](jpg|jpeg|png|webp|avif)([?]|$)'
        order by o2.id desc
        limit 1
      ),
      1,
      null,
      coalesce(
        (
          select o3.specifications
          from offers o3
          where o3.product_id = p.id
            and coalesce(o3.specifications, '{}'::jsonb) <> '{}'::jsonb
          order by (select count(*) from jsonb_each(o3.specifications)) desc, o3.id desc
          limit 1
        ),
        '{}'::jsonb
      )
    from products p
    on conflict do nothing
    """,
    """
    update catalog_canonical_products cp
    set main_image = src.main_image
    from (
      select distinct on (lower(p.title))
        lower(p.title) as normalized_title,
        (
          select nullif(img.value, '')
          from offers o2
          join lateral jsonb_array_elements_text(coalesce(o2.images, '[]'::jsonb)) as img(value) on true
          where o2.product_id = p.id
            and nullif(img.value, '') is not null
            and img.value !~* '(logo|icon|shopping-card|cart|basket|sprite|telegram|whatsapp)'
            and img.value ~* '[.](jpg|jpeg|png|webp|avif)([?]|$)'
          order by o2.id desc
          limit 1
        ) as main_image
      from products p
      order by lower(p.title), p.id desc
    ) src
    where cp.category_id = 1
      and lower(cp.normalized_title) = src.normalized_title
      and src.main_image is not null
      and (
        cp.main_image is null
        or cp.main_image !~* '[.](jpg|jpeg|png|webp|avif)([?]|$)'
        or cp.main_image ~* '(logo|icon|shopping-card|cart|basket|sprite|telegram|whatsapp)'
      )
    """,
    """
    update catalog_canonical_products cp
    set specs = src.specs
    from (
      select
        lower(p.title) as normalized_title,
        coalesce(
          (
            select o3.specifications
            from offers o3
            where o3.product_id = p.id
              and coalesce(o3.specifications, '{}'::jsonb) <> '{}'::jsonb
            order by (select count(*) from jsonb_each(o3.specifications)) desc, o3.id desc
            limit 1
          ),
          '{}'::jsonb
        ) as specs
      from products p
    ) src
    where cp.category_id = 1
      and lower(cp.normalized_title) = src.normalized_title
      and coalesce(cp.specs, '{}'::jsonb) = '{}'::jsonb
      and src.specs <> '{}'::jsonb
    """,
    """
    insert into catalog_products (id, canonical_product_id, category_id, brand_id, normalized_title, attributes, specs, status)
    select
      p.id,
      cp.id,
      1,
      null,
      lower(p.title),
      '{}'::jsonb,
      '{}'::jsonb,
      'active'
    from products p
    join lateral (
      select coalesce(cp.merged_into_id, cp.id) as id
      from catalog_canonical_products cp
      where cp.category_id = 1
        and lower(cp.normalized_title) = lower(p.title)
      order by cp.is_active desc, cp.id asc
      limit 1
    ) cp on true
    on conflict (id) do update
    set canonical_product_id = excluded.canonical_product_id,
        normalized_title = excluded.normalized_title,
        status = 'active'
    """,
    """
    insert into catalog_product_variants (product_id, variant_key, color, storage, ram, other_attrs)
    select distinct
      p.id,
      __VARIANT_KEY_EXPR__,
      nullif(left(regexp_replace(coalesce(o.variant_attrs->>'color', o.specifications->>'color', ''), '\\s+', ' ', 'g'), 64), ''),
      nullif(left(regexp_replace(coalesce(o.variant_attrs->>'storage', o.specifications->>'storage_gb', o.specifications->>'storage', ''), '\\s+', ' ', 'g'), 64), ''),
      nullif(left(regexp_replace(coalesce(o.variant_attrs->>'ram', o.specifications->>'ram_gb', o.specifications->>'ram', ''), '\\s+', ' ', 'g'), 64), ''),
      coalesce(o.variant_attrs, '{}'::jsonb)
    from offers o
    join products p on p.id = o.product_id
    on conflict (product_id, variant_key) do update
    set color = coalesce(excluded.color, catalog_product_variants.color),
        storage = coalesce(excluded.storage, catalog_product_variants.storage),
        ram = coalesce(excluded.ram, catalog_product_variants.ram),
        other_attrs = case
          when coalesce(excluded.other_attrs, '{}'::jsonb) = '{}'::jsonb then catalog_product_variants.other_attrs
          else excluded.other_attrs
        end
    """,
    """
    insert into catalog_store_products (
      id, store_id, canonical_product_id, product_id, external_id, external_url, title_raw, title_clean,
      image_url, availability, metadata, last_seen_at
    )
    select
      o.id,
      cs.id,
      cp.id,
      o.product_id,
      o.id::text,
      o.link,
      p.title,
      lower(p.title),
      (
        select nullif(img.value, '')
        from jsonb_array_elements_text(coalesce(o.images, '[]'::jsonb)) as img(value)
        where nullif(img.value, '') is not null
          and img.value !~* '(logo|icon|shopping-card|cart|basket|sprite|telegram|whatsapp)'
          and img.value ~* '[.](jpg|jpeg|png|webp|avif)([?]|$)'
        limit 1
      ),
      coalesce(o.availability, 'unknown'),
      jsonb_build_object(
        'images', coalesce(o.images, '[]'::jsonb),
        'specifications', coalesce(o.specifications, '{}'::jsonb),
        'variant_key', __VARIANT_KEY_EXPR__,
        'variant_attrs', coalesce(o.variant_attrs, '{}'::jsonb)
      ),
      now()
    from offers o
    join products p on p.id = o.product_id
    join shops s on s.id = o.shop_id
    join catalog_stores cs on cs.slug = __STORE_SLUG_EXPR__
    join lateral (
      select coalesce(cp.merged_into_id, cp.id) as id
      from catalog_canonical_products cp
      where cp.category_id = 1
        and lower(cp.normalized_title) = lower(p.title)
      order by cp.is_active desc, cp.id asc
      limit 1
    ) cp on true
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
      cs.id,
      s.name,
      lower(regexp_replace(s.name, '[^a-zA-Z0-9]+', ' ', 'g')),
      jsonb_build_object('source', 'legacy-sync')
    from offers o
    join shops s on s.id = o.shop_id
    join catalog_stores cs on cs.slug = __STORE_SLUG_EXPR__
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
      cp.id,
      cs_store.id,
      cs.id,
      o.id,
      pv.id,
      o.link,
      'UZS',
      o.price,
      o.old_price,
      (coalesce(o.availability, '') not in ('out_of_stock', 'РЅРµС‚', 'no')),
      null,
      0,
      now(),
      true
    from offers o
    join products p on p.id = o.product_id
    join lateral (
      select coalesce(cp.merged_into_id, cp.id) as id
      from catalog_canonical_products cp
      where cp.category_id = 1
        and lower(cp.normalized_title) = lower(p.title)
      order by cp.is_active desc, cp.id asc
      limit 1
    ) cp on true
    join shops s on s.id = o.shop_id
    join catalog_stores cs_store on cs_store.slug = __STORE_SLUG_EXPR__
    left join catalog_product_variants pv
      on pv.product_id = o.product_id
     and pv.variant_key = __VARIANT_KEY_EXPR__
    left join catalog_sellers cs
      on cs.store_id = cs_store.id
     and cs.normalized_name = lower(regexp_replace(s.name, '[^a-zA-Z0-9]+', ' ', 'g'))
    on conflict (id) do update
    set canonical_product_id = excluded.canonical_product_id,
        store_id = excluded.store_id,
        seller_id = excluded.seller_id,
        product_variant_id = excluded.product_variant_id,
        offer_url = excluded.offer_url,
        price_amount = excluded.price_amount,
        old_price_amount = excluded.old_price_amount,
        in_stock = excluded.in_stock,
        scraped_at = excluded.scraped_at,
        is_valid = true
    """,
    """
    update catalog_store_products sp
    set canonical_product_id = cp.merged_into_id
    from catalog_canonical_products cp
    where sp.canonical_product_id = cp.id
      and cp.is_active = false
      and cp.merged_into_id is not null
      and sp.canonical_product_id is distinct from cp.merged_into_id
    """,
    """
    update catalog_offers o
    set canonical_product_id = cp.merged_into_id
    from catalog_canonical_products cp
    where o.canonical_product_id = cp.id
      and cp.is_active = false
      and cp.merged_into_id is not null
      and o.canonical_product_id is distinct from cp.merged_into_id
    """,
    """
    update catalog_products p
    set canonical_product_id = cp.merged_into_id
    from catalog_canonical_products cp
    where p.canonical_product_id = cp.id
      and cp.is_active = false
      and cp.merged_into_id is not null
      and p.canonical_product_id is distinct from cp.merged_into_id
    """,
    """
    insert into catalog_price_history (offer_id, price_amount, in_stock, captured_at)
    select
      ph.offer_id,
      ph.price,
      (coalesce(o.availability, '') not in ('out_of_stock', 'РЅРµС‚', 'no')),
      ph.created_at
    from price_history ph
    join offers o on o.id = ph.offer_id
    join catalog_offers co on co.id = ph.offer_id
    where not exists (
      select 1
      from catalog_price_history cph
      where cph.offer_id = ph.offer_id
        and cph.captured_at = ph.created_at
        and cph.price_amount = ph.price
        and cph.in_stock = (coalesce(o.availability, '') not in ('out_of_stock', 'РЅРµС‚', 'no'))
    )
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
    """
    with brand_candidates as (
      select
        cp.id as canonical_id,
        cp.category_id,
        cp.normalized_title,
        case
          when src ~ '(^|[^a-z0-9])(apple|iphone)([^a-z0-9]|$)' then 'Apple'
          when src ~ '(^|[^a-z0-9])(samsung|galaxy)([^a-z0-9]|$)' then 'Samsung'
          when src ~ '(^|[^a-z0-9])(xiaomi|redmi|poco)([^a-z0-9]|$)' then 'Xiaomi'
          when src ~ '(^|[^a-z0-9])(huawei)([^a-z0-9]|$)' then 'Huawei'
          when src ~ '(^|[^a-z0-9])(honor)([^a-z0-9]|$)' then 'Honor'
          when src ~ '(^|[^a-z0-9])(google|pixel)([^a-z0-9]|$)' then 'Google'
          when src ~ '(^|[^a-z0-9])(oneplus|one\\s*plus)([^a-z0-9]|$)' then 'OnePlus'
          when src ~ '(^|[^a-z0-9])(nothing)([^a-z0-9]|$)' then 'Nothing'
          else null
        end as brand_name
      from (
        select
          cp.id,
          cp.category_id,
          cp.normalized_title,
          lower(
            coalesce(cp.normalized_title, '')
            || ' '
            || coalesce(cp.specs->>'brand', '')
            || ' '
            || coalesce(cp.specs->>'manufacturer', '')
            || ' '
            || coalesce(cp.specs->>'vendor', '')
          ) as src
        from catalog_canonical_products cp
        where cp.brand_id is null
      ) cp
    ),
    ensured_brands as (
      insert into catalog_brands (name, normalized_name, aliases)
      select distinct
        brand_name,
        lower(brand_name),
        '[]'::jsonb
      from brand_candidates
      where brand_name is not null
      on conflict (name) do update
      set normalized_name = excluded.normalized_name
      returning id, name
    ),
    ranked_brand_candidates as (
      select
        bc.canonical_id,
        bc.category_id,
        bc.normalized_title,
        bc.brand_name,
        row_number() over (
          partition by bc.category_id, bc.brand_name, lower(bc.normalized_title)
          order by bc.canonical_id
        ) as rank_in_group
      from brand_candidates bc
      where bc.brand_name is not null
    )
    update catalog_canonical_products cp
    set brand_id = b.id
    from ranked_brand_candidates bc
    left join ensured_brands eb on eb.name = bc.brand_name
    join catalog_brands b on b.name = bc.brand_name
    where cp.id = bc.canonical_id
      and bc.rank_in_group = 1
      and cp.brand_id is null
      and not exists (
        select 1
        from catalog_canonical_products cp_existing
        where cp_existing.id <> cp.id
          and cp_existing.is_active = true
          and cp_existing.category_id = cp.category_id
          and cp_existing.brand_id = b.id
          and lower(cp_existing.normalized_title) = lower(cp.normalized_title)
      )
    """,
    """
    update catalog_products p
    set brand_id = cp.brand_id
    from catalog_canonical_products cp
    where p.canonical_product_id = cp.id
      and cp.brand_id is not null
      and p.brand_id is distinct from cp.brand_id
    """,
]


async def sync_legacy_to_catalog(session: AsyncSession) -> None:
    for statement in SYNC_SQL_STATEMENTS:
        sql = statement.replace("__STORE_SLUG_EXPR__", STORE_SLUG_EXPR).replace("__VARIANT_KEY_EXPR__", VARIANT_KEY_EXPR)
        await session.execute(text(sql))
    await session.commit()
