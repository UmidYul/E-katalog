from services.worker.app.platform.services.embeddings import simple_embedding


def test_simple_embedding_is_deterministic() -> None:
    a1 = simple_embedding("iphone 17 pro max 256gb deep blue", dim=32)
    a2 = simple_embedding("iphone 17 pro max 256gb deep blue", dim=32)
    b = simple_embedding("iphone 17 pro max 512gb deep blue", dim=32)
    assert a1 == a2
    assert a1 != b
