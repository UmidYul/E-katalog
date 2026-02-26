from __future__ import annotations

from typing import Iterable

from fastapi import HTTPException

from app.repositories.b2b import B2BRepository
from app.core.config import settings


B2B_WRITE_ROLES = {"owner", "admin", "marketing", "finance"}


def _normalize_roles(roles: Iterable[str] | None) -> set[str]:
    if roles is None:
        return set()
    return {str(role).strip().lower() for role in roles if str(role).strip()}


async def resolve_org_context(
    repo: B2BRepository,
    *,
    user_uuid: str,
    org_id: str | None,
    allowed_roles: Iterable[str] | None = None,
) -> tuple[int, str, str]:
    memberships, organizations = await repo.list_user_orgs(user_uuid=user_uuid)
    if not memberships:
        raise HTTPException(status_code=403, detail="no b2b organization membership")

    target_org_uuid = str(org_id or memberships[0]["org_id"]).strip().lower()
    selected_membership = next((item for item in memberships if str(item.get("org_id", "")).lower() == target_org_uuid), None)
    if not selected_membership:
        raise HTTPException(status_code=403, detail="organization membership not found")
    if str(selected_membership.get("status", "")).lower() != "active":
        raise HTTPException(status_code=403, detail="organization membership is not active")

    selected_org = next((item for item in organizations if str(item.get("id", "")).lower() == target_org_uuid), None)
    if not selected_org:
        raise HTTPException(status_code=404, detail="organization not found")

    allowed = _normalize_roles(allowed_roles)
    membership_role = str(selected_membership.get("role", "")).lower()
    if allowed and membership_role not in allowed:
        raise HTTPException(status_code=403, detail="insufficient b2b role")

    resolved_org_id = await repo.resolve_org_id(target_org_uuid)
    if resolved_org_id is None:
        raise HTTPException(status_code=404, detail="organization not found")

    return resolved_org_id, target_org_uuid, membership_role


def ensure_b2b_enabled() -> None:
    if not bool(settings.b2b_enabled):
        raise HTTPException(status_code=404, detail="b2b is disabled")
