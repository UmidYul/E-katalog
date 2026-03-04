from __future__ import annotations

from collections import defaultdict
from threading import Lock
from time import perf_counter
from typing import Any

from app.core.config import settings
from app.core.logging import logger
from shared.observability.sentry import init_sentry as init_sentry_common


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

        total_5xx = 0
        for (_, _, status_class), count in by_route.items():
            if status_class == "5xx":
                total_5xx += int(count)

        error_ratio_5xx = (float(total_5xx) / float(requests_total)) if requests_total > 0 else 0.0

        def _estimate_quantile(quantile: float) -> float:
            if duration_count <= 0:
                return 0.0
            for bound in self._duration_buckets:
                cumulative = int(bucket_counts.get(bound, 0))
                if (float(cumulative) / float(duration_count)) >= quantile:
                    return float(bound)
            return float(self._duration_buckets[-1])

        p95_estimate = _estimate_quantile(0.95)
        p99_estimate = _estimate_quantile(0.99)
        p95_target = max(0.01, float(settings.slo_api_latency_p95_target_seconds))
        p99_target = max(0.01, float(settings.slo_api_latency_p99_target_seconds))
        error_ratio_target = max(0.0, min(1.0, float(settings.slo_api_5xx_target_ratio)))

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
                "# HELP api_http_error_ratio_5xx_ratio Ratio of 5xx responses over total requests.",
                "# TYPE api_http_error_ratio_5xx_ratio gauge",
                f"api_http_error_ratio_5xx_ratio {error_ratio_5xx:.6f}",
                "# HELP api_http_latency_p95_seconds_estimate Estimated p95 latency from histogram buckets.",
                "# TYPE api_http_latency_p95_seconds_estimate gauge",
                f"api_http_latency_p95_seconds_estimate {p95_estimate:.6f}",
                "# HELP api_http_latency_p99_seconds_estimate Estimated p99 latency from histogram buckets.",
                "# TYPE api_http_latency_p99_seconds_estimate gauge",
                f"api_http_latency_p99_seconds_estimate {p99_estimate:.6f}",
                "# HELP api_slo_target_5xx_ratio Target ratio for 5xx responses.",
                "# TYPE api_slo_target_5xx_ratio gauge",
                f"api_slo_target_5xx_ratio {error_ratio_target:.6f}",
                "# HELP api_slo_target_latency_p95_seconds Target p95 latency in seconds.",
                "# TYPE api_slo_target_latency_p95_seconds gauge",
                f"api_slo_target_latency_p95_seconds {p95_target:.6f}",
                "# HELP api_slo_target_latency_p99_seconds Target p99 latency in seconds.",
                "# TYPE api_slo_target_latency_p99_seconds gauge",
                f"api_slo_target_latency_p99_seconds {p99_target:.6f}",
                "# HELP api_slo_breach_5xx Indicator 1 when current 5xx ratio breaches target.",
                "# TYPE api_slo_breach_5xx gauge",
                f"api_slo_breach_5xx {1 if error_ratio_5xx > error_ratio_target else 0}",
                "# HELP api_slo_breach_latency_p95 Indicator 1 when current p95 latency breaches target.",
                "# TYPE api_slo_breach_latency_p95 gauge",
                f"api_slo_breach_latency_p95 {1 if p95_estimate > p95_target else 0}",
                "# HELP api_slo_breach_latency_p99 Indicator 1 when current p99 latency breaches target.",
                "# TYPE api_slo_breach_latency_p99 gauge",
                f"api_slo_breach_latency_p99 {1 if p99_estimate > p99_target else 0}",
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
    try:
        from sentry_sdk.integrations.celery import CeleryIntegration
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        init_sentry_common(
            enabled=bool(settings.sentry_enabled),
            dsn=settings.sentry_dsn,
            environment=str(settings.environment),
            release=str(settings.sentry_release or ""),
            traces_sample_rate=float(settings.sentry_traces_sample_rate),
            profiles_sample_rate=float(settings.sentry_profiles_sample_rate),
            send_default_pii=bool(settings.sentry_send_default_pii),
            service="api",
            ignored_errors=list(settings.sentry_ignored_errors),
            logger=logger,
            integrations=[FastApiIntegration(), SqlalchemyIntegration(), CeleryIntegration()],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("sentry_init_failed", error=str(exc))
