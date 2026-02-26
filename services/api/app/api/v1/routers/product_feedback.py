from __future__ import annotations

import json
import hashlib
import re
from datetime import datetime
from shared.utils.time import UTC
from time import time

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.rbac import ADMIN_ROLE, STAFF_ROLES, require_roles
from app.api.v1.routers.auth import get_current_user
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.catalog import CatalogRepository
from app.schemas.catalog import (
    ProductAnswerCreate,
    ProductAnswerPinIn,
    ProductAnswerPinOut,
    ProductAnswerOut,
    ProductFeedbackReportIn,
    ProductFeedbackReportOut,
    ProductFeedbackModerationIn,
    ProductFeedbackModerationOut,
    ProductFeedbackQueueItem,
    ProductFeedbackQueueOut,
    ProductQuestionCreate,
    ProductQuestionOut,
    ProductReviewCreate,
    ProductReviewVoteIn,
    ProductReviewVoteOut,
    ProductReviewOut,
)

router = APIRouter(prefix="/products", tags=["product-feedback"])
UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
REVIEW_IP_COOLDOWN_SECONDS = 45
REVIEW_AUTHOR_COOLDOWN_SECONDS = 300
REVIEW_AUTHOR_DAILY_LIMIT = 3
REVIEW_DUPLICATE_WINDOW_SECONDS = 30 * 24 * 3600
REVIEW_DAILY_COUNTER_TTL_SECONDS = 2 * 24 * 3600
FEEDBACK_REPORT_EVENTS_LIMIT = 100


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _review_key(review_id: str) -> str:
    return f"feedback:review:{review_id}"


def _question_key(question_id: str) -> str:
    return f"feedback:question:{question_id}"


def _answer_key(answer_id: str) -> str:
    return f"feedback:answer:{answer_id}"


def _reviews_index_key(product_id: int) -> str:
    return f"feedback:product:{product_id}:reviews"


def _questions_index_key(product_id: int) -> str:
    return f"feedback:product:{product_id}:questions"


def _answers_index_key(question_id: str) -> str:
    return f"feedback:question:{question_id}:answers"


def _review_votes_key(review_id: str) -> str:
    return f"feedback:review:{review_id}:votes"


def _review_reports_actors_key(review_id: str) -> str:
    return f"feedback:review:{review_id}:report:actors"


def _review_reports_events_key(review_id: str) -> str:
    return f"feedback:review:{review_id}:report:events"


def _question_reports_actors_key(question_id: str) -> str:
    return f"feedback:question:{question_id}:report:actors"


def _question_reports_events_key(question_id: str) -> str:
    return f"feedback:question:{question_id}:report:events"


def _normalize_whitespace(value: str) -> str:
    return " ".join(value.split())


def _normalized_author_key(author: str) -> str:
    normalized = _normalize_whitespace(author).strip().lower()
    normalized = re.sub(r"[^\w]+", "-", normalized, flags=re.UNICODE)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized or "unknown"


def _comment_fingerprint(comment: str) -> str:
    normalized = _normalize_whitespace(comment).strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _request_ip(request: Request) -> str:
    x_forwarded_for = request.headers.get("x-forwarded-for")
    if x_forwarded_for:
        ip = x_forwarded_for.split(",", maxsplit=1)[0].strip()
        if ip:
            return ip
    x_real_ip = request.headers.get("x-real-ip")
    if x_real_ip and x_real_ip.strip():
        return x_real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _request_ip_fingerprint(request: Request) -> str:
    ip = _request_ip(request)
    if ip == "unknown":
        return ip
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()[:24]


def _review_ip_cooldown_key(product_id: int, client_fingerprint: str) -> str:
    return f"feedback:review:cooldown:ip:{client_fingerprint}:product:{product_id}"


def _review_author_cooldown_key(product_id: int, author_key: str) -> str:
    return f"feedback:review:cooldown:author:{author_key}:product:{product_id}"


def _review_duplicate_author_key(product_id: int, author_key: str, fingerprint: str) -> str:
    return f"feedback:review:dup:author:{author_key}:product:{product_id}:hash:{fingerprint}"


