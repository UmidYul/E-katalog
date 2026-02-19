from __future__ import annotations

from celery import Celery

from shared.config.settings import settings

celery_client = Celery("scripts", broker=settings.celery_broker_url, backend=settings.celery_result_backend)


if __name__ == "__main__":
    task = celery_client.send_task("app.tasks.reindex_tasks.enqueue_reindex_batches")
    print(task.id)
