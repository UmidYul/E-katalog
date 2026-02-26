from __future__ import annotations

from collections.abc import Iterable

from fastapi import Depends, HTTPException

from app.api.v1.routers.auth import get_current_user
from app.core.config import settings


def normalize_role(role: str | None) -> str:
    return str(role or "").strip().lower().replace("-", "_")


ADMIN_ROLE = normalize_role(settings.admin_role)
STAFF_ROLES = frozenset({ADMIN_ROLE, "moderator", "seller_support"})
EDITORIAL_ROLES = frozenset({ADMIN_ROLE, "moderator"})


def _normalize_roles(roles: Iterable[str]) -> set[str]:
    return {normalize_role(role) for role in roles if normalize_role(role)}


def has_any_role(user: dict, roles: Iterable[str]) -> bool:
    allowed = _normalize_roles(roles)
    if not allowed:
        return False
    return normalize_role(user.get("role")) in allowed


def is_admin(user: dict) -> bool:
    return has_any_role(user, {ADMIN_ROLE})


def is_staff(user: dict) -> bool:
    return has_any_role(user, STAFF_ROLES)


def require_roles(*roles: str, detail: str = "insufficient permissions"):
    allowed = _normalize_roles(roles)

    def _dependency(current_user: dict = Depends(get_current_user)) -> dict:
        if not has_any_role(current_user, allowed):
            raise HTTPException(status_code=403, detail=detail)
        return current_user

    return _dependency
