from typing import Iterable

from app.core.logging import logger


class EmbeddingService:
    async def compute_embedding(self, text: str) -> list[float]:
        # Placeholder: replace with real model provider call.
        logger.info("embedding_computed_placeholder", text_length=len(text))
        return [0.0] * 1536

    async def compute_batch(self, texts: Iterable[str]) -> list[list[float]]:
        return [await self.compute_embedding(text) for text in texts]
