# MVP Dev Rollout Checklist (Categories + Gallery + Variants)

## 1) Apply migrations

```powershell
docker compose -f infra/docker/docker-compose.yml exec api alembic upgrade head
docker compose -f infra/docker/docker-compose.yml exec worker alembic upgrade head
docker compose -f infra/docker/docker-compose.yml exec scraper alembic upgrade head
```

## 2) Baseline metrics (before refill)

```powershell
docker compose -f infra/docker/docker-compose.yml exec db psql -U postgres -d zinc -c "select count(*) as active_categories from catalog_categories where is_active = true;"
docker compose -f infra/docker/docker-compose.yml exec db psql -U postgres -d zinc -c "select count(*) as brands_total from catalog_brands;"
docker compose -f infra/docker/docker-compose.yml exec db psql -U postgres -d zinc -c "select count(*) as variants_total from catalog_product_variants;"
docker compose -f infra/docker/docker-compose.yml exec db psql -U postgres -d zinc -c "select s.name, avg(jsonb_array_length(coalesce(o.images,'[]'::jsonb))) as avg_images from offers o join shops s on s.id=o.shop_id group by s.name order by s.name;"
```

## 3) Full dev backfill

```powershell
docker compose -f infra/docker/docker-compose.yml exec worker celery -A app.celery_app call app.tasks.normalize_tasks.normalize_full_catalog --args='[500]'
docker compose -f infra/docker/docker-compose.yml exec worker celery -A app.celery_app call app.tasks.reindex_tasks.reindex_products --args='[2000]'
```

If you need one chunk from the beginning:

```powershell
docker compose -f infra/docker/docker-compose.yml exec worker celery -A app.celery_app call app.tasks.normalize_tasks.normalize_product_batch --kwargs='{\"limit\":500,\"reset_offset\":true}'
```

## 4) Acceptance checks

```powershell
docker compose -f infra/docker/docker-compose.yml exec db psql -U postgres -d zinc -c "select b.name, count(*) as products from catalog_canonical_products cp join catalog_brands b on b.id=cp.brand_id group by b.name order by products desc;"
docker compose -f infra/docker/docker-compose.yml exec db psql -U postgres -d zinc -c "select count(*) as with_gallery from catalog_store_products where jsonb_typeof(metadata->'images')='array' and jsonb_array_length(metadata->'images') > 1;"
docker compose -f infra/docker/docker-compose.yml exec db psql -U postgres -d zinc -c "select count(*) as offers_with_variant from catalog_offers where product_variant_id is not null;"
```

## 5) UI smoke tests

1. Open `/category/smartphone-apple`, verify only Apple items.
2. Open `/category/smartphone-samsung`, verify only Samsung items.
3. Open PDP and verify gallery has multiple photos where available.
4. Verify compare/catalog still load with pagination and filters.
