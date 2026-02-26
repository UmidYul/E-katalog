from services.api.app.core.observability import _HttpMetrics


def test_metrics_render_includes_slo_lines() -> None:
    metrics = _HttpMetrics()
    started = metrics.mark_start()
    metrics.mark_done(method="GET", route="/api/v1/health", status_code=200, started_at=started - 0.02)
    started = metrics.mark_start()
    metrics.mark_done(method="GET", route="/api/v1/fail", status_code=500, started_at=started - 0.30)

    output = metrics.render_prometheus()

    assert "api_http_error_ratio_5xx_ratio" in output
    assert "api_http_latency_p95_seconds_estimate" in output
    assert "api_http_latency_p99_seconds_estimate" in output
    assert "api_slo_target_5xx_ratio" in output
    assert "api_slo_target_latency_p95_seconds" in output
    assert "api_slo_target_latency_p99_seconds" in output
    assert "api_slo_breach_5xx" in output
    assert "api_slo_breach_latency_p95" in output
    assert "api_slo_breach_latency_p99" in output
