from services.api.app.schemas.catalog import CanonicalProductDetailOut


def test_product_detail_schema_copy_fields_defaults() -> None:
    payload = CanonicalProductDetailOut(
        id="test-product-id",
        title="Product",
        category="Category",
        specs={},
        offers_by_store=[],
    )
    assert payload.short_description is None
    assert payload.whats_new == []
