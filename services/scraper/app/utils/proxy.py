from itertools import cycle


class ProxyRotator:
    def __init__(self, proxies: list[str] | None = None) -> None:
        self._proxies = proxies or []
        self._cycle = cycle(self._proxies) if self._proxies else None

    def next_proxy(self) -> str | None:
        if not self._cycle:
            return None
        return next(self._cycle)
