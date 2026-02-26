from __future__ import annotations

from collections import defaultdict
from threading import Lock
from time import perf_counter
from typing import Any

from app.core.config import settings
from app.core.logging import logger


class _HttpMetrics:
    def __init__(self) -> None:
        self._lock = Lock()
        self._started_at = perf_counter()
        self._inflight = 0
        self._requests_total = 0
        self._duration_sum = 0.0
        self._duration_count = 0
        self._duration_buckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
        self._duration_bucket_counts: dict[float, int] = defaultdict(int)
        self._requests_by_route: dict[tuple[str, str, str], int] = defaultdict(int)

    def mark_start(self) -> float:
        with self._lock:
            self._inflight += 1
        return perf_counter()

    def mark_done(self, *, method: str, route: str, status_code: int, started_at: float) -> None:
        duration = max(0.0, perf_counter() - started_at)
        status_class = f"{int(status_code) // 100}xx"
        bucket_method = (method or "GET").upper()
        bucket_route = route or "unmatched"
        with self._lock:
            self._inflight = max(0, self._inflight - 1)
            self._requests_total += 1
            self._duration_sum += duration
            self._duration_count += 1
            self._requests_by_route[(bucket_method, bucket_route, status_class)] += 1
            for bound in self._duration_buckets:
                if duration <= bound:
                    self._duration_bucket_counts[bound] += 1
            self._duration_bucket_counts[float("inf")] += 1

    def render_prometheus(self) -> str:
        with self._lock:
            inflight = self._inflight
            requests_total = self._requests_total
            duration_sum = self._duration_sum
            duration_count = self._duration_count
            uptime_seconds = max(0.0, perf_counter() - self._started_at)
            by_route = dict(self._requests_by_route)
            bucket_counts = dict(self._duration_bucket_counts)

        lines = [
            "# HELP api_http_requests_total Total HTTP requests served.",
            "# TYPE api_http_requests_total counter",
        ]
        if by_route:
            for (method, route, status_class), count in sorted(by_route.items()):
                lines.append(
                    f'api_http_requests_total{{method="{method}",route="{route}",status_class="{status_class}"}} {count}'
                )
        else:
            lines.append('api_http_requests_total{method="none",route="none",status_class="none"} 0')

        lines.extend(
            [
                "# HELP api_http_request_duration_seconds HTTP request duration in seconds.",
                "# TYPE api_http_request_duration_seconds histogram",
            ]
        )
        for bound in self._duration_buckets:
            lines.append(
                f'api_http_request_duration_seconds_bucket{{le="{bound}"}} {int(bucket_counts.get(bound, 0))}'
            )
        lines.append(f'api_http_request_duration_seconds_bucket{{le="+Inf"}} {int(bucket_counts.get(float("inf"), 0))}')
        lines.append(f"api_http_request_duration_seconds_sum {duration_sum:.6f}")
        lines.append(f"api_http_request_duration_seconds_count {duration_count}")

        lines.extend(
            [
                "# HELP api_http_requests_inflight Requests currently being processed.",
                "# TYPE api_http_requests_inflight gauge",
                f"api_http_requests_inflight {inflight}",
                "# HELP api_process_uptime_seconds API process uptime in seconds.",
                "# TYPE api_process_uptime_seconds gauge",
                f"api_process_uptime_seconds {uptime_seconds:.3f}",
                "",
            ]
        )
        return "\n".join(lines)


http_metrics = _HttpMetrics()


def route_label_from_scope(scope: dict[str, Any]) -> str:
    route = scope.get("route")
    if route is not None:
        path = getattr(route, "path", None)
        if isinstance(path, str) and path:
            return path
    return scope.get("path") or "unmatched"


def init_sentry() -> None:
    if not settings.sentry_enabled:
        return
    if not settings.sentry_dsn:
        logger.warning("sentry_disabled_missing_dsn")
        return
    try:
        import sentry_sdk
        from sentry_sdk.integrations.celery import CeleryIntegration
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            release=settings.sentry_release or None,
            traces_sample_rate=max(0.0, min(1.0, float(settings.sentry_traces_sample_rate))),
            profiles_sample_rate=max(0.0, min(1.0, float(settings.sentry_profiles_sample_rate))),
            send_default_pii=bool(settings.sentry_send_default_pii),
            integrations=[FastApiIntegration(), SqlalchemyIntegration(), CeleryIntegration()],
        )
        logger.info("sentry_initialized", environment=settings.environment, traces_sample_rate=settings.sentry_traces_sample_rate)
    except Exception as exc:  # noqa: BLE001
        logger.warning("sentry_init_failed", error=str(exc))