def _review_duplicate_ip_key(product_id: int, client_fingerprint: str, fingerprint: str) -> str:
    return f"feedback:review:dup:ip:{client_fingerprint}:product:{product_id}:hash:{fingerprint}"


def _review_author_daily_counter_key(product_id: int, author_key: str) -> str:
    day = datetime.now(UTC).strftime("%Y%m%d")
    return f"feedback:review:daily:{day}:author:{author_key}:product:{product_id}"


async def _enforce_review_antispam(
    redis: Redis,
    *,
    request: Request,
    product_legacy_id: int,
    author: str,
    comment: str,
) -> None:
    author_key = _normalized_author_key(author)
    comment_hash = _comment_fingerprint(comment)
    client_fingerprint = _request_ip_fingerprint(request)

    ip_cooldown_key = None
    if client_fingerprint != "unknown":
        ip_cooldown_key = _review_ip_cooldown_key(product_legacy_id, client_fingerprint)
        ip_ttl = await redis.ttl(ip_cooldown_key)
        if ip_ttl and ip_ttl > 0:
            raise HTTPException(
                status_code=429,
                detail=f"too many review attempts from this IP, wait {ip_ttl} seconds",
            )

    author_cooldown_key = _review_author_cooldown_key(product_legacy_id, author_key)
    author_ttl = await redis.ttl(author_cooldown_key)
    if author_ttl and author_ttl > 0:
        raise HTTPException(
            status_code=429,
            detail=f"please wait {author_ttl} seconds before posting another review for this product",
        )

    duplicate_author_key = _review_duplicate_author_key(product_legacy_id, author_key, comment_hash)
    duplicate_author_exists = await redis.exists(duplicate_author_key)
    if duplicate_author_exists:
        raise HTTPException(status_code=409, detail="duplicate review text from this author for this product")

    duplicate_ip_key = None
    if client_fingerprint != "unknown":
        duplicate_ip_key = _review_duplicate_ip_key(product_legacy_id, client_fingerprint, comment_hash)
        duplicate_ip_exists = await redis.exists(duplicate_ip_key)
        if duplicate_ip_exists:
            raise HTTPException(status_code=409, detail="duplicate review text from this IP for this product")

    daily_counter_key = _review_author_daily_counter_key(product_legacy_id, author_key)
    daily_count = int(await redis.get(daily_counter_key) or 0)
    if daily_count >= REVIEW_AUTHOR_DAILY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"daily limit reached: at most {REVIEW_AUTHOR_DAILY_LIMIT} reviews per product from one author",
        )

    if ip_cooldown_key is not None:
        ip_reserved = await redis.set(ip_cooldown_key, "1", ex=REVIEW_IP_COOLDOWN_SECONDS, nx=True)
        if not ip_reserved:
            ttl = await redis.ttl(ip_cooldown_key)
            wait_seconds = ttl if ttl and ttl > 0 else REVIEW_IP_COOLDOWN_SECONDS
            raise HTTPException(
                status_code=429,
                detail=f"too many review attempts from this IP, wait {wait_seconds} seconds",
            )

    author_reserved = await redis.set(author_cooldown_key, "1", ex=REVIEW_AUTHOR_COOLDOWN_SECONDS, nx=True)
    if not author_reserved:
        ttl = await redis.ttl(author_cooldown_key)
        wait_seconds = ttl if ttl and ttl > 0 else REVIEW_AUTHOR_COOLDOWN_SECONDS
        raise HTTPException(
            status_code=429,
            detail=f"please wait {wait_seconds} seconds before posting another review for this product",
        )

    duplicate_author_reserved = await redis.set(
        duplicate_author_key,
        "1",
        ex=REVIEW_DUPLICATE_WINDOW_SECONDS,
        nx=True,
    )
    if not duplicate_author_reserved:
        raise HTTPException(status_code=409, detail="duplicate review text from this author for this product")

    if duplicate_ip_key is not None:
        duplicate_ip_reserved = await redis.set(
            duplicate_ip_key,
            "1",
            ex=REVIEW_DUPLICATE_WINDOW_SECONDS,
            nx=True,
        )
        if not duplicate_ip_reserved:
            raise HTTPException(status_code=409, detail="duplicate review text from this IP for this product")

    next_count = await redis.incr(daily_counter_key)
    if next_count == 1:
        await redis.expire(daily_counter_key, REVIEW_DAILY_COUNTER_TTL_SECONDS)
    if next_count > REVIEW_AUTHOR_DAILY_LIMIT:
        await redis.decr(daily_counter_key)
        raise HTTPException(
            status_code=429,
            detail=f"daily limit reached: at most {REVIEW_AUTHOR_DAILY_LIMIT} reviews per product from one author",
        )


