from __future__ import annotations

import asyncio
from contextlib import suppress

from app.core.config import settings
from app.core.logging import configure_logging, logger
from app.tasks.scrape_tasks import _run_example_store_scrape
from app.utils.shutdown import ShutdownSignal


async def run() -> None:
    configure_logging(settings.log_level)
    shutdown = ShutdownSignal()
    shutdown.install()

    scraper_task = asyncio.create_task(_run_example_store_scrape())
    stop_task = asyncio.create_task(shutdown.wait())

    done, pending = await asyncio.wait({scraper_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)

    for task in pending:
        task.cancel()

    if stop_task in done:
        logger.info("shutdown_signal_received")
        scraper_task.cancel()
        with suppress(asyncio.CancelledError):
            await scraper_task


if __name__ == "__main__":
    asyncio.run(run())
