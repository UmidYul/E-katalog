# E-katalog Platform

Production-oriented architecture with separated services:

- `services/api` - FastAPI backend
- `services/scraper` - scraping runtime (Playwright + httpx)
- `services/worker` - Celery workers and beat
- `services/ai` - normalization/dedup/embedding modules
- `shared` - config/logging/db/common types
- `migrations` - Alembic
- `infra/docker` - compose files
- `infra/nginx` - reverse proxy
- `infra/postgres` - extension bootstrap
- `scripts` - operational scripts

## Run (dev)

```bash
cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up --build -d
docker compose -f infra/docker/docker-compose.yml exec api alembic -c /srv/migrations/alembic.ini upgrade head
```

## Run (prod-like)

```bash
docker compose -f infra/docker/docker-compose.prod.yml up --build -d
docker compose -f infra/docker/docker-compose.prod.yml exec api alembic -c /srv/migrations/alembic.ini upgrade head
```

## API

Base path: `/api/v1`

- `GET /search`
- `GET /products`
- `GET /products/{id}`
- `GET /products/{id}/offers`
- `GET /products/{id}/price-history`
- `GET /categories`
- `GET /categories/{slug}/products`
- `GET /brands`
- `GET /stores`
- `GET /filters`
- `POST /compare`
- `POST /admin/reindex/products`
- `POST /admin/embeddings/rebuild`
- `POST /admin/dedupe/run`
- `POST /admin/scrape/run`

## Notes

- Backend is fully separated from scraper in `services/api`.
- Worker pipelines use queues: `scrape`, `normalize`, `dedupe`, `embedding`, `reindex`, `export`, `maintenance`.
- Postgres extensions: `vector`, `pg_trgm`, `unaccent`.
