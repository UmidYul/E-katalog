from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass

from app.platform.services.canonical_matching import extract_attributes
from app.platform.services.normalization import build_canonical_title, detect_brand


ZWSP = "\u200b"
NBSP = "\u00a0"


@dataclass(frozen=True)
class AuditCase:
    case_id: str
    expected_brand: str
    title: str
    note: str


def _base_titles() -> dict[str, str]:
    return {
        "apple": "Apple iPhone 15 Pro 256GB",
        "samsung": "Samsung Galaxy S24 Ultra 512GB",
        "xiaomi": "Xiaomi Redmi Note 13 Pro 256GB",
        "huawei": "Huawei P60 Pro 256GB",
        "honor": "Honor 200 Pro 512GB",
        "google": "Google Pixel 9 Pro 256GB",
        "oneplus": "OnePlus 12 256GB",
        "nothing": "Nothing Phone 2a 128GB",
    }


def _baseline_cases() -> list[AuditCase]:
    rows: list[AuditCase] = []
    for brand, title in _base_titles().items():
        rows.append(AuditCase(f"{brand}_clean", brand, title, "baseline"))
        rows.append(AuditCase(f"{brand}_lower", brand, title.lower(), "lowercase"))
        rows.append(AuditCase(f"{brand}_nbsp", brand, title.replace(" ", NBSP), "nbsp separators"))
        rows.append(AuditCase(f"{brand}_zwsp", brand, title.replace(" ", ZWSP), "zero-width separators"))
        rows.append(AuditCase(f"{brand}_dash", brand, title.replace(" ", "-"), "dash separators"))
    return rows


def _adversarial_cases() -> list[AuditCase]:
    return [
        AuditCase("apple_ap1e", "apple", "App1e iPhone 15 Pro 256GB", "leet in brand"),
        AuditCase("apple_aple", "apple", "Aple iPhone 15 Pro 256GB", "single-char deletion"),
        AuditCase("apple_cyr", "apple", "\u0410\u0440\u0440\u04cf\u0435 iPhone 15 Pro 256GB", "cyrillic homoglyphs in brand"),
        AuditCase("samsung_5", "samsung", "5amsung Galaxy S24 Ultra 512GB", "leading digit substitution"),
        AuditCase("samsung_cyr_a", "samsung", "Sаmsung Galaxy S24 Ultra 512GB", "cyrillic a in brand"),
        AuditCase("samsung_galaxi", "samsung", "Samsung Galaxi S24 Ultra 512GB", "model family typo"),
        AuditCase("xiaomi_x1", "xiaomi", "X1aomi Redmi Note 13 Pro 256GB", "digit substitution"),
        AuditCase("xiaomi_redm1", "xiaomi", "Xiaomi Redm1 Note 13 Pro 256GB", "model token typo"),
        AuditCase("google_g00gle", "google", "G00gle Pixel 9 Pro 256GB", "double leet"),
        AuditCase("google_p1xel", "google", "Google P1xel 9 Pro 256GB", "model token typo"),
        AuditCase("oneplus_split", "oneplus", "One Plus 12 256GB", "tokenized alias"),
        AuditCase("oneplus_cyr", "oneplus", "\u041enePlus 12 256GB", "mixed cyr/lat in brand"),
        AuditCase("nothing_n0thing", "nothing", "N0thing Phone 2a 128GB", "digit substitution"),
        AuditCase("honor_h0nor", "honor", "H0nor 200 Pro 512GB", "digit substitution"),
        AuditCase("huawei_huawel", "huawei", "Huawel P60 Pro 256GB", "l/i typo"),
        AuditCase("cross_brand_pollution", "apple", "Samsung case for Apple iPhone 15 Pro 256GB", "multi-brand noisy title"),
        AuditCase("accessory_noise", "samsung", "Case for Samsung Galaxy S24 Ultra 512GB", "accessory prefix"),
        AuditCase("double_brand", "xiaomi", "Xiaomi Redmi Note 13 Pro 256GB Samsung style", "competitor brand token"),
    ]


def run_audit() -> dict[str, object]:
    cases = _baseline_cases() + _adversarial_cases()
    issues: list[dict[str, object]] = []
    for case in cases:
        detected = detect_brand(case.title)
        attrs = extract_attributes(case.title)
        canonical = build_canonical_title(case.title)
        detect_ok = detected == case.expected_brand
        extract_ok = attrs.brand == case.expected_brand
        broken_card_risk = attrs.brand == "unknown" or attrs.model == "unknown" or attrs.storage == "unknown"
        if detect_ok and extract_ok and not broken_card_risk:
            continue
        issues.append(
            {
                "case": asdict(case),
                "detected_brand": detected,
                "extracted_brand": attrs.brand,
                "extracted_model": attrs.model,
                "extracted_storage": attrs.storage,
                "extracted_variant": attrs.variant,
                "canonical_title": canonical,
                "flags": {
                    "detect_brand_miss": not detect_ok,
                    "extract_attributes_miss": not extract_ok,
                    "broken_card_risk": broken_card_risk,
                },
            }
        )
    return {
        "total_cases": len(cases),
        "issues_found": len(issues),
        "issue_rate": round(len(issues) / max(len(cases), 1), 3),
        "issues": issues,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Adversarial brand/title audit for scraper normalization pipeline.")
    parser.add_argument("--json", action="store_true", help="Print JSON report (default).")
    args = parser.parse_args()
    report = run_audit()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
