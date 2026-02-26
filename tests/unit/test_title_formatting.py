from services.api.app.repositories.catalog import format_product_title


def test_format_product_title_removes_noise_for_apple() -> None:
    value = format_product_title("itec - купить apple iphone air 256 гб esim", brand_name="Apple")
    assert value == "Apple iPhone Air 256GB eSIM"


def test_format_product_title_for_samsung_with_ram_storage() -> None:
    value = format_product_title("samsung galaxy s25 ultra 12/256 гб", brand_name="Samsung")
    assert value == "Samsung Galaxy S25 Ultra 12/256GB"


def test_format_product_title_uses_specs_when_missing_in_title() -> None:
    value = format_product_title(
        "apple iphone 17 pro",
        brand_name="Apple",
        specs={"storage_gb": "512", "ram_gb": "12", "sim_type": "eSIM"},
    )
    assert value == "Apple iPhone 17 Pro 12/512GB eSIM"


def test_format_product_title_adds_ram_from_specs_when_title_has_only_storage() -> None:
    value = format_product_title(
        "Apple iPhone 15 Plus 256GB",
        brand_name="Apple",
        specs={"оперативная память": "6 ГБ"},
    )
    assert value == "Apple iPhone 15 Plus 6/256GB"


def test_format_product_title_supports_mixed_memory_spec() -> None:
    value = format_product_title(
        "Samsung Galaxy S25 Ultra 256GB",
        brand_name="Samsung",
        specs={"Конфигурация памяти": "12/256 ГБ"},
    )
    assert value == "Samsung Galaxy S25 Ultra 12/256GB"


def test_format_product_title_supports_russian_ram_key() -> None:
    value = format_product_title(
        "Apple iPhone 15 Plus 256 \u0413\u0411",
        brand_name="Apple",
        specs={"\u043e\u043f\u0435\u0440\u0430\u0442\u0438\u0432\u043d\u0430\u044f \u043f\u0430\u043c\u044f\u0442\u044c": "6 \u0413\u0411"},
    )
    assert value == "Apple iPhone 15 Plus 6/256GB"


def test_format_product_title_supports_russian_memory_config_key() -> None:
    value = format_product_title(
        "Samsung Galaxy S25 Ultra 256 \u0413\u0411",
        brand_name="Samsung",
        specs={"\u041a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u044f \u043f\u0430\u043c\u044f\u0442\u0438": "12/256 \u0413\u0411"},
    )
    assert value == "Samsung Galaxy S25 Ultra 12/256GB"


def test_format_product_title_supports_non_apple_samsung_brand_and_32gb() -> None:
    value = format_product_title(
        "Купить Xiaomi Redmi A3 32 гб dual sim",
        brand_name="Xiaomi",
    )
    assert value == "Xiaomi Redmi A3 32GB"