def _clean_required(value: str, *, field: str, min_len: int, max_len: int) -> str:
    cleaned = value.strip()
    if len(cleaned) < min_len:
        raise HTTPException(status_code=422, detail=f"{field} must be at least {min_len} characters")
    if len(cleaned) > max_len:
        raise HTTPException(status_code=422, detail=f"{field} exceeds {max_len} characters")
    return cleaned


def _clean_optional(value: str | None, *, max_len: int) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) > max_len:
        raise HTTPException(status_code=422, detail=f"value exceeds {max_len} characters")
    return cleaned


def _to_bool(value: str | None) -> bool:
    return str(value).lower() in {"1", "true", "yes", "y", "on"}


def _to_int(value: str | None, *, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _current_user_internal_id(current_user: dict) -> int:
    candidate = current_user.get("internal_id")
    if candidate is None:
        candidate = current_user.get("id")
    try:
        return int(candidate)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="invalid user session") from exc


def _feedback_actor_key(current_user: dict) -> str:
    return f"user:{_current_user_internal_id(current_user)}"


def _normalize_vote(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"helpful", "not_helpful"}:
        return normalized
    return ""


def _iso_to_sort_ts(value: str | None) -> float:
    if not value:
        return 0.0
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.timestamp()
    except ValueError:
        return 0.0


def _parse_review(payload: dict[str, str]) -> ProductReviewOut:
    product_id = str(payload.get("product_id", "")).strip()
    return ProductReviewOut(
        id=str(payload["id"]),
        product_id=product_id,
        author=str(payload["author"]),
        rating=int(payload["rating"]),
        comment=str(payload["comment"]),
        pros=payload.get("pros") or None,
        cons=payload.get("cons") or None,
        is_verified_purchase=_to_bool(payload.get("is_verified_purchase")),
        helpful_votes=_to_int(payload.get("helpful_votes"), default=0),
        not_helpful_votes=_to_int(payload.get("not_helpful_votes"), default=0),
        status=str(payload.get("status", "published")),
        created_at=str(payload["created_at"]),
        updated_at=str(payload.get("updated_at", payload["created_at"])),
        moderated_by=payload.get("moderated_by") or None,
        moderated_at=payload.get("moderated_at") or None,
    )


def _parse_answer(payload: dict[str, str]) -> ProductAnswerOut:
    product_id = str(payload.get("product_id", "")).strip()
    return ProductAnswerOut(
        id=str(payload["id"]),
        question_id=str(payload["question_id"]),
        product_id=product_id,
        author=str(payload["author"]),
        text=str(payload["text"]),
        status=str(payload.get("status", "published")),
        is_official=_to_bool(payload.get("is_official")),
        is_pinned=_to_bool(payload.get("is_pinned")),
        pinned_at=payload.get("pinned_at") or None,
        pinned_by=payload.get("pinned_by") or None,
        created_at=str(payload["created_at"]),
        updated_at=str(payload.get("updated_at", payload["created_at"])),
        moderated_by=payload.get("moderated_by") or None,
        moderated_at=payload.get("moderated_at") or None,
    )


