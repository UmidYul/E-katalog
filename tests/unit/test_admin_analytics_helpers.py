from services.api.app.api.v1.routers.admin import _build_orders_status_counts, _severity_by_threshold


def test_severity_by_threshold() -> None:
    assert _severity_by_threshold(0.05, warn=0.08, critical=0.15) is None
    assert _severity_by_threshold(0.08, warn=0.08, critical=0.15) == "warning"
    assert _severity_by_threshold(0.16, warn=0.08, critical=0.15) == "critical"


def test_build_orders_status_counts() -> None:
    rows = [
        {"status": "new"},
        {"status": "completed"},
        {"status": "completed"},
        {"status": "cancelled"},
    ]
    result = _build_orders_status_counts(rows)
    assert result == [
        {"status": "cancelled", "count": 1},
        {"status": "completed", "count": 2},
        {"status": "new", "count": 1},
    ]
