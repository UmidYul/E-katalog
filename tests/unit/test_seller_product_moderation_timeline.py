from __future__ import annotations

import asyncio
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.services.seller_product_timeline_service import (
    list_seller_product_status_events,
    record_seller_product_status_event,
)


class _FakeMappings:
    def __init__(self, rows: list[dict] | None = None) -> None:
        self._rows = rows or []

    def all(self) -> list[dict]:
        return self._rows


class _FakeResult:
    def __init__(self, *, rows: list[dict] | None = None, scalar_value: int = 0) -> None:
        self._rows = rows or []
        self._scalar_value = scalar_value

    def mappings(self) -> _FakeMappings:
        return _FakeMappings(self._rows)

    def scalar_one(self) -> int:
        return self._scalar_value


class _FakeSession:
    def __init__(self, results: list[_FakeResult]) -> None:
        self._results = results
        self.calls: list[dict] = []

    async def execute(self, statement, params=None):  # noqa: ANN001
        self.calls.append({"sql": str(statement), "params": dict(params or {})})
        if not self._results:
            return _FakeResult()
        return self._results.pop(0)


def test_record_seller_product_status_event_normalizes_payload() -> None:
    session = _FakeSession([_FakeResult()])
    asyncio.run(
        record_seller_product_status_event(
            session,  # type: ignore[arg-type]
            product_id=12,
            shop_id=34,
            from_status="ACTIVE",
            to_status="PENDING_MODERATION",
            reason_code="AUTO_REMODERATION_SIGNIFICANT_CHANGE",
            actor_role="SYSTEM",
            actor_user_uuid=None,
            metadata={"changed_fields": ["title", "price"]},
        )
    )
    assert len(session.calls) == 1
    payload = session.calls[0]["params"]
    assert payload["from_status"] == "active"
    assert payload["to_status"] == "pending_moderation"
    assert payload["reason_code"] == "auto_remoderation_significant_change"
    assert payload["actor_role"] == "system"


def test_list_seller_product_status_events_maps_actor_and_reason_labels() -> None:
    session = _FakeSession(
        [
            _FakeResult(
                rows=[
                    {
                        "uuid": "91f4705e-f5dc-4ef4-b47e-5b7eaef021fb",
                        "product_uuid": "b6ce8012-7f73-46ac-9796-616934557f6d",
                        "from_status": "pending_moderation",
                        "to_status": "rejected",
                        "event_type": "status_change",
                        "reason_code": "admin_moderation_rejected",
                        "comment": "Фото не по требованиям",
                        "actor_role": "admin",
                        "actor_user_uuid": "8db69ab3-bf37-4ab4-9384-daa8e9ae19ac",
                        "metadata": {"source": "admin"},
                        "created_at": "2026-02-28T19:05:00+00:00",
                    }
                ]
            ),
            _FakeResult(scalar_value=1),
        ]
    )
    payload = asyncio.run(list_seller_product_status_events(session, product_id=77, limit=20, offset=0))  # type: ignore[arg-type]
    assert payload["total"] == 1
    assert len(payload["items"]) == 1
    first = payload["items"][0]
    assert first["actor_label"] == "Модератор"
    assert first["reason_label"] == "Отклонено модератором"
    assert first["to_status"] == "rejected"


def test_router_sources_include_status_history_and_timeline_recording() -> None:
    seller_products_source = (ROOT / "services" / "api" / "app" / "api" / "v1" / "routers" / "seller_products.py").read_text(
        encoding="utf-8"
    )
    admin_sellers_source = (ROOT / "services" / "api" / "app" / "api" / "v1" / "routers" / "admin_sellers.py").read_text(
        encoding="utf-8"
    )

    assert '@router.get("/{product_id}/status-history"' in seller_products_source
    assert seller_products_source.count("record_seller_product_status_event(") >= 3
    assert '@router.get("/product-moderation/{product_id}/status-history"' in admin_sellers_source
    assert "record_seller_product_status_event(" in admin_sellers_source
