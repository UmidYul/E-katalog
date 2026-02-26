from app.celery_app import celery_app


def test_cleanup_empty_canonicals_task_routing() -> None:
    route = celery_app.conf.task_routes.get("app.tasks.maintenance_tasks.cleanup_empty_canonicals")
    assert route == {"queue": "maintenance", "routing_key": "maintenance"}


def test_cleanup_empty_canonicals_schedule_registered() -> None:
    schedule = celery_app.conf.beat_schedule.get("cleanup-empty-canonicals-daily-0245")
    assert schedule is not None
    assert schedule["task"] == "app.tasks.maintenance_tasks.cleanup_empty_canonicals"


def test_auto_deactivate_no_offer_products_task_routing() -> None:
    route = celery_app.conf.task_routes.get("app.tasks.maintenance_tasks.deactivate_no_offer_products")
    assert route == {"queue": "maintenance", "routing_key": "maintenance"}


def test_auto_deactivate_no_offer_products_schedule_registered() -> None:
    schedule = celery_app.conf.beat_schedule.get("auto-deactivate-no-offer-products-every-6h")
    assert schedule is not None
    assert schedule["task"] == "app.tasks.maintenance_tasks.enqueue_auto_deactivate_no_offer_products"


def test_copywriting_task_routing() -> None:
    route = celery_app.conf.task_routes.get("app.tasks.copywriting_tasks.generate_product_copy_batch")
    assert route == {"queue": "normalize", "routing_key": "normalize"}


def test_copywriting_schedule_registered() -> None:
    schedule = celery_app.conf.beat_schedule.get("copywriting-every-15m")
    assert schedule is not None
    assert schedule["task"] == "app.tasks.copywriting_tasks.enqueue_product_copy_batches"


def test_quality_report_task_routing() -> None:
    route = celery_app.conf.task_routes.get("app.tasks.maintenance_tasks.generate_catalog_quality_report")
    assert route == {"queue": "maintenance", "routing_key": "maintenance"}


def test_quality_report_schedule_registered() -> None:
    schedule = celery_app.conf.beat_schedule.get("quality-report-every-6h")
    assert schedule is not None
    assert schedule["task"] == "app.tasks.maintenance_tasks.enqueue_catalog_quality_reports"


def test_quality_alert_test_task_routing() -> None:
    route = celery_app.conf.task_routes.get("app.tasks.maintenance_tasks.send_test_quality_alert")
    assert route == {"queue": "maintenance", "routing_key": "maintenance"}


def test_cleanup_auth_token_tables_task_routing() -> None:
    route = celery_app.conf.task_routes.get("app.tasks.maintenance_tasks.cleanup_auth_token_tables")
    assert route == {"queue": "maintenance", "routing_key": "maintenance"}


def test_cleanup_auth_token_tables_schedule_registered() -> None:
    schedule = celery_app.conf.beat_schedule.get("cleanup-auth-token-tables-daily-0355")
    assert schedule is not None
    assert schedule["task"] == "app.tasks.maintenance_tasks.enqueue_cleanup_auth_token_tables"


def test_admin_alert_evaluation_task_routing() -> None:
    route = celery_app.conf.task_routes.get("app.tasks.maintenance_tasks.evaluate_admin_alert_events")
    assert route == {"queue": "maintenance", "routing_key": "maintenance"}


def test_admin_alert_evaluation_schedule_registered() -> None:
    schedule = celery_app.conf.beat_schedule.get("admin-alert-evaluation-every-5m")
    assert schedule is not None
    assert schedule["task"] == "app.tasks.maintenance_tasks.enqueue_admin_alert_evaluation"


def test_price_alert_delivery_task_routing() -> None:
    route = celery_app.conf.task_routes.get("app.tasks.maintenance_tasks.deliver_price_alert_notifications")
    assert route == {"queue": "maintenance", "routing_key": "maintenance"}


def test_price_alert_delivery_schedule_registered() -> None:
    schedule = celery_app.conf.beat_schedule.get("price-alert-delivery-every-5m")
    assert schedule is not None
    assert schedule["task"] == "app.tasks.maintenance_tasks.enqueue_price_alert_notifications"
