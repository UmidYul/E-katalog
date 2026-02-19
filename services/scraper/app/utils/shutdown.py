import asyncio
import signal


class ShutdownSignal:
    def __init__(self) -> None:
        self._event = asyncio.Event()

    def install(self) -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, self._event.set)

    async def wait(self) -> None:
        await self._event.wait()
