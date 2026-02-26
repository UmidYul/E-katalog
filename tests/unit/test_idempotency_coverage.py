from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
API_ROUTERS = ROOT / "services" / "api" / "app" / "api" / "v1" / "routers"


def _collect_mutating_route_lines(lines: list[str]) -> list[int]:
    result: list[int] = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("@router.") and any(token in stripped for token in ('@router.post("', '@router.patch("', '@router.delete("')):
            result.append(i)
    return result


def _has_idempotency_call_near(lines: list[str], start_index: int, window: int = 120) -> bool:
    end_index = min(len(lines), start_index + window)
    snippet = "\n".join(lines[start_index:end_index])
    return "execute_idempotent_json(" in snippet


def _assert_mutating_routes_idempotent(relative_path: str) -> None:
    path = API_ROUTERS / relative_path
    lines = path.read_text(encoding="utf-8").splitlines()
    mutating_routes = _collect_mutating_route_lines(lines)
    missing: list[str] = []
    for index in mutating_routes:
        if not _has_idempotency_call_near(lines, index):
            missing.append(f"{path}:{index + 1}")
    assert not missing, "mutating routes missing execute_idempotent_json:\n" + "\n".join(missing)


def test_users_mutating_routes_have_idempotency_wrapper() -> None:
    _assert_mutating_routes_idempotent("users.py")


def test_product_feedback_mutating_routes_have_idempotency_wrapper() -> None:
    _assert_mutating_routes_idempotent("product_feedback.py")


def test_compare_mutating_routes_have_idempotency_wrapper() -> None:
    # /compare (POST) is read-like compare computation; share creation must be idempotent.
    path = API_ROUTERS / "compare.py"
    lines = path.read_text(encoding="utf-8").splitlines()
    mutating_routes = _collect_mutating_route_lines(lines)
    missing: list[str] = []
    for index in mutating_routes:
        route_line = lines[index].strip()
        if '@router.post("/compare")' in route_line:
            continue
        if not _has_idempotency_call_near(lines, index):
            missing.append(f"{path}:{index + 1}")
    assert not missing, "mutating routes missing execute_idempotent_json:\n" + "\n".join(missing)


def test_admin_mutating_routes_have_idempotency_wrapper() -> None:
    _assert_mutating_routes_idempotent("admin.py")


def test_auth_selected_mutating_routes_have_idempotency_wrapper() -> None:
    path = API_ROUTERS / "auth.py"
    lines = path.read_text(encoding="utf-8").splitlines()
    expected_scopes = (
        "scope=\"auth.register\"",
        "scope=f\"auth.change_password:{user_id}\"",
        "scope=\"auth.password_reset.request\"",
        "scope=\"auth.password_reset.confirm\"",
        "scope=f\"auth.email_confirmation.request:{user_id}\"",
        "scope=\"auth.email_confirmation.confirm\"",
        "scope=\"auth.logout\"",
        "scope=f\"auth.sessions.revoke:{user_id}:{normalized}\"",
        "scope=f\"auth.sessions.revoke_others:{user_id}\"",
        "scope=f\"auth.2fa.disable:{user_id}\"",
    )
    source = "\n".join(lines)
    missing = [scope for scope in expected_scopes if scope not in source]
    assert not missing, "auth routes missing expected idempotency scopes:\n" + "\n".join(missing)
