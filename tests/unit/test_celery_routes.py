from app.celery_app import celery_app


def test_cleanup_empty_canonicals_task_routing() -> None:
    route = celery_app.conf.task_routes.get("app.tasks.maintenance_tasks.cleanup_empty_canonicals")
    assert route == {"queue": "maintenance", "routing_key": "maintenance"}


def test_cleanup_empty_canonicals_schedule_registered() -> None:
    schedule = celery_app.conf.beat_schedule.get("cleanup-empty-canonicals-daily-0245")
    assert schedule is not None
    assert schedule["task"] == "app.tasks.maintenance_tasks.cleanup_empty_canonicals"
