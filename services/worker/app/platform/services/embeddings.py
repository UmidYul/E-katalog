from __future__ import annotations

import hashlib
import math
from typing import Iterable

try:
    from sentence_transformers import SentenceTransformer
except Exception:  # noqa: BLE001
    SentenceTransformer = None

try:
    from sklearn.metrics.pairwise import cosine_similarity as sklearn_cosine_similarity
except Exception:  # noqa: BLE001
    sklearn_cosine_similarity = None


_DEFAULT_SENTENCE_MODEL = "all-MiniLM-L6-v2"
_BACKEND_MODEL: SentenceTransformer | None = None
_BACKEND_NAME = "hashing"


def _hash_embedding(text: str, dim: int) -> list[float]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], "big", signed=False)
    return [((seed + i * 31) % 1000) / 1000 for i in range(dim)]


def _load_sentence_backend() -> None:
    global _BACKEND_MODEL, _BACKEND_NAME
    if _BACKEND_MODEL is not None or SentenceTransformer is None:
        return
    try:
        _BACKEND_MODEL = SentenceTransformer(_DEFAULT_SENTENCE_MODEL, local_files_only=True)
        _BACKEND_NAME = "sentence_transformers"
    except Exception:  # noqa: BLE001
        _BACKEND_MODEL = None
        _BACKEND_NAME = "hashing"


def simple_embedding(text: str, dim: int = 768) -> list[float]:
    _load_sentence_backend()
    if _BACKEND_MODEL is not None:
        try:
            encoded = _BACKEND_MODEL.encode([text], normalize_embeddings=True)
            return [float(item) for item in encoded[0].tolist()]
        except Exception:  # noqa: BLE001
            pass
    return _hash_embedding(text, dim)


def embedding_backend_name() -> str:
    _load_sentence_backend()
    return _BACKEND_NAME


def batch_embeddings(texts: Iterable[str], dim: int = 768) -> list[list[float]]:
    rows = [str(item) for item in texts]
    if not rows:
        return []
    _load_sentence_backend()
    if _BACKEND_MODEL is not None:
        try:
            encoded = _BACKEND_MODEL.encode(rows, normalize_embeddings=True)
            return [[float(item) for item in row.tolist()] for row in encoded]
        except Exception:  # noqa: BLE001
            pass
    return [_hash_embedding(text, dim) for text in rows]


def cosine_similarity(a: Iterable[float], b: Iterable[float]) -> float:
    a_list = list(a)
    b_list = list(b)
    if not a_list or not b_list or len(a_list) != len(b_list):
        return 0.0
    if sklearn_cosine_similarity is not None:
        try:
            return float(sklearn_cosine_similarity([a_list], [b_list])[0][0])
        except Exception:  # noqa: BLE001
            pass
    dot = sum(x * y for x, y in zip(a_list, b_list, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a_list))
    norm_b = math.sqrt(sum(y * y for y in b_list))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
