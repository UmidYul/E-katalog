from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

pytest.importorskip("fastapi")

ROOT = Path(__file__).resolve().parents[2]
API_ROOT = ROOT / "services" / "api"


def _run_api_python(script: str) -> str:
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    output = completed.stdout.strip()
    if not output:
        return ""
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    return lines[-1] if lines else ""


def _load_openapi_schema() -> dict:
    script = (
        "import json,sys;"
        f"sys.path.insert(0,{str(API_ROOT)!r});"
        "from app.main import app;"
        "print(json.dumps(app.openapi()))"
    )
    return json.loads(_run_api_python(script))


def test_openapi_contract_contains_core_auth_endpoints() -> None:
    schema = _load_openapi_schema()
    paths = schema.get("paths", {})

    expected_methods = {
        "/api/v1/auth/register": {"post"},
        "/api/v1/auth/login": {"post"},
        "/api/v1/auth/refresh": {"post"},
        "/api/v1/auth/logout": {"post"},
        "/api/v1/auth/me": {"get"},
        "/api/v1/auth/password-reset/request": {"post"},
        "/api/v1/auth/password-reset/confirm": {"post"},
        "/api/v1/auth/email-confirmation/request": {"post"},
        "/api/v1/auth/email-confirmation/confirm": {"post"},
        "/api/v1/compare/share": {"post"},
        "/api/v1/compare/share/{token}": {"get"},
        "/api/v1/products/reviews/{review_id}/votes": {"post"},
        "/api/v1/products/reviews/{review_id}/report": {"post"},
        "/api/v1/products/questions/{question_id}/report": {"post"},
        "/api/v1/products/answers/{answer_id}/pin": {"post"},
        "/api/v1/products/answers/{answer_id}/moderation": {"post"},
        "/api/v1/products/{product_id}/alerts": {"post"},
        "/api/v1/users/me/alerts": {"get"},
        "/api/v1/users/me/alerts/{alert_id}": {"delete"},
    }
    for path, methods in expected_methods.items():
        assert path in paths
        assert methods.issubset(set(paths[path].keys()))


def test_openapi_contract_api_version_prefix_and_operation_ids() -> None:
    schema = _load_openapi_schema()
    paths = schema.get("paths", {})

    assert paths, "OpenAPI schema must expose at least one path"
    assert all(path.startswith("/api/v1/") for path in paths.keys())

    operation_ids: list[str] = []
    for path_item in paths.values():
        for operation in path_item.values():
            operation_id = str(operation.get("operationId", "")).strip()
            assert operation_id, "operationId is required for contract stability"
            operation_ids.append(operation_id)
    assert len(operation_ids) == len(set(operation_ids)), "operationId values must be unique"


def test_api_version_header_is_set_for_api_routes() -> None:
    script = (
        "import json,sys;"
        f"sys.path.insert(0,{str(API_ROOT)!r});"
        "from fastapi.testclient import TestClient;"
        "from app.main import app;"
        "client=TestClient(app);"
        "response=client.get('/api/v1/health');"
        "print(json.dumps({'status': response.status_code, 'version': response.headers.get('X-API-Version')}))"
    )
    payload = json.loads(_run_api_python(script))
    assert int(payload.get("status", 0)) == 200
    assert str(payload.get("version", "")).strip() == "v1"


def test_api_version_header_respects_config_override() -> None:
    script = (
        "import json,os,sys;"
        "os.environ['API_VERSION_HEADER_VALUE']='2026.02';"
        f"sys.path.insert(0,{str(API_ROOT)!r});"
        "from fastapi.testclient import TestClient;"
        "from app.main import app;"
        "client=TestClient(app);"
        "response=client.get('/api/v1/health');"
        "print(json.dumps({'status': response.status_code, 'version': response.headers.get('X-API-Version')}))"
    )
    payload = json.loads(_run_api_python(script))
    assert int(payload.get("status", 0)) == 200
    assert str(payload.get("version", "")).strip() == "2026.02"


def test_api_version_header_not_added_outside_api_prefix() -> None:
    script = (
        "import json,sys;"
        f"sys.path.insert(0,{str(API_ROOT)!r});"
        "from fastapi.testclient import TestClient;"
        "from app.main import app;"
        "client=TestClient(app);"
        "response=client.get('/docs');"
        "print(json.dumps({'status': response.status_code, 'version': response.headers.get('X-API-Version')}))"
    )
    payload = json.loads(_run_api_python(script))
    assert int(payload.get("status", 0)) == 200
    assert payload.get("version") is None


