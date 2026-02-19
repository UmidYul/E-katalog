FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/srv

WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt

COPY services /srv/services
COPY shared /srv/shared
COPY migrations /srv/migrations

WORKDIR /srv/services/worker
CMD ["celery", "-A", "app.celery_app:celery_app", "worker", "-Q", "scrape.default", "--loglevel=INFO"]
