from __future__ import annotations

import asyncio
from collections.abc import Iterable
from typing import Any


def init_sentry(
    *,
    enabled: bool,
    dsn: str | None,
    environment: str,
    release: str,
    traces_sample_rate: float,
    profiles_sample_rate: float,
    send_default_pii: bool,
    service: str,
    ignored_errors: list[str] | None,
    logger: Any,
    integrations: Iterable[Any] | None = None,
) -> None:
    if not enabled:
        return
    if not dsn:
        logger.warning("sentry_disabled_missing_dsn", service=service)
        return
    try:
        import sentry_sdk
    except Exception as exc:  # noqa: BLE001
        logger.warning("sentry_import_failed", service=service, error=str(exc))
        return

    ignore_patterns = [str(item).strip().lower() for item in (ignored_errors or []) if str(item).strip()]

    def _before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
        exc_info = hint.get("exc_info")
        if exc_info and len(exc_info) == 3:
            exc_type = exc_info[0]
            if isinstance(exc_type, type) and issubclass(exc_type, asyncio.CancelledError):
                return None

        message = str(event.get("message") or "").strip().lower()
        if message and any(pattern in message for pattern in ignore_patterns):
            return None

        logentry = event.get("logentry")
        if isinstance(logentry, dict):
            formatted = str(logentry.get("formatted") or "").strip().lower()
            if formatted and any(pattern in formatted for pattern in ignore_patterns):
                return None

        request = event.get("request")
        if isinstance(request, dict):
            url = str(request.get("url") or "").lower()
            if "/health" in url or "/metrics" in url:
                return None

        return event

    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=environment,
            release=release or None,
            traces_sample_rate=max(0.0, min(1.0, float(traces_sample_rate))),
            profiles_sample_rate=max(0.0, min(1.0, float(profiles_sample_rate))),
            send_default_pii=bool(send_default_pii),
            integrations=list(integrations or []),
            before_send=_before_send,
        )
        sentry_sdk.set_tag("environment", environment)
        sentry_sdk.set_tag("service", service)
        sentry_sdk.set_tag("version", release or "unknown")
        logger.info(
            "sentry_initialized",
            service=service,
            environment=environment,
            version=release or "unknown",
            traces_sample_rate=traces_sample_rate,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("sentry_init_failed", service=service, error=str(exc))
