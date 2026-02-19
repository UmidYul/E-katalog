from itertools import combinations

from services.worker.app.platform.services.normalization import build_canonical_title


def _pair_metrics(labels_true: list[str], labels_pred: list[str]) -> dict[str, float]:
    tp = fp = fn = tn = 0
    for i, j in combinations(range(len(labels_true)), 2):
        same_true = labels_true[i] == labels_true[j]
        same_pred = labels_pred[i] == labels_pred[j]
        if same_true and same_pred:
            tp += 1
        elif not same_true and same_pred:
            fp += 1
        elif same_true and not same_pred:
            fn += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 1.0
    false_merge_rate = fp / (fp + tn) if (fp + tn) else 0.0
    false_split_rate = fn / (fn + tp) if (fn + tp) else 0.0
    return {
        "precision": precision,
        "recall": recall,
        "false_merge_rate": false_merge_rate,
        "false_split_rate": false_split_rate,
    }


def _generate_iphone_variants() -> list[tuple[str, str]]:
    # 50 variants of one canonical family: iphone 17 pro max 256gb cosmic orange
    base = "iphone_17_pro_max_256_cosmic_orange"
    titles: list[tuple[str, str]] = []
    patterns = [
        "Apple iPhone 17 Pro Max 12/256GB Cosmic Orange",
        "apple iphone 17 pro max 256gb cosmic orange",
        "Iphone17 Pro Max 256gb cosmic orange",
        "Apple iPhone 17 Pro Max 12256GB cosmic orange",
        "Смартфон Apple iPhone 17 Pro Max 256GB Cosmic Orange",
    ]
    for idx in range(50):
        titles.append((patterns[idx % len(patterns)], base))
    return titles


def _generate_samsung_variants() -> list[tuple[str, str]]:
    # 50 variants of one canonical family: galaxy s24 ultra 512gb titanium black
    base = "samsung_s24_ultra_512_titanium_black"
    titles: list[tuple[str, str]] = []
    patterns = [
        "Samsung Galaxy S24 Ultra 12/512GB Titanium Black",
        "samsung galaxy s24 ultra 512gb titanium black",
        "Galaxy S24 Ultra 512GB Titanium Black",
        "Samsung Galaxy S24Ultra 12512GB Titanium Black",
        "Смартфон Samsung Galaxy S24 Ultra 512GB Titanium Black",
    ]
    for idx in range(50):
        titles.append((patterns[idx % len(patterns)], base))
    return titles


def _generate_edge_cases() -> list[tuple[str, str]]:
    cases = [
        ("Apple iPhone 17 Pro 256GB Deep Blue", "iphone17pro_256_deep_blue"),
        ("Apple iPhone 17 Pro 256GB Cosmic Orange", "iphone17pro_256_cosmic_orange"),
        ("Apple iPhone 17 Pro Max 256GB Deep Blue", "iphone17promax_256_deep_blue"),
        ("Apple iPhone 17 128GB White", "iphone17_128_white"),
        ("Apple iPhone 13 128GB Midnight", "iphone13_128_midnight"),
        ("Apple iPhone 13 128 GB Black", "iphone13_128_black"),
        ("Iphone13 128gb", "iphone13_128_unknown"),
        ("Samsung Galaxy S24 256GB Gray", "s24_256_gray"),
        ("Samsung Galaxy S24+ 256GB Gray", "s24plus_256_gray"),
        ("Samsung Galaxy S24 Ultra 256GB Gray", "s24ultra_256_gray"),
        ("Xiaomi 14T Pro 12/512GB Black", "xiaomi14tpro_512_black"),
        ("Xiaomi 14T 12/512GB Black", "xiaomi14t_512_black"),
        ("Google Pixel 9 Pro 256GB Hazel", "pixel9pro_256_hazel"),
        ("Google Pixel 9 256GB Hazel", "pixel9_256_hazel"),
        ("Honor 200 12/256GB Green", "honor200_256_green"),
        ("Honor 200 Pro 12/256GB Green", "honor200pro_256_green"),
        ("OnePlus 12 16/512GB Black", "oneplus12_512_black"),
        ("OnePlus 12R 16/512GB Black", "oneplus12r_512_black"),
        ("Nothing Phone 2 12/256GB White", "nothing2_256_white"),
        ("Nothing Phone 2a 12/256GB White", "nothing2a_256_white"),
    ]
    return cases


def test_canonical_matching_quality_metrics() -> None:
    dataset = _generate_iphone_variants() + _generate_samsung_variants() + _generate_edge_cases()
    titles = [row[0] for row in dataset]
    y_true = [row[1] for row in dataset]
    y_pred = [build_canonical_title(title) for title in titles]

    metrics = _pair_metrics(y_true, y_pred)

    assert metrics["precision"] >= 0.90
    assert metrics["recall"] >= 0.88
    assert metrics["false_merge_rate"] <= 0.05
    assert metrics["false_split_rate"] <= 0.12
