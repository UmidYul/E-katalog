from services.worker.app.platform.services.embeddings import (
    batch_embeddings,
    cosine_similarity,
    embedding_backend_name,
    simple_embedding,
)


def test_simple_embedding_is_deterministic() -> None:
    a1 = simple_embedding("iphone 17 pro max 256gb deep blue", dim=32)
    a2 = simple_embedding("iphone 17 pro max 256gb deep blue", dim=32)
    b = simple_embedding("iphone 17 pro max 512gb deep blue", dim=32)
    assert a1 == a2
    assert a1 != b


def test_batch_embeddings_matches_single_calls() -> None:
    texts = ["iphone 15 128gb", "iphone 15 pro 256gb"]
    rows = batch_embeddings(texts, dim=32)
    assert len(rows) == 2
    assert rows[0] == simple_embedding(texts[0], dim=32)
    assert rows[1] == simple_embedding(texts[1], dim=32)


def test_embedding_backend_name_is_known() -> None:
    assert embedding_backend_name() in {"hashing", "fastembed"}


def test_cosine_similarity_bounds() -> None:
    a = simple_embedding("samsung s24 256gb", dim=32)
    b = simple_embedding("samsung s24 256gb", dim=32)
    c = simple_embedding("xiaomi note 13 256gb", dim=32)
    assert 0.0 <= cosine_similarity(a, c) <= 1.0
    assert cosine_similarity(a, b) >= cosine_similarity(a, c)