def _parse_question(payload: dict[str, str], answers: list[ProductAnswerOut]) -> ProductQuestionOut:
    product_id = str(payload.get("product_id", "")).strip()
    return ProductQuestionOut(
        id=str(payload["id"]),
        product_id=product_id,
        author=str(payload["author"]),
        question=str(payload["question"]),
        status=str(payload.get("status", "published")),
        created_at=str(payload["created_at"]),
        updated_at=str(payload.get("updated_at", payload["created_at"])),
        moderated_by=payload.get("moderated_by") or None,
        moderated_at=payload.get("moderated_at") or None,
        answers=answers,
    )


def _to_queue_item(kind: str, payload: dict[str, str]) -> ProductFeedbackQueueItem:
    body = str(payload.get("comment", "") if kind == "review" else payload.get("question", ""))
    rating = _to_int(payload.get("rating"), default=0) if kind == "review" else None
    normalized_rating = rating if kind == "review" and rating > 0 else None
    created_at = str(payload.get("created_at", _now_iso()))
    updated_at = str(payload.get("updated_at", created_at))
    product_id = str(payload.get("product_id", "")).strip()
    return ProductFeedbackQueueItem(
        kind=kind,
        id=str(payload.get("id", "")),
        product_id=product_id,
        author=str(payload.get("author", "Unknown")),
        body=body,
        rating=normalized_rating,
        status=str(payload.get("status", "published")),
        created_at=created_at,
        updated_at=updated_at,
        moderated_by=payload.get("moderated_by") or None,
        moderated_at=payload.get("moderated_at") or None,
    )


async def _ensure_product_exists(db: AsyncSession, product_id: str) -> tuple[str, int]:
    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    product = await repo.get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="product not found")
    return str(product["id"]), int(product["legacy_id"])


async def _load_answers(
    redis: Redis,
    question_id: str,
    *,
    limit: int = 100,
) -> list[ProductAnswerOut]:
    answer_ids = await redis.zrevrange(_answers_index_key(question_id), 0, max(limit - 1, 0))
    answers: list[ProductAnswerOut] = []
    for answer_id in answer_ids:
        payload = await redis.hgetall(_answer_key(answer_id))
        if not payload:
            continue
        status_value = str(payload.get("status", "published"))
        if status_value != "published":
            continue
        answers.append(_parse_answer(payload))
    answers.sort(key=lambda item: (0 if item.is_pinned else 1, -_iso_to_sort_ts(item.created_at)))
    return answers


