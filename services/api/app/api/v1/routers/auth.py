from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from app.api.deps import get_redis
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
ROLE_COOKIE = "user_role"
ACCESS_TTL_SECONDS = 60 * 15
REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _issue_token() -> str:
    return secrets.token_urlsafe(32)


def _normalize_uuid(value: str | None) -> str | None:
    candidate = str(value or "").strip()
    if not candidate:
        return None
    try:
        return str(UUID(candidate))
    except ValueError:
        return None


async def _ensure_user_uuid(redis: Redis, *, user_key: str, payload: dict[str, str]) -> str:
    normalized = _normalize_uuid(payload.get("uuid"))
    if normalized is not None:
        if payload.get("uuid") != normalized:
            await redis.hset(user_key, mapping={"uuid": normalized})
            payload["uuid"] = normalized
        return normalized

    generated = str(uuid4())
    await redis.hset(user_key, mapping={"uuid": generated})
    payload["uuid"] = generated
    return generated


async def _get_user_by_email(redis: Redis, email: str) -> dict | None:
    key = f"auth:user:email:{email.lower()}"
    user_id = await redis.get(key)
    if not user_id:
        return None
    user_key = f"auth:user:{user_id}"
    payload = await redis.hgetall(user_key)
    if not payload:
        return None
    user_uuid = await _ensure_user_uuid(redis, user_key=user_key, payload=payload)
    return {
        "id": int(payload["id"]),
        "uuid": user_uuid,
        "email": payload["email"],
        "full_name": payload["full_name"],
        "display_name": payload.get("display_name", payload["full_name"]),
        "phone": payload.get("phone", ""),
        "city": payload.get("city", ""),
        "telegram": payload.get("telegram", ""),
        "about": payload.get("about", ""),
        "updated_at": payload.get("updated_at"),
        "role": payload.get("role", "user"),
        "password_hash": payload["password_hash"],
    }


async def _set_auth_cookies(response: Response, user_id: int, redis: Redis) -> None:
    access = _issue_token()
    refresh = _issue_token()

    await redis.setex(f"auth:access:{access}", ACCESS_TTL_SECONDS, str(user_id))
    await redis.setex(f"auth:refresh:{refresh}", REFRESH_TTL_SECONDS, str(user_id))

    cookie_base = {
        "httponly": True,
        "secure": False,
        "samesite": "lax",
        "path": "/",
    }
    response.set_cookie(ACCESS_COOKIE, access, max_age=ACCESS_TTL_SECONDS, **cookie_base)
    response.set_cookie(REFRESH_COOKIE, refresh, max_age=REFRESH_TTL_SECONDS, **cookie_base)
    user = await redis.hgetall(f"auth:user:{user_id}")
    role = user.get("role", "user") if user else "user"
    response.set_cookie(ROLE_COOKIE, role, max_age=REFRESH_TTL_SECONDS, **cookie_base)


async def _resolve_user_from_access(request: Request, redis: Redis) -> dict:
    access = request.cookies.get(ACCESS_COOKIE)
    if not access:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing access token")

    user_id = await redis.get(f"auth:access:{access}")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid access token")

    user_key = f"auth:user:{user_id}"
    user = await redis.hgetall(user_key)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")
    user_uuid = await _ensure_user_uuid(redis, user_key=user_key, payload=user)

    return {
        "id": user_uuid,
        "internal_id": int(user["id"]),
        "email": user["email"],
        "full_name": user["full_name"],
        "role": user.get("role", "user"),
    }


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=150)
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=150)
    password: str = Field(min_length=8, max_length=128)


class AuthUserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str = "user"


