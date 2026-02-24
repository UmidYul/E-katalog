from app.tasks.maintenance_tasks import _quality_level, _resolve_overall_quality_status, _status_rank


def test_quality_level_thresholds() -> None:
    assert _quality_level(ratio=0.02, warn_threshold=0.05, critical_threshold=0.10) == "ok"
    assert _quality_level(ratio=0.05, warn_threshold=0.05, critical_threshold=0.10) == "warning"
    assert _quality_level(ratio=0.10, warn_threshold=0.05, critical_threshold=0.10) == "critical"


def test_overall_quality_status_priority() -> None:
    assert _resolve_overall_quality_status(["ok", "ok"]) == "ok"
    assert _resolve_overall_quality_status(["ok", "warning"]) == "warning"
    assert _resolve_overall_quality_status(["warning", "critical", "ok"]) == "critical"


def test_status_rank_order() -> None:
    assert _status_rank("ok") < _status_rank("warning")
    assert _status_rank("warning") < _status_rank("critical")