async def _register_feedback_report(
    redis: Redis,
    *,
    target_key: str,
    actors_key: str,
    events_key: str,
    actor_key: str,
    reason: str,
) -> tuple[int, str]:
    now = _now_iso()
    reason_clean = _clean_required(reason, field="reason", min_len=3, max_len=400)
    actor_added = await redis.sadd(actors_key, actor_key)
    if actor_added:
        payload = {"actor": actor_key, "reason": reason_clean, "created_at": now}
        pipe = redis.pipeline()
        pipe.lpush(events_key, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        pipe.ltrim(events_key, 0, FEEDBACK_REPORT_EVENTS_LIMIT - 1)
        pipe.hincrby(target_key, "report_count", 1)
        pipe.hset(target_key, mapping={"last_reported_at": now, "updated_at": now})
        await pipe.execute()
    reports_total = _to_int(await redis.hget(target_key, "report_count"), default=0)
    return reports_total, now


async def _apply_review_vote(
    redis: Redis,
    *,
    review_id: str,
    actor_key: str,
    helpful: bool,
) -> tuple[int, int, str]:
    review_key = _review_key(review_id)
    votes_key = _review_votes_key(review_id)
    next_vote = "helpful" if helpful else "not_helpful"
    prev_vote = _normalize_vote(await redis.hget(votes_key, actor_key))
    helpful_votes = _to_int(await redis.hget(review_key, "helpful_votes"), default=0)
    not_helpful_votes = _to_int(await redis.hget(review_key, "not_helpful_votes"), default=0)

    if prev_vote == next_vote:
        return helpful_votes, not_helpful_votes, next_vote

    if prev_vote == "helpful":
        helpful_votes = max(0, helpful_votes - 1)
    elif prev_vote == "not_helpful":
        not_helpful_votes = max(0, not_helpful_votes - 1)

    if next_vote == "helpful":
        helpful_votes += 1
    else:
        not_helpful_votes += 1

    now = _now_iso()
    await redis.hset(
        review_key,
        mapping={
            "helpful_votes": str(helpful_votes),
            "not_helpful_votes": str(not_helpful_votes),
            "updated_at": now,
        },
    )
    await redis.hset(votes_key, mapping={actor_key: next_vote})
    return helpful_votes, not_helpful_votes, next_vote


@router.get("/moderation/queue", response_model=ProductFeedbackQueueOut)
async def list_feedback_moderation_queue(
    request: Request,
    status_filter: str = Query(default="all", alias="status", pattern="^(all|published|pending|rejected)$"),
    kind: str = Query(default="all", pattern="^(all|review|question)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin privileges required")),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="product-feedback-moderation-read", limit=120)

    items: list[ProductFeedbackQueueItem] = []
    status_counts: dict[str, int] = {"published": 0, "pending": 0, "rejected": 0}
    kind_counts: dict[str, int] = {"review": 0, "question": 0}

    async def collect(kind_name: str, pattern: str) -> None:
        async for key in redis.scan_iter(match=pattern):
            # Queue scan patterns can match non-hash keys (e.g. answers index zsets).
            # Skip keys that are not direct feedback entity hashes.
            if key.count(":") != 2:
                continue
            key_type = await redis.type(key)
            if key_type != "hash":
                continue
            payload = await redis.hgetall(key)
            if not payload:
                continue
            queue_item = _to_queue_item(kind_name, payload)
            if status_filter != "all" and queue_item.status != status_filter:
                continue
            items.append(queue_item)
            status_counts[queue_item.status] = status_counts.get(queue_item.status, 0) + 1
            kind_counts[kind_name] = kind_counts.get(kind_name, 0) + 1

    if kind in {"all", "review"}:
        await collect("review", "feedback:review:rev_*")
    if kind in {"all", "question"}:
        await collect("question", "feedback:question:q_*")

    items.sort(key=lambda item: _iso_to_sort_ts(item.updated_at or item.created_at), reverse=True)
    total = len(items)
    paged_items = items[offset : offset + limit]
    return ProductFeedbackQueueOut(items=paged_items, total=total, status_counts=status_counts, kind_counts=kind_counts)


@router.get("/{product_id}/reviews", response_model=list[ProductReviewOut])
async def list_product_reviews(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="product-feedback-read", limit=180)
    _, product_legacy_id = await _ensure_product_exists(db, product_id)

    review_ids = await redis.zrevrange(_reviews_index_key(product_legacy_id), offset, offset + limit - 1)
    reviews: list[ProductReviewOut] = []
    for review_id in review_ids:
        payload = await redis.hgetall(_review_key(review_id))
        if not payload:
            continue
        status_value = str(payload.get("status", "published"))
        if status_value != "published":
            continue
        reviews.append(_parse_review(payload))
    return reviews


