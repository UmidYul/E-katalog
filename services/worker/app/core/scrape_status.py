from __future__ import annotations

from typing import Any


def normalize_url_item_status(raw_status: Any) -> str:
    normalized = str(raw_status or "").strip().lower()
    if normalized in {"ok", "done", "completed", "success"}:
        return "done"
    if normalized in {"rate_limited", "quarantined", "invalid"}:
        return normalized
    if normalized:
        return "failed"
    return "failed"


def derive_job_status(url_results: list[dict[str, Any]]) -> tuple[str, dict[str, int]]:
    counters = {"done": 0, "failed": 0, "rate_limited": 0, "quarantined": 0, "invalid": 0}
    for item in url_results:
        status = normalize_url_item_status(item.get("status") if isinstance(item, dict) else None)
        counters[status] += 1

    if counters["failed"] > 0:
        return "failed", counters
    if counters["rate_limited"] > 0 or counters["quarantined"] > 0 or counters["invalid"] > 0:
        return "partial", counters
    return "completed", counters
