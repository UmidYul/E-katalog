from __future__ import annotations

import importlib.util
from pathlib import Path

from pydantic import BaseModel


ROOT = Path(__file__).resolve().parents[2]
SELLER_SCHEMA_PATH = ROOT / "services" / "api" / "app" / "schemas" / "seller.py"


def _load_seller_schema_module():
    spec = importlib.util.spec_from_file_location("seller_schema_module", SELLER_SCHEMA_PATH)
    assert spec and spec.loader, f"failed to load schema module from {SELLER_SCHEMA_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    candidate = getattr(module, "SellerApplicationCreateIn", None)
    if isinstance(candidate, type) and issubclass(candidate, BaseModel):
        candidate.model_rebuild(_types_namespace=module.__dict__)
    return module


def _valid_payload() -> dict[str, object]:
    return {
        "shop_name": "Tech House",
        "contact_person": "Ali Valiyev",
        "legal_type": "llc",
        "inn": "123456789",
        "legal_address": "Tashkent, Yunusabad district",
        "contact_phone": "+998901112233",
        "contact_email": "sales@example.uz",
        "accepts_terms": True,
    }


def test_seller_application_requires_terms_acceptance() -> None:
    module = _load_seller_schema_module()
    payload = _valid_payload()
    payload["accepts_terms"] = False
    try:
        module.SellerApplicationCreateIn(**payload)
    except Exception as exc:  # noqa: BLE001
        assert "terms must be accepted" in str(exc)
        return
    raise AssertionError("SellerApplicationCreateIn should reject payload without terms acceptance")


def test_seller_application_requires_contact_person() -> None:
    module = _load_seller_schema_module()
    payload = _valid_payload()
    payload.pop("contact_person")
    try:
        module.SellerApplicationCreateIn(**payload)
    except Exception as exc:  # noqa: BLE001
        assert "contact_person" in str(exc)
        return
    raise AssertionError("SellerApplicationCreateIn should reject payload without contact_person")