@router.post("/register", response_model=AuthUserResponse)
async def register(payload: RegisterRequest, response: Response, redis: Redis = Depends(get_redis)):
    existing = await _get_user_by_email(redis, payload.email)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already exists")

    user_id = await redis.incr("auth:user:id")
    user_uuid = str(uuid4())
    user_key = f"auth:user:{user_id}"

    await redis.hset(
        user_key,
        mapping={
            "id": str(user_id),
            "uuid": user_uuid,
            "email": payload.email.lower(),
            "full_name": payload.full_name,
            "display_name": payload.full_name,
            "phone": "",
            "city": "",
            "telegram": "",
            "about": "",
            "updated_at": datetime.now(UTC).isoformat(),
            "role": "user",
            "password_hash": _hash_password(payload.password),
            "created_at": datetime.now(UTC).isoformat(),
        },
    )
    await redis.set(f"auth:user:email:{payload.email.lower()}", str(user_id))

    await _set_auth_cookies(response, user_id, redis)

    return AuthUserResponse(id=user_uuid, email=payload.email.lower(), full_name=payload.full_name, role="user")


@router.post("/login", response_model=AuthUserResponse)
async def login(payload: LoginRequest, response: Response, redis: Redis = Depends(get_redis)):
    user = await _get_user_by_email(redis, payload.email)
    if user is None or user["password_hash"] != _hash_password(payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    await _set_auth_cookies(response, int(user["id"]), redis)
    return AuthUserResponse(id=str(user["uuid"]), email=user["email"], full_name=user["full_name"], role=user["role"])


@router.post("/refresh")
async def refresh(request: Request, response: Response, redis: Redis = Depends(get_redis)):
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing refresh token")

    user_id = await redis.get(f"auth:refresh:{refresh_token}")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid refresh token")

    await _set_auth_cookies(response, int(user_id), redis)
    return {"ok": True}


@router.post("/logout")
async def logout(request: Request, response: Response, redis: Redis = Depends(get_redis)):
    access = request.cookies.get(ACCESS_COOKIE)
    refresh_token = request.cookies.get(REFRESH_COOKIE)

    if access:
        await redis.delete(f"auth:access:{access}")
    if refresh_token:
        await redis.delete(f"auth:refresh:{refresh_token}")

    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/")
    response.delete_cookie(ROLE_COOKIE, path="/")
    return {"ok": True}


@router.get("/me", response_model=AuthUserResponse)
async def me(request: Request, redis: Redis = Depends(get_redis)):
    user = await _resolve_user_from_access(request, redis)
    return AuthUserResponse(**user)


async def get_current_user(request: Request, redis: Redis = Depends(get_redis)) -> dict:
    return await _resolve_user_from_access(request, redis)


async def ensure_seed_admin(redis: Redis) -> dict | None:
    if not settings.admin_seed_enabled:
        return None
    if not settings.admin_email or not settings.admin_password:
        return None

    email = settings.admin_email.lower()
    existing = await _get_user_by_email(redis, email)
    if existing is not None:
        user_key = f"auth:user:{existing['id']}"
        await redis.hset(
            user_key,
            mapping={
                "full_name": settings.admin_full_name,
                "display_name": settings.admin_full_name,
                "role": settings.admin_role,
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )
        return {"id": existing["uuid"], "email": email, "full_name": settings.admin_full_name, "role": settings.admin_role}

    user_id = await redis.incr("auth:user:id")
    user_uuid = str(uuid4())
    user_key = f"auth:user:{user_id}"
    await redis.hset(
        user_key,
        mapping={
            "id": str(user_id),
            "uuid": user_uuid,
            "email": email,
            "full_name": settings.admin_full_name,
            "display_name": settings.admin_full_name,
            "phone": "",
            "city": "",
            "telegram": "",
            "about": "",
            "updated_at": datetime.now(UTC).isoformat(),
            "role": settings.admin_role,
            "password_hash": _hash_password(settings.admin_password),
            "created_at": datetime.now(UTC).isoformat(),
        },
    )
    await redis.set(f"auth:user:email:{email}", str(user_id))
    return {"id": user_uuid, "email": email, "full_name": settings.admin_full_name, "role": settings.admin_role}
