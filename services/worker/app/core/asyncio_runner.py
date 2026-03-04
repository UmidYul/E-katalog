from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from typing import TypeVar

from app.core.logging import logger
from app.db.session import engine

T = TypeVar("T")


async def _dispose_async_resources() -> None:
    await engine.dispose()


def _safe_loop_cleanup(loop: asyncio.AbstractEventLoop) -> None:
    try:
        loop.run_until_complete(_dispose_async_resources())
    except Exception as exc:  # noqa: BLE001
        logger.warning("asyncio_runner_dispose_failed", error=str(exc))
    try:
        loop.run_until_complete(loop.shutdown_asyncgens())
    except Exception as exc:  # noqa: BLE001
        logger.warning("asyncio_runner_shutdown_asyncgens_failed", error=str(exc))
    shutdown_default_executor = getattr(loop, "shutdown_default_executor", None)
    if callable(shutdown_default_executor):
        try:
            loop.run_until_complete(shutdown_default_executor())
        except Exception as exc:  # noqa: BLE001
            logger.warning("asyncio_runner_shutdown_executor_failed", error=str(exc))


def run_async_task(coro: Awaitable[T]) -> T:
    loop = asyncio.new_event_loop()
    result: T | None = None
    error: BaseException | None = None
    try:
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(coro)
        except BaseException as exc:  # noqa: BLE001
            error = exc
        finally:
            _safe_loop_cleanup(loop)
    finally:
        asyncio.set_event_loop(None)
        loop.close()

    if error is not None:
        raise error
    return result  # type: ignore[return-value]
