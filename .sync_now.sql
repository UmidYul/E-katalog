insert into catalog_categories (id, parent_id, slug, name_uz, name_ru, name_en, lft, rgt, is_active)
values (1, null, 'phones', 'Smartfonlar', 'Смартфоны', 'Smartphones', 1, 2, true)
on conflict (id) do update set is_active = true;

insert into catalog_stores (id, slug, name, country_code, is_active, trust_score, crawl_priority)
select s.id, regexp_replace(lower(s.name), '[^a-z0-9]+', '-', 'g'), s.name, 'UZ', true, 0.80, 100
from shops s
on conflict (id) do update set name = excluded.name, slug = excluded.slug, is_active = true;

insert into catalog_products (id, category_id, brand_id, normalized_title, attributes, specs, status)
select p.id, 1, null, lower(p.title), '{}'::jsonb, '{}'::jsonb, 'active'
from products p
on conflict (id) do update set normalized_title = excluded.normalized_title, status = 'active';

insert into catalog_store_products (id, store_id, product_id, external_id, external_url, title_raw, title_clean, image_url, availability, metadata, last_seen_at)
select o.id, o.shop_id, o.product_id, o.id::text, o.link, p.title, lower(p.title), nullif(o.images->>0,''), coalesce(o.availability,'unknown'), jsonb_build_object('images', coalesce(o.images,'[]'::jsonb), 'specifications', coalesce(o.specifications,'{}'::jsonb)), now()
from offers o join products p on p.id = o.product_id
on conflict (id) do update set store_id=excluded.store_id, product_id=excluded.product_id, external_url=excluded.external_url, title_raw=excluded.title_raw, title_clean=excluded.title_clean, image_url=excluded.image_url, availability=excluded.availability, metadata=excluded.metadata, last_seen_at=excluded.last_seen_at;

insert into catalog_offers (id, store_product_id, product_variant_id, currency, price_amount, old_price_amount, in_stock, shipping_cost, scraped_at, is_valid)
select o.id, o.id, null, 'UZS', o.price, o.old_price, (coalesce(o.availability,'') not in ('out_of_stock','нет','no')), 0, now(), true
from offers o
on conflict (id) do update set price_amount=excluded.price_amount, old_price_amount=excluded.old_price_amount, in_stock=excluded.in_stock, scraped_at=excluded.scraped_at, is_valid=true;

insert into catalog_product_search (product_id, tsv, min_price, max_price, store_count, updated_at)
select p.id, to_tsvector('simple', lower(p.title)), min(o.price), max(o.price), count(distinct o.shop_id), now()
from products p join offers o on o.product_id = p.id
group by p.id, p.title
on conflict (product_id) do update set tsv=excluded.tsv, min_price=excluded.min_price, max_price=excluded.max_price, store_count=excluded.store_count, updated_at=excluded.updated_at;
