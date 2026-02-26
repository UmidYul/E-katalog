from __future__ import annotations

import importlib.util
from pathlib import Path

from pydantic import BaseModel


ROOT = Path(__file__).resolve().parents[2]
B2B_SCHEMA_PATH = ROOT / "services" / "api" / "app" / "schemas" / "b2b.py"


def _load_b2b_schema_module():
    spec = importlib.util.spec_from_file_location("b2b_schema_module", B2B_SCHEMA_PATH)
    assert spec and spec.loader, f"failed to load schema module from {B2B_SCHEMA_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for model_name in ("B2BOrganizationCreateIn", "B2BSupportTicketCreateIn", "AdminB2BPlanUpsertIn"):
        candidate = getattr(module, model_name, None)
        if isinstance(candidate, type) and issubclass(candidate, BaseModel):
            candidate.model_rebuild(_types_namespace=module.__dict__)
    return module


def test_b2b_org_create_slug_pattern() -> None:
    module = _load_b2b_schema_module()
    payload = module.B2BOrganizationCreateIn(name="ACME", slug="acme-uz", legal_name="ACME LLC")
    assert payload.slug == "acme-uz"


def test_b2b_support_ticket_priority_default() -> None:
    module = _load_b2b_schema_module()
    payload = module.B2BSupportTicketCreateIn(
        org_id="11111111-1111-4111-8111-111111111111",
        subject="Need help",
        body="Feed failed",
    )
    assert payload.priority == "normal"
    assert payload.category == "technical"


def test_admin_b2b_plan_upsert_defaults() -> None:
    module = _load_b2b_schema_module()
    payload = module.AdminB2BPlanUpsertIn(
        code="pro_plus",
        name="Pro Plus",
        monthly_fee=150000,
        included_clicks=10000,
        click_price=35,
    )
    assert payload.limits == {}
