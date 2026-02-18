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
