from celery import Celery
from celery.schedules import crontab
from kombu import Exchange, Queue

from app.core.config import settings
from app.core.logging import configure_logging, logger
from shared.observability.sentry import init_sentry

configure_logging(settings.log_level)
try:
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    init_sentry(
        enabled=bool(settings.sentry_enabled),
        dsn=settings.sentry_dsn,
        environment=str(settings.environment),
        release=str(settings.sentry_release or ""),
        traces_sample_rate=float(settings.sentry_traces_sample_rate),
        profiles_sample_rate=float(settings.sentry_profiles_sample_rate),
        send_default_pii=bool(settings.sentry_send_default_pii),
        service="scraper",
        ignored_errors=list(settings.sentry_ignored_errors),
        logger=logger,
        integrations=[CeleryIntegration(), SqlalchemyIntegration()],
    )
except Exception as exc:  # noqa: BLE001
    logger.warning("sentry_init_failed", service="scraper", error=str(exc))

celery_app = Celery(
    "scraper_worker",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.tasks.scrape_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Tashkent",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    broker_transport_options={"visibility_timeout": 7200},
    task_default_exchange="ekatalog",
    task_default_exchange_type="direct",
    task_default_routing_key="scrape.default",
    task_default_queue="scrape.default",
    task_queues=(
        Queue("scrape.high", Exchange("ekatalog"), routing_key="scrape.high"),
        Queue("scrape.default", Exchange("ekatalog"), routing_key="scrape.default"),
        Queue("normalize", Exchange("ekatalog"), routing_key="normalize"),
        Queue("dedupe", Exchange("ekatalog"), routing_key="dedupe"),
        Queue("embedding", Exchange("ekatalog"), routing_key="embedding"),
        Queue("reindex", Exchange("ekatalog"), routing_key="reindex"),
        Queue("export", Exchange("ekatalog"), routing_key="export"),
        Queue("maintenance", Exchange("ekatalog"), routing_key="maintenance"),
        Queue("deadletter", Exchange("ekatalog"), routing_key="deadletter"),
    ),
    task_routes={
        "app.tasks.scrape_tasks.run_scrape_targets": {"queue": "scrape.high", "routing_key": "scrape.high"},
        "app.tasks.scrape_tasks.enqueue_example_store_scrape": {"queue": "scrape.high", "routing_key": "scrape.high"},
    },
    beat_schedule={
        "scrape-every-6h": {
            "task": "app.tasks.scrape_tasks.enqueue_example_store_scrape",
            "schedule": crontab(minute=0, hour="*/6"),
            "options": {"queue": "scrape.high", "routing_key": "scrape.high"},
        },
    },
)
