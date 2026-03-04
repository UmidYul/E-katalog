from __future__ import annotations

import time

from prometheus_client import CollectorRegistry, multiprocess, start_http_server

from app.core.config import settings
from app.core.logging import configure_logging, logger


def main() -> None:
    configure_logging(settings.log_level)
    port = int(getattr(settings, "worker_metrics_port", 9108) or 9108)
    registry = CollectorRegistry()
    multiprocess.MultiProcessCollector(registry)
    start_http_server(port, registry=registry)
    logger.info("worker_metrics_server_started", port=port)
    while True:
        time.sleep(60)


if __name__ == "__main__":
    main()
