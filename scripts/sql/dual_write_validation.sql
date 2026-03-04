-- Dual-write validation checklist (legacy -> catalog parity)
-- Run after scraper cycle to verify migration Stage 2 readiness.

-- 1) Totals (sanity baseline)
select 'legacy_products_total' as metric, count(*)::bigint as value from products
union all
select 'legacy_offers_total', count(*)::bigint from offers
union all
select 'legacy_price_history_total', count(*)::bigint from price_history
union all
select 'catalog_products_total', count(*)::bigint from catalog_products
union all
select 'catalog_store_products_total', count(*)::bigint from catalog_store_products
union all
select 'catalog_offers_total', count(*)::bigint from catalog_offers
union all
select 'catalog_price_history_total', count(*)::bigint from catalog_price_history
order by metric;

-- 2) Missing records by ID alignment (critical)
select p.id
from products p
left join catalog_products cp on cp.id = p.id
where cp.id is null
order by p.id asc
limit 100;

select o.id
from offers o
left join catalog_store_products csp on csp.id = o.id
where csp.id is null
order by o.id asc
limit 100;

select o.id
from offers o
left join catalog_offers co on co.id = o.id
where co.id is null
order by o.id asc
limit 100;

-- 3) Price parity check
select
    o.id as legacy_offer_id,
    o.price as legacy_price,
    co.price_amount as catalog_price
from offers o
join catalog_offers co on co.id = o.id
where coalesce(co.price_amount, -1) <> coalesce(o.price, -1)
order by o.id asc
limit 100;

-- 4) Stock parity check
select
    o.id as legacy_offer_id,
    o.availability as legacy_availability,
    co.in_stock as catalog_in_stock
from offers o
join catalog_offers co on co.id = o.id
where coalesce(co.in_stock, false) <>
      (
        lower(coalesce(o.availability, '')) not in ('out_of_stock', 'no')
        and coalesce(o.availability, '') <> convert_from(decode('D0BDD0B5D182', 'hex'), 'UTF8')
      )
order by o.id asc
limit 100;

-- 5) Count-only summary for CI/alerts
select 'missing_catalog_products_by_legacy_id' as metric, count(*)::bigint as value
from products p
left join catalog_products cp on cp.id = p.id
where cp.id is null
union all
select 'missing_catalog_store_products_by_legacy_offer_id', count(*)::bigint
from offers o
left join catalog_store_products csp on csp.id = o.id
where csp.id is null
union all
select 'missing_catalog_offers_by_legacy_offer_id', count(*)::bigint
from offers o
left join catalog_offers co on co.id = o.id
where co.id is null
union all
select 'price_mismatches', count(*)::bigint
from offers o
join catalog_offers co on co.id = o.id
where coalesce(co.price_amount, -1) <> coalesce(o.price, -1)
union all
select 'stock_mismatches', count(*)::bigint
from offers o
join catalog_offers co on co.id = o.id
where coalesce(co.in_stock, false) <>
      (
        lower(coalesce(o.availability, '')) not in ('out_of_stock', 'no')
        and coalesce(o.availability, '') <> convert_from(decode('D0BDD0B5D182', 'hex'), 'UTF8')
      )
order by metric;
