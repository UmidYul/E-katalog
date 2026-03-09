from __future__ import annotations

import hashlib
import math
from typing import Iterable

from shared.config.settings import settings

try:
    from fastembed import TextEmbedding
except Exception:  # noqa: BLE001
    TextEmbedding = None

try:
    from sklearn.metrics.pairwise import cosine_similarity as sklearn_cosine_similarity
except Exception:  # noqa: BLE001
    sklearn_cosine_similarity = None


_DEFAULT_EMBEDDING_DIM = 768
_DEFAULT_FASTEMBED_MODEL = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
_FASTEMBED_MODEL_ALIASES = (
    _DEFAULT_FASTEMBED_MODEL,
    "paraphrase-multilingual-mpnet-base-v2",
)

_BACKEND_NAME = "hashing"
_BACKEND_MODEL: TextEmbedding | None = None
_BACKEND_MODEL_NAME = "hashing"
_BACKEND_INITIALIZED = False


def _target_dim(dim: int | None) -> int:
    if isinstance(dim, int) and dim > 0:
        return int(dim)
    configured = int(getattr(settings, "embedding_dimension", _DEFAULT_EMBEDDING_DIM) or _DEFAULT_EMBEDDING_DIM)
    return max(1, configured)


def _candidate_models() -> list[str]:
    configured = str(getattr(settings, "embedding_model_name", "") or "").strip()
    models: list[str] = []
    for candidate in (configured, *_FASTEMBED_MODEL_ALIASES):
        if not candidate:
            continue
        if candidate in models:
            continue
        models.append(candidate)
    return models


def _fastembed_enabled() -> bool:
    raw = getattr(settings, "embedding_use_fastembed", False)
    if isinstance(raw, bool):
        return raw
    value = str(raw or "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _ensure_backend_initialized() -> None:
    global _BACKEND_INITIALIZED, _BACKEND_MODEL, _BACKEND_NAME, _BACKEND_MODEL_NAME
    if _BACKEND_INITIALIZED:
        return
    _BACKEND_INITIALIZED = True
    if TextEmbedding is None or not _fastembed_enabled():
        _BACKEND_MODEL = None
        _BACKEND_NAME = "hashing"
        _BACKEND_MODEL_NAME = "hashing"
        return
    for model_name in _candidate_models():
        try:
            _BACKEND_MODEL = TextEmbedding(model_name=model_name)
            _BACKEND_NAME = "fastembed"
            _BACKEND_MODEL_NAME = model_name
            return
        except Exception:  # noqa: BLE001
            _BACKEND_MODEL = None
            _BACKEND_NAME = "hashing"
            _BACKEND_MODEL_NAME = "hashing"


def _hash_embedding(text: str, dim: int) -> list[float]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], "big", signed=False)
    return [((seed + i * 31) % 1000) / 1000 for i in range(dim)]


def _to_float_vector(raw: object) -> list[float]:
    if hasattr(raw, "tolist"):
        return [float(item) for item in raw.tolist()]
    return [float(item) for item in raw]  # type: ignore[arg-type]


def _resize_vector(vector: list[float], dim: int) -> list[float]:
    current_dim = len(vector)
    if current_dim == dim:
        return vector
    if current_dim > dim:
        return vector[:dim]
    return vector + [0.0] * (dim - current_dim)


def _embed_with_backend(rows: list[str], dim: int) -> list[list[float]] | None:
    _ensure_backend_initialized()
    if _BACKEND_MODEL is None:
        return None
    try:
        vectors = list(_BACKEND_MODEL.embed(rows))
    except Exception:  # noqa: BLE001
        return None
    if len(vectors) != len(rows):
        return None
    return [_resize_vector(_to_float_vector(vector), dim) for vector in vectors]


def embedding_backend_name() -> str:
    return _BACKEND_NAME


def embedding_model_name() -> str:
    return _BACKEND_MODEL_NAME


def embedding_dimension() -> int:
    return _target_dim(None)


def simple_embedding(text: str, dim: int | None = None) -> list[float]:
    target_dim = _target_dim(dim)
    embedded = _embed_with_backend([text], target_dim)
    if embedded is not None:
        return embedded[0]
    return _hash_embedding(text, target_dim)


def batch_embeddings(texts: Iterable[str], dim: int | None = None) -> list[list[float]]:
    rows = [str(item) for item in texts]
    if not rows:
        return []
    target_dim = _target_dim(dim)
    embedded = _embed_with_backend(rows, target_dim)
    if embedded is not None:
        return embedded
    return [_hash_embedding(text, target_dim) for text in rows]


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
