from __future__ import annotations

import asyncio
from contextlib import suppress

from app.core.config import settings
from app.core.logging import configure_logging, logger
from app.tasks.scrape_tasks import _run_marketplace_scrape
from app.utils.shutdown import ShutdownSignal
from shared.observability.sentry import init_sentry


async def run() -> None:
    configure_logging(settings.log_level)
    init_sentry(
        enabled=bool(settings.sentry_enabled),
        dsn=settings.sentry_dsn,
        environment=str(settings.environment),
        release=str(settings.sentry_release or ""),
        traces_sample_rate=float(settings.sentry_traces_sample_rate),
        profiles_sample_rate=float(settings.sentry_profiles_sample_rate),
        send_default_pii=bool(settings.sentry_send_default_pii),
        service="scraper",
        ignored_errors=list(settings.sentry_ignored_errors),
        logger=logger,
        integrations=[],
    )
    shutdown = ShutdownSignal()
    shutdown.install()

    scraper_task = asyncio.create_task(_run_marketplace_scrape())
    stop_task = asyncio.create_task(shutdown.wait())

    done, pending = await asyncio.wait({scraper_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)

    for task in pending:
        task.cancel()

    if scraper_task in done:
        await scraper_task

    if stop_task in done:
        logger.info("shutdown_signal_received")
        scraper_task.cancel()
        with suppress(asyncio.CancelledError):
            await scraper_task


if __name__ == "__main__":
    asyncio.run(run())
