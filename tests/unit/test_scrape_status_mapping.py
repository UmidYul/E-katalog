from services.worker.app.core.scrape_status import derive_job_status
from services.worker.app.core.scrape_status import normalize_url_item_status


def test_normalize_url_item_status_maps_known_values() -> None:
    assert normalize_url_item_status("done") == "done"
    assert normalize_url_item_status("SUCCESS") == "done"
    assert normalize_url_item_status("rate_limited") == "rate_limited"
    assert normalize_url_item_status("quarantined") == "quarantined"
    assert normalize_url_item_status("invalid") == "invalid"
    assert normalize_url_item_status("anything_else") == "failed"


def test_derive_job_status_marks_partial_without_hard_failures() -> None:
    status, counters = derive_job_status(
        [
            {"status": "done"},
            {"status": "rate_limited"},
            {"status": "quarantined"},
            {"status": "invalid"},
        ]
    )
    assert status == "partial"
    assert counters["done"] == 1
    assert counters["rate_limited"] == 1
    assert counters["quarantined"] == 1
    assert counters["invalid"] == 1
    assert counters["failed"] == 0


def test_derive_job_status_prioritizes_failed() -> None:
    status, counters = derive_job_status([{"status": "done"}, {"status": "failed"}])
    assert status == "failed"
    assert counters["failed"] == 1