def test_security_headers_are_set_for_api_routes() -> None:
    script = (
        "import json,sys;"
        f"sys.path.insert(0,{str(API_ROOT)!r});"
        "from fastapi.testclient import TestClient;"
        "from app.main import app;"
        "client=TestClient(app);"
        "response=client.get('/api/v1/health');"
        "print(json.dumps({"
        "'status': response.status_code,"
        "'x_frame_options': response.headers.get('X-Frame-Options'),"
        "'x_content_type_options': response.headers.get('X-Content-Type-Options'),"
        "'referrer_policy': response.headers.get('Referrer-Policy'),"
        "'permissions_policy': response.headers.get('Permissions-Policy'),"
        "'content_security_policy': response.headers.get('Content-Security-Policy')"
        "}))"
    )
    payload = json.loads(_run_api_python(script))
    assert int(payload.get("status", 0)) == 200
    assert payload.get("x_frame_options") == "DENY"
    assert payload.get("x_content_type_options") == "nosniff"
    assert str(payload.get("referrer_policy", "")).strip()
    assert str(payload.get("permissions_policy", "")).strip()
    assert str(payload.get("content_security_policy", "")).strip()


def test_hsts_header_is_set_in_production_environment() -> None:
    script = (
        "import json,os,sys;"
        "os.environ['ENVIRONMENT']='production';"
        f"sys.path.insert(0,{str(API_ROOT)!r});"
        "from fastapi.testclient import TestClient;"
        "from app.main import app;"
        "client=TestClient(app);"
        "response=client.get('/api/v1/health');"
        "print(json.dumps({'status': response.status_code, 'hsts': response.headers.get('Strict-Transport-Security')}))"
    )
    payload = json.loads(_run_api_python(script))
    assert int(payload.get("status", 0)) == 200
    assert str(payload.get("hsts", "")).strip()


def test_openapi_contract_operations_have_tags_and_responses() -> None:
    schema = _load_openapi_schema()
    paths = schema.get("paths", {})
    assert paths

    for path, path_item in paths.items():
        for method, operation in path_item.items():
            assert method in {"get", "post", "put", "patch", "delete", "options", "head", "trace"}
            tags = operation.get("tags")
            assert isinstance(tags, list) and tags, f"missing tags for {method.upper()} {path}"
            responses = operation.get("responses")
            assert isinstance(responses, dict) and responses, f"missing responses for {method.upper()} {path}"


def test_compare_share_create_contract_includes_telemetry_source() -> None:
    schema = _load_openapi_schema()
    path_item = schema.get("paths", {}).get("/api/v1/compare/share", {})
    post_op = path_item.get("post", {})
    body_schema = (
        post_op.get("requestBody", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
    )
    schema_ref = str(body_schema.get("$ref", ""))
    assert schema_ref, "compare/share request body schema ref is required"
    component_name = schema_ref.rsplit("/", 1)[-1]
    component = schema.get("components", {}).get("schemas", {}).get(component_name, {})
    props = component.get("properties", {})
    telemetry_source = props.get("telemetry_source", {})
    if telemetry_source.get("type") == "string":
        assert int(telemetry_source.get("maxLength", 0)) == 64
        assert int(telemetry_source.get("minLength", 0)) == 2
        return

    any_of = telemetry_source.get("anyOf")
    assert isinstance(any_of, list) and any_of, "telemetry_source must be represented as string or nullable string"
    string_variant = next((item for item in any_of if isinstance(item, dict) and item.get("type") == "string"), None)
    assert isinstance(string_variant, dict), "telemetry_source anyOf must include string variant"
    assert int(string_variant.get("maxLength", 0)) == 64
    assert int(string_variant.get("minLength", 0)) == 2


def test_product_offers_sort_contract_supports_best_value() -> None:
    schema = _load_openapi_schema()
    get_op = schema.get("paths", {}).get("/api/v1/products/{product_id}/offers", {}).get("get", {})
    parameters = get_op.get("parameters", [])
    sort_param = next((param for param in parameters if str(param.get("name")) == "sort"), None)
    assert sort_param is not None
    pattern = str(sort_param.get("schema", {}).get("pattern", ""))
    assert "best_value" in pattern