@router.post("/{product_id}/reviews", response_model=ProductReviewOut)
async def create_product_review(
    request: Request,
    payload: ProductReviewCreate,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    async def _op():
        await enforce_rate_limit(request, redis, bucket="product-feedback-write", limit=60)
        product_uuid, product_legacy_id = await _ensure_product_exists(db, product_id)
        author = _clean_required(payload.author, field="author", min_len=2, max_len=120)
        comment = _clean_required(payload.comment, field="comment", min_len=10, max_len=3000)
        pros = _clean_optional(payload.pros, max_len=500) or ""
        cons = _clean_optional(payload.cons, max_len=500) or ""

        await _enforce_review_antispam(
            redis,
            request=request,
            product_legacy_id=product_legacy_id,
            author=author,
            comment=comment,
        )

        review_id = f"rev_{await redis.incr('feedback:review:id')}"
        now = _now_iso()
        mapping = {
            "id": review_id,
            "product_id": product_uuid,
            "product_legacy_id": str(product_legacy_id),
            "author": author,
            "rating": str(int(payload.rating)),
            "comment": comment,
            "pros": pros,
            "cons": cons,
            "is_verified_purchase": "false",
            "helpful_votes": "0",
            "not_helpful_votes": "0",
            "report_count": "0",
            "status": "pending",
            "created_at": now,
            "updated_at": now,
        }
        await redis.hset(_review_key(review_id), mapping=mapping)
        await redis.zadd(_reviews_index_key(product_legacy_id), {review_id: time()})
        return _parse_review(mapping)

    return await execute_idempotent_json(request, redis, scope=f"product_feedback.review.create:{product_id}", handler=_op)


@router.get("/{product_id}/questions", response_model=list[ProductQuestionOut])
async def list_product_questions(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="product-feedback-read", limit=180)
    _, product_legacy_id = await _ensure_product_exists(db, product_id)

    question_ids = await redis.zrevrange(_questions_index_key(product_legacy_id), offset, offset + limit - 1)
    questions: list[ProductQuestionOut] = []
    for question_id in question_ids:
        payload = await redis.hgetall(_question_key(question_id))
        if not payload:
            continue
        status_value = str(payload.get("status", "published"))
        if status_value != "published":
            continue
        answers = await _load_answers(redis, question_id, limit=100)
        questions.append(_parse_question(payload, answers))
    return questions


@router.post("/{product_id}/questions", response_model=ProductQuestionOut)
async def create_product_question(
    request: Request,
    payload: ProductQuestionCreate,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    async def _op():
        await enforce_rate_limit(request, redis, bucket="product-feedback-write", limit=60)
        product_uuid, product_legacy_id = await _ensure_product_exists(db, product_id)

        question_id = f"q_{await redis.incr('feedback:question:id')}"
        now = _now_iso()
        mapping = {
            "id": question_id,
            "product_id": product_uuid,
            "product_legacy_id": str(product_legacy_id),
            "author": _clean_required(payload.author, field="author", min_len=2, max_len=120),
            "question": _clean_required(payload.question, field="question", min_len=8, max_len=2000),
            "report_count": "0",
            "status": "pending",
            "created_at": now,
            "updated_at": now,
        }
        await redis.hset(_question_key(question_id), mapping=mapping)
        await redis.zadd(_questions_index_key(product_legacy_id), {question_id: time()})
        return _parse_question(mapping, [])

    return await execute_idempotent_json(request, redis, scope=f"product_feedback.question.create:{product_id}", handler=_op)


@router.post("/questions/{question_id}/answers", response_model=ProductAnswerOut)
async def create_question_answer(
    question_id: str,
    payload: ProductAnswerCreate,
    request: Request,
    current_user: dict = Depends(require_roles(*STAFF_ROLES, detail="staff privileges required")),
):
    redis = get_redis()
    async def _op():
        await enforce_rate_limit(request, redis, bucket="product-feedback-write", limit=60)

        question_payload = await redis.hgetall(_question_key(question_id))
        if not question_payload:
            raise HTTPException(status_code=404, detail="question not found")

        answer_id = f"ans_{await redis.incr('feedback:answer:id')}"
        now = _now_iso()
        mapping = {
            "id": answer_id,
            "question_id": question_id,
            "product_id": str(question_payload["product_id"]),
            "product_legacy_id": str(question_payload.get("product_legacy_id", "")),
            "author": _clean_required(
                str(current_user.get("full_name") or current_user.get("email") or payload.author or ""),
                field="author",
                min_len=2,
                max_len=120,
            ),
            "text": _clean_required(payload.text, field="text", min_len=2, max_len=2000),
            "status": "published",
            "is_official": "true" if bool(payload.is_official) else "false",
            "is_pinned": "false",
            "created_at": now,
            "updated_at": now,
        }
        await redis.hset(_answer_key(answer_id), mapping=mapping)
        await redis.zadd(_answers_index_key(question_id), {answer_id: time()})
        await redis.hset(_question_key(question_id), mapping={"updated_at": now})
        return _parse_answer(mapping)

    actor_id = _current_user_internal_id(current_user)
    return await execute_idempotent_json(request, redis, scope=f"product_feedback.answer.create:{question_id}:{actor_id}", handler=_op)


@router.post("/reviews/{review_id}/votes", response_model=ProductReviewVoteOut)
async def vote_review(
    review_id: str,
    payload: ProductReviewVoteIn,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    redis = get_redis()
    async def _op():
        await enforce_rate_limit(request, redis, bucket="product-feedback-vote", limit=120)

        review_key = _review_key(review_id)
        review_payload = await redis.hgetall(review_key)
        if not review_payload:
            raise HTTPException(status_code=404, detail="review not found")

        helpful_votes, not_helpful_votes, user_vote = await _apply_review_vote(
            redis,
            review_id=review_id,
            actor_key=_feedback_actor_key(current_user),
            helpful=payload.helpful,
        )
        return ProductReviewVoteOut(
            ok=True,
            review_id=review_id,
            helpful_votes=helpful_votes,
            not_helpful_votes=not_helpful_votes,
            user_vote=user_vote,
        )

    actor_id = _current_user_internal_id(current_user)
    return await execute_idempotent_json(request, redis, scope=f"product_feedback.review.vote:{review_id}:{actor_id}", handler=_op)


@router.post("/reviews/{review_id}/report", response_model=ProductFeedbackReportOut)
async def report_review(
    review_id: str,
    payload: ProductFeedbackReportIn,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    redis = get_redis()
    async def _op():
        await enforce_rate_limit(request, redis, bucket="product-feedback-report", limit=60)

        review_key = _review_key(review_id)
        review_payload = await redis.hgetall(review_key)
        if not review_payload:
            raise HTTPException(status_code=404, detail="review not found")

        reports_total, created_at = await _register_feedback_report(
            redis,
            target_key=review_key,
            actors_key=_review_reports_actors_key(review_id),
            events_key=_review_reports_events_key(review_id),
            actor_key=_feedback_actor_key(current_user),
            reason=payload.reason,
        )
        return ProductFeedbackReportOut(
            ok=True,
            target_id=review_id,
            kind="review",
            reports_total=reports_total,
            created_at=created_at,
        )

    actor_id = _current_user_internal_id(current_user)
    return await execute_idempotent_json(request, redis, scope=f"product_feedback.review.report:{review_id}:{actor_id}", handler=_op)


@router.post("/questions/{question_id}/report", response_model=ProductFeedbackReportOut)
async def report_question(
    question_id: str,
    payload: ProductFeedbackReportIn,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    redis = get_redis()
    async def _op():
        await enforce_rate_limit(request, redis, bucket="product-feedback-report", limit=60)

        question_key = _question_key(question_id)
        question_payload = await redis.hgetall(question_key)
        if not question_payload:
            raise HTTPException(status_code=404, detail="question not found")

        reports_total, created_at = await _register_feedback_report(
            redis,
            target_key=question_key,
            actors_key=_question_reports_actors_key(question_id),
            events_key=_question_reports_events_key(question_id),
            actor_key=_feedback_actor_key(current_user),
            reason=payload.reason,
        )
        return ProductFeedbackReportOut(
            ok=True,
            target_id=question_id,
            kind="question",
            reports_total=reports_total,
            created_at=created_at,
        )

    actor_id = _current_user_internal_id(current_user)
    return await execute_idempotent_json(request, redis, scope=f"product_feedback.question.report:{question_id}:{actor_id}", handler=_op)


@router.post("/answers/{answer_id}/pin", response_model=ProductAnswerPinOut)
async def pin_answer(
    answer_id: str,
    payload: ProductAnswerPinIn,
    request: Request,
    current_user: dict = Depends(require_roles(*STAFF_ROLES, detail="staff privileges required")),
):
    redis = get_redis()
    async def _op():
        await enforce_rate_limit(request, redis, bucket="product-feedback-moderation", limit=60)

        answer_key = _answer_key(answer_id)
        answer_payload = await redis.hgetall(answer_key)
        if not answer_payload:
            raise HTTPException(status_code=404, detail="answer not found")

        now = _now_iso()
        pinned = bool(payload.pinned)
        updates = {
            "is_pinned": "true" if pinned else "false",
            "pinned_at": now if pinned else "",
            "pinned_by": str(current_user.get("email") or current_user.get("full_name") or "staff") if pinned else "",
            "updated_at": now,
        }
        if pinned:
            updates["is_official"] = "true"
        await redis.hset(answer_key, mapping=updates)

        question_id = str(answer_payload.get("question_id", "")).strip()
        if question_id:
            await redis.hset(_question_key(question_id), mapping={"updated_at": now})

        return ProductAnswerPinOut(
            ok=True,
            answer_id=answer_id,
            pinned=pinned,
            pinned_at=updates["pinned_at"] or None,
            pinned_by=updates["pinned_by"] or None,
        )

    actor_id = _current_user_internal_id(current_user)
    return await execute_idempotent_json(request, redis, scope=f"product_feedback.answer.pin:{answer_id}:{actor_id}", handler=_op)


@router.post("/reviews/{review_id}/moderation", response_model=ProductFeedbackModerationOut)
async def moderate_review(
    review_id: str,
    payload: ProductFeedbackModerationIn,
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin privileges required")),
):
    redis = get_redis()
    async def _op():
        await enforce_rate_limit(request, redis, bucket="product-feedback-moderation", limit=60)

        key = _review_key(review_id)
        existing = await redis.hgetall(key)
        if not existing:
            raise HTTPException(status_code=404, detail="review not found")

        now = _now_iso()
        await redis.hset(
            key,
            mapping={
                "status": payload.status,
                "moderated_by": str(current_user.get("email", "admin")),
                "moderated_at": now,
                "updated_at": now,
            },
        )
        return ProductFeedbackModerationOut(ok=True, status=payload.status)

    actor_id = _current_user_internal_id(current_user)
    return await execute_idempotent_json(request, redis, scope=f"product_feedback.review.moderate:{review_id}:{actor_id}", handler=_op)


@router.post("/questions/{question_id}/moderation", response_model=ProductFeedbackModerationOut)
async def moderate_question(
    question_id: str,
    payload: ProductFeedbackModerationIn,
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin privileges required")),
):
    redis = get_redis()
    async def _op():
        await enforce_rate_limit(request, redis, bucket="product-feedback-moderation", limit=60)

        key = _question_key(question_id)
        existing = await redis.hgetall(key)
        if not existing:
            raise HTTPException(status_code=404, detail="question not found")

        now = _now_iso()
        await redis.hset(
            key,
            mapping={
                "status": payload.status,
                "moderated_by": str(current_user.get("email", "admin")),
                "moderated_at": now,
                "updated_at": now,
            },
        )
        return ProductFeedbackModerationOut(ok=True, status=payload.status)

    actor_id = _current_user_internal_id(current_user)
    return await execute_idempotent_json(request, redis, scope=f"product_feedback.question.moderate:{question_id}:{actor_id}", handler=_op)


@router.post("/answers/{answer_id}/moderation", response_model=ProductFeedbackModerationOut)
async def moderate_answer(
    answer_id: str,
    payload: ProductFeedbackModerationIn,
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin privileges required")),
):
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="product-feedback-moderation", limit=60)

        key = _answer_key(answer_id)
        existing = await redis.hgetall(key)
        if not existing:
            raise HTTPException(status_code=404, detail="answer not found")

        now = _now_iso()
        await redis.hset(
            key,
            mapping={
                "status": payload.status,
                "moderated_by": str(current_user.get("email", "admin")),
                "moderated_at": now,
                "updated_at": now,
            },
        )
        question_id = str(existing.get("question_id", "")).strip()
        if question_id:
            await redis.hset(_question_key(question_id), mapping={"updated_at": now})
        return ProductFeedbackModerationOut(ok=True, status=payload.status)

    actor_id = _current_user_internal_id(current_user)
    return await execute_idempotent_json(request, redis, scope=f"product_feedback.answer.moderate:{answer_id}:{actor_id}", handler=_op)

