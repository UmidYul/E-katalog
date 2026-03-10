from __future__ import annotations

from typing import Any

import services.api.app.services.worker_client as worker_client


class _DummyResult:
    def __init__(self, task_id: str) -> None:
        self.id = task_id


def test_enqueue_process_quarantine_item_sends_expected_payload(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def _fake_send_task(task_name: str, *, kwargs: dict | None = None, queue: str, routing_key: str):
        captured["task_name"] = task_name
        captured["kwargs"] = kwargs
        captured["queue"] = queue
        captured["routing_key"] = routing_key
        return _DummyResult("task-123")

    monkeypatch.setattr(worker_client.celery_client, "send_task", _fake_send_task)

    task_id = worker_client.enqueue_process_quarantine_item(
        item_uuid="A56E6A6A-5E10-4CE8-8A81-1A6B60B6EA13",
        category_slug_override="Phones",
        brand_hint_override="Apple",
    )

    assert task_id == "task-123"
    assert captured["task_name"] == "app.tasks.scrape_tasks.process_quarantine_item"
    assert captured["queue"] == "maintenance"
    assert captured["routing_key"] == "maintenance"
    assert captured["kwargs"] == {
        "item_uuid": "a56e6a6a-5e10-4ce8-8a81-1a6b60b6ea13",
        "category_slug_override": "phones",
        "brand_hint_override": "Apple",
    }
