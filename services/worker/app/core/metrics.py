from __future__ import annotations

from prometheus_client import Counter, Histogram

PIPELINE_PRODUCTS_PROCESSED_TOTAL = Counter(
    "worker_pipeline_products_processed_total",
    "Total count of products processed by worker pipeline stages.",
    labelnames=("stage",),
)

SCRAPE_PARSE_ERRORS_TOTAL = Counter(
    "worker_scrape_parse_errors_total",
    "Total count of failed URLs treated as parse/scrape errors in worker orchestration.",
)

PIPELINE_STAGE_DURATION_SECONDS = Histogram(
    "worker_pipeline_stage_duration_seconds",
    "Execution time of worker pipeline stages in seconds.",
    labelnames=("stage", "status"),
    buckets=(0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800),
)


def observe_stage_duration(*, stage: str, seconds: float, status: str) -> None:
    PIPELINE_STAGE_DURATION_SECONDS.labels(stage=str(stage), status=str(status)).observe(max(0.0, float(seconds)))


def add_products_processed(*, stage: str, count: int) -> None:
    parsed = int(count or 0)
    if parsed > 0:
        PIPELINE_PRODUCTS_PROCESSED_TOTAL.labels(stage=str(stage)).inc(parsed)


def add_parse_errors(*, count: int) -> None:
    parsed = int(count or 0)
    if parsed > 0:
        SCRAPE_PARSE_ERRORS_TOTAL.inc(parsed)
