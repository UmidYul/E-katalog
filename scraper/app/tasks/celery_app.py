from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "scraper_worker",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.tasks.scrape_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Tashkent",
    enable_utc=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_track_started=True,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "scrape-all-stores-every-6-hours": {
            "task": "app.tasks.scrape_tasks.enqueue_example_store_scrape",
            "schedule": crontab(minute=0, hour="*/6"),
        }
    },
)
