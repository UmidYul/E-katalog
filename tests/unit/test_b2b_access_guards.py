from __future__ import annotations

import pytest
from fastapi import HTTPException

from services.api.app.api.v1.routers.b2b_common import ensure_b2b_actor


@pytest.mark.parametrize("role", ["admin", "moderator", "seller_support", " seller-support "])
def test_ensure_b2b_actor_rejects_platform_staff_roles(role: str) -> None:
    with pytest.raises(HTTPException) as exc:
        ensure_b2b_actor({"role": role})
    assert exc.value.status_code == 403
    assert str(exc.value.detail) == "platform staff cannot access seller b2b workspace"


def test_ensure_b2b_actor_allows_regular_user_roles() -> None:
    ensure_b2b_actor({"role": "user"})
    ensure_b2b_actor({"role": "operator"})
    ensure_b2b_actor({"role": ""})
    ensure_b2b_actor({})
