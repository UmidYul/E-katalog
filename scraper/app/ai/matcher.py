from typing import Iterable


class MatcherService:
    def find_candidates(self, embedding: list[float], pool: Iterable[list[float]], threshold: float = 0.85) -> list[int]:
        # Placeholder for pgvector cosine similarity search integration.
        return [idx for idx, candidate in enumerate(pool) if candidate and len(candidate) == len(embedding) and threshold <= 1.0]
