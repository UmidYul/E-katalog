# Scraper Service

## Run locally

```bash
cp .env.example .env
docker compose -f scraper/docker-compose.yml up --build -d
docker compose -f scraper/docker-compose.yml exec app python -m app.db.init_db
docker compose -f scraper/docker-compose.yml exec app python -m app.main
```

## Run workers

```bash
docker compose -f scraper/docker-compose.yml up worker beat -d
```

## Trigger manual scraping job

```bash
docker compose -f scraper/docker-compose.yml exec worker celery -A app.tasks.celery_app:celery_app call app.tasks.scrape_tasks.enqueue_example_store_scrape
```

## Export found data to CSV

```bash
docker compose -f scraper/docker-compose.yml exec app python -m app.db.export_to_csv --output /srv/scraper/exports/offers.csv --limit 500 --delimiter ";"
```

## Export found data to JSON

```bash
docker compose -f scraper/docker-compose.yml exec app python -m app.db.export_to_json --output /srv/scraper/exports/offers.json --limit 500
```

## Backfill availability/specifications for existing offers

```bash
docker compose -f scraper/docker-compose.yml exec app python -m app.db.backfill_offer_metadata --limit 1000 --only-missing
```

Optional AI enrichment for missing specs:
Set `AI_SPEC_ENRICHMENT_ENABLED=true`, `OPENAI_API_KEY=...` in `.env`.
For strict required fields mode add:
`AI_SPEC_STRICT_MODE=true`
`AI_SPEC_MAX_ATTEMPTS=2`

## Tuning via .env

- `CRAWL_INTERVAL_MINUTES`: how often Beat enqueues scraping task (in minutes).
- `REQUEST_CONCURRENCY`: max concurrent product parsing per scrape run.
- `MAX_RETRIES`: Celery task retries count on failure.
- `TASK_RETRY_BACKOFF_MAX_SECONDS`: max retry backoff delay.
- `DEFAULT_TIMEOUT_SECONDS`: HTTP timeout for requests.

After changing `.env`, recreate worker/beat/app:

```bash
docker compose -f scraper/docker-compose.yml up -d --force-recreate app worker beat
```
