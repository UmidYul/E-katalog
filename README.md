# E-katalog Platform

- Backend services: `services/`
- Shared modules: `shared/`
- Infra and deployment: `infra/`
- Alembic migrations: `migrations/`
- Ops scripts: `scripts/`
- Frontend app: `frontend/`

## Run Full Stack (Nginx + Frontend + API + Workers)

```bash
cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up --build -d
docker compose -f infra/docker/docker-compose.yml exec api alembic -c /srv/migrations/alembic.ini upgrade head
```

Open:
- `http://localhost` -> Next.js frontend behind Nginx
- `http://localhost/api/v1/health` -> FastAPI health
- `http://localhost/api/v1/metrics` -> Prometheus-style API metrics

Observability envs:
- `SENTRY_ENABLED`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILES_SAMPLE_RATE`

Backup/restore:
- Runbook: `docs/BACKUP_RESTORE_RUNBOOK.md`
- Script: `python scripts/db_backup_restore.py --label manual --validate-restore`

## Canonical Product Architecture (v2)

The platform now uses canonical product grouping with multi-seller offers:

- `catalog_canonical_products`: single normalized product entity.
- `catalog_products.canonical_product_id`: source product -> canonical mapping.
- `catalog_store_products.canonical_product_id`: store listing -> canonical mapping.
- `catalog_sellers`: per-store seller registry.
- `catalog_offers` now includes:
  - `canonical_product_id`
  - `store_id`
  - `seller_id`
  - `offer_url`
  - `delivery_days`

This enables one product card per canonical item in catalog and full offer aggregation per store on PDP.

### Migration

Run both migrations:

```bash
docker compose -f infra/docker/docker-compose.yml exec api alembic -c /srv/migrations/alembic.ini upgrade head
```

### Canonical Sync / Backfill

If you have legacy `products/offers` tables populated by scraper:

```bash
docker compose -f infra/docker/docker-compose.yml exec api python /srv/scripts/sync_legacy_to_catalog.py
docker compose -f infra/docker/docker-compose.yml exec worker celery -A app.celery_app call app.tasks.normalize_tasks.normalize_product_batch
docker compose -f infra/docker/docker-compose.yml exec worker celery -A app.celery_app call app.tasks.embedding_tasks.generate_embeddings_batch
docker compose -f infra/docker/docker-compose.yml exec worker celery -A app.celery_app call app.tasks.reindex_tasks.reindex_product_search_batch
```

### API Contract (PDP)

`GET /api/v1/products/{id}` now returns canonical data with grouped offers:

```json
{
  "id": 123,
  "title": "iPhone 14 128GB Blue",
  "category": "Smartphones",
  "brand": "Apple",
  "main_image": "https://example.com/iphone14.jpg",
  "specs": {
    "ram": "6GB",
    "storage": "128GB"
  },
  "offers_by_store": [
    {
      "store_id": 1,
      "store": "Texnomart",
      "minimal_price": 1210,
      "offers_count": 2,
      "offers": [
        {
          "id": 991,
          "seller_id": 11,
          "seller_name": "Seller 1",
          "price_amount": 1220,
          "link": "https://...",
          "in_stock": true,
          "delivery_days": 2,
          "currency": "UZS",
          "scraped_at": "2026-02-19T10:00:00Z"
        }
      ]
    }
  ]
}
```

## Frontend Local

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

See `frontend/README.md` for frontend details.

## Python Version

- Local development and CI are pinned to Python `3.11` (`.python-version`).
- Production containers may run newer compatible versions (for example, `3.12`), but new backend code should stay compatible with `3.11` unless the pin is intentionally upgraded.

## CI

- GitHub Actions workflow: `.github/workflows/ci.yml`
- Setup guide: `docs/CI_SETUP.md`