from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from app.api.deps import get_redis

router = APIRouter(prefix="/auth", tags=["auth"])

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
ACCESS_TTL_SECONDS = 60 * 15
REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _issue_token() -> str:
    return secrets.token_urlsafe(32)


async def _get_user_by_email(redis: Redis, email: str) -> dict | None:
    key = f"auth:user:email:{email.lower()}"
    user_id = await redis.get(key)
    if not user_id:
        return None
    payload = await redis.hgetall(f"auth:user:{user_id}")
    if not payload:
        return None
    return {
        "id": int(payload["id"]),
        "email": payload["email"],
        "full_name": payload["full_name"],
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


async def _resolve_user_from_access(request: Request, redis: Redis) -> dict:
    access = request.cookies.get(ACCESS_COOKIE)
    if not access:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing access token")

    user_id = await redis.get(f"auth:access:{access}")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid access token")

    user = await redis.hgetall(f"auth:user:{user_id}")
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")

    return {"id": int(user["id"]), "email": user["email"], "full_name": user["full_name"]}


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=150)
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=150)
    password: str = Field(min_length=8, max_length=128)


class AuthUserResponse(BaseModel):
    id: int
    email: str
    full_name: str


@router.post("/register", response_model=AuthUserResponse)
async def register(payload: RegisterRequest, response: Response, redis: Redis = Depends(get_redis)):
    existing = await _get_user_by_email(redis, payload.email)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already exists")

    user_id = await redis.incr("auth:user:id")
    user_key = f"auth:user:{user_id}"

    await redis.hset(
        user_key,
        mapping={
            "id": str(user_id),
            "email": payload.email.lower(),
            "full_name": payload.full_name,
            "password_hash": _hash_password(payload.password),
            "created_at": datetime.now(UTC).isoformat(),
        },
    )
    await redis.set(f"auth:user:email:{payload.email.lower()}", str(user_id))

    await _set_auth_cookies(response, user_id, redis)

    return AuthUserResponse(id=user_id, email=payload.email.lower(), full_name=payload.full_name)


@router.post("/login", response_model=AuthUserResponse)
async def login(payload: LoginRequest, response: Response, redis: Redis = Depends(get_redis)):
    user = await _get_user_by_email(redis, payload.email)
    if user is None or user["password_hash"] != _hash_password(payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    await _set_auth_cookies(response, int(user["id"]), redis)
    return AuthUserResponse(id=int(user["id"]), email=user["email"], full_name=user["full_name"])


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
    return {"ok": True}


@router.get("/me", response_model=AuthUserResponse)
async def me(request: Request, redis: Redis = Depends(get_redis)):
    user = await _resolve_user_from_access(request, redis)
    return AuthUserResponse(**user)


async def get_current_user(request: Request, redis: Redis = Depends(get_redis)) -> dict:
    return await _resolve_user_from_access(request, redis)
