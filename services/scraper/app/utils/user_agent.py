from itertools import cycle


class UserAgentRotator:
    def __init__(self, user_agents: list[str]) -> None:
        if not user_agents:
            raise ValueError("user_agents cannot be empty")
        self._cycle = cycle(user_agents)

    def next(self) -> str:
        return next(self._cycle)
