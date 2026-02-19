# Scraper Service

## Run locally

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec app python -m app.db.init_db
docker compose exec app python -m app.main
```

## Run workers

```bash
docker compose up worker beat -d
```

## Trigger manual scraping job

```bash
docker compose exec worker celery -A app.tasks.celery_app:celery_app call app.tasks.scrape_tasks.enqueue_example_store_scrape
```

## Export found data to CSV

```bash
docker compose exec app python -m app.db.export_to_csv --output /srv/scraper/exports/offers.csv --limit 500 --delimiter ";"
```

## Export found data to JSON

```bash
docker compose exec app python -m app.db.export_to_json --output /srv/scraper/exports/offers.json --limit 500
```

## Backfill availability/specifications for existing offers

```bash
docker compose exec app python -m app.db.backfill_offer_metadata --limit 1000 --only-missing
```
