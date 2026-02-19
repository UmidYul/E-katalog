from typing import Iterable

from app.core.logging import logger
import hashlib


class EmbeddingService:
    async def compute_embedding(self, text: str) -> list[float]:
        # Stable placeholder embedding to keep deterministic behavior in tests/pipelines.
        logger.info("embedding_computed_placeholder", text_length=len(text))
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        seed = int.from_bytes(digest[:8], "big", signed=False)
        return [((seed + i * 31) % 1000) / 1000 for i in range(1536)]

    async def compute_batch(self, texts: Iterable[str]) -> list[list[float]]:
        return [await self.compute_embedding(text) for text in texts]
