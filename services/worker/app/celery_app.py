from celery import Celery
from celery.schedules import crontab
from kombu import Exchange, Queue

from app.core.config import settings

celery_app = Celery(
    "scraper_worker",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.tasks.scrape_tasks",
        "app.tasks.normalize_tasks",
        "app.tasks.dedupe_tasks",
        "app.tasks.embedding_tasks",
        "app.tasks.reindex_tasks",
        "app.tasks.export_tasks",
        "app.tasks.maintenance_tasks",
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
        "app.tasks.scrape_tasks.scrape_priority_category": {"queue": "scrape.high", "routing_key": "scrape.high"},
        "app.tasks.scrape_tasks.scrape_store_category": {"queue": "scrape.default", "routing_key": "scrape.default"},
        "app.tasks.scrape_tasks.enqueue_full_crawl": {"queue": "scrape.high", "routing_key": "scrape.high"},
        "app.tasks.scrape_tasks.retry_failed_items": {"queue": "scrape.default", "routing_key": "scrape.default"},
        "app.tasks.normalize_tasks.normalize_product_batch": {"queue": "normalize", "routing_key": "normalize"},
        "app.tasks.normalize_tasks.enqueue_dirty_products": {"queue": "normalize", "routing_key": "normalize"},
        "app.tasks.dedupe_tasks.find_duplicate_candidates_task": {"queue": "dedupe", "routing_key": "dedupe"},
        "app.tasks.dedupe_tasks.enqueue_dedupe_batches": {"queue": "dedupe", "routing_key": "dedupe"},
        "app.tasks.embedding_tasks.generate_embeddings_batch": {"queue": "embedding", "routing_key": "embedding"},
        "app.tasks.embedding_tasks.enqueue_embedding_batches": {"queue": "embedding", "routing_key": "embedding"},
        "app.tasks.reindex_tasks.reindex_product_search_batch": {"queue": "reindex", "routing_key": "reindex"},
        "app.tasks.reindex_tasks.enqueue_reindex_batches": {"queue": "reindex", "routing_key": "reindex"},
        "app.tasks.export_tasks.export_json": {"queue": "export", "routing_key": "export"},
        "app.tasks.export_tasks.export_csv": {"queue": "export", "routing_key": "export"},
        "app.tasks.maintenance_tasks.cleanup_stale_offers": {"queue": "maintenance", "routing_key": "maintenance"},
        "app.tasks.maintenance_tasks.rotate_price_history_partitions": {"queue": "maintenance", "routing_key": "maintenance"},
    },
    beat_schedule={
        "scrape-every-6h": {
            "task": "app.tasks.scrape_tasks.enqueue_full_crawl",
            "schedule": crontab(minute=0, hour="*/6"),
            "options": {"queue": "scrape.high", "routing_key": "scrape.high"},
        },
        "retry-failed-crawl-items-every-10m": {
            "task": "app.tasks.scrape_tasks.retry_failed_items",
            "schedule": crontab(minute="*/10"),
            "options": {"queue": "scrape.default", "routing_key": "scrape.default"},
        },
        "normalize-dirty-products-every-15m": {
            "task": "app.tasks.normalize_tasks.enqueue_dirty_products",
            "schedule": crontab(minute="*/15"),
            "options": {"queue": "normalize", "routing_key": "normalize"},
        },
        "dedupe-every-15m": {
            "task": "app.tasks.dedupe_tasks.enqueue_dedupe_batches",
            "schedule": crontab(minute="*/15"),
            "options": {"queue": "dedupe", "routing_key": "dedupe"},
        },
        "embedding-every-15m": {
            "task": "app.tasks.embedding_tasks.enqueue_embedding_batches",
            "schedule": crontab(minute="*/15"),
            "options": {"queue": "embedding", "routing_key": "embedding"},
        },
        "reindex-every-15m": {
            "task": "app.tasks.reindex_tasks.enqueue_reindex_batches",
            "schedule": crontab(minute="*/15"),
            "options": {"queue": "reindex", "routing_key": "reindex"},
        },
        "cleanup-daily-0230": {
            "task": "app.tasks.maintenance_tasks.cleanup_stale_offers",
            "schedule": crontab(minute=30, hour=2),
            "options": {"queue": "maintenance", "routing_key": "maintenance"},
        },
    },
)
