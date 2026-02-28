from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


SELLER_PRODUCT_STATUSES = {"draft", "pending_moderation", "active", "rejected", "archived"}
SELLER_TIMELINE_ACTOR_ROLES = {"seller", "admin", "system"}

SELLER_TIMELINE_ACTOR_LABELS_RU = {
    "seller": "Вы",
    "admin": "Модератор",
    "system": "Система",
}

SELLER_TIMELINE_REASON_LABELS_RU = {
    "migration_backfill": "Исторический статус",
    "seller_created": "Товар создан",
    "seller_saved_draft": "Сохранено как черновик",
    "seller_submitted_for_moderation": "Отправлено на модерацию",
    "seller_archived": "Снято с публикации",
    "admin_moderation_active": "Одобрено модератором",
    "admin_moderation_rejected": "Отклонено модератором",
    "admin_moderation_archived": "Переведено в архив модератором",
    "auto_remoderation_significant_change": "Автоматический возврат на модерацию после существенных изменений",
}


def _normalize_status(value: str | None) -> str | None:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return None
    if normalized not in SELLER_PRODUCT_STATUSES:
        return None
    return normalized


def _normalize_actor_role(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in SELLER_TIMELINE_ACTOR_ROLES:
        return normalized
    return "system"


def _reason_label_ru(*, reason_code: str | None, event_type: str, to_status: str) -> str:
    normalized_reason = str(reason_code or "").strip().lower()
    if normalized_reason in SELLER_TIMELINE_REASON_LABELS_RU:
        return SELLER_TIMELINE_REASON_LABELS_RU[normalized_reason]
    normalized_event = str(event_type or "").strip().lower()
    if normalized_event == "status_snapshot":
        return "Снимок статуса"
    if to_status == "pending_moderation":
        return "Отправлено на модерацию"
    if to_status == "active":
        return "Опубликовано"
    if to_status == "rejected":
        return "Отклонено"
    if to_status == "archived":
        return "В архиве"
    return "Изменение статуса"


def _serialize_status_event(row: dict[str, Any]) -> dict[str, Any]:
    from_status = _normalize_status(str(row.get("from_status") or "")) if row.get("from_status") is not None else None
    to_status = _normalize_status(str(row.get("to_status") or "")) or "draft"
    event_type = str(row.get("event_type") or "status_change")
    reason_code = str(row.get("reason_code") or "").strip().lower() or None
    actor_role = _normalize_actor_role(str(row.get("actor_role") or "system"))
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return {
        "id": str(row.get("uuid")),
        "product_id": str(row.get("product_uuid")),
        "from_status": from_status,
        "to_status": to_status,
        "event_type": event_type,
        "reason_code": reason_code,
        "reason_label": _reason_label_ru(reason_code=reason_code, event_type=event_type, to_status=to_status),
        "comment": row.get("comment"),
        "actor_role": actor_role,
        "actor_user_id": str(row["actor_user_uuid"]) if row.get("actor_user_uuid") else None,
        "actor_label": SELLER_TIMELINE_ACTOR_LABELS_RU.get(actor_role, "Система"),
        "metadata": metadata,
        "created_at": str(row.get("created_at")),
    }


async def record_seller_product_status_event(
    db: AsyncSession,
    *,
    product_id: int,
    shop_id: int,
    from_status: str | None,
    to_status: str,
    event_type: str = "status_change",
    reason_code: str | None = None,
    comment: str | None = None,
    actor_role: str = "system",
    actor_user_uuid: str | None = None,
    metadata: dict[str, Any] | None = None,
    created_at: datetime | None = None,
) -> None:
    normalized_to_status = _normalize_status(to_status)
    if not normalized_to_status:
        return
    normalized_from_status = _normalize_status(from_status)
    normalized_actor_role = _normalize_actor_role(actor_role)
    await db.execute(
        text(
            """
            insert into seller_product_status_events (
                product_id,
                shop_id,
                from_status,
                to_status,
                event_type,
                reason_code,
                comment,
                actor_role,
                actor_user_uuid,
                metadata,
                created_at
            )
            values (
                :product_id,
                :shop_id,
                :from_status,
                :to_status,
                :event_type,
                :reason_code,
                :comment,
                :actor_role,
                cast(:actor_user_uuid as uuid),
                cast(:metadata as jsonb),
                coalesce(:created_at, now())
            )
            """
        ),
        {
            "product_id": int(product_id),
            "shop_id": int(shop_id),
            "from_status": normalized_from_status,
            "to_status": normalized_to_status,
            "event_type": str(event_type or "status_change").strip().lower(),
            "reason_code": str(reason_code or "").strip().lower() or None,
            "comment": comment,
            "actor_role": normalized_actor_role,
            "actor_user_uuid": str(actor_user_uuid or "").strip().lower() or None,
            "metadata": json.dumps(metadata or {}, ensure_ascii=False),
            "created_at": created_at,
        },
    )


async def list_seller_product_status_events(
    db: AsyncSession,
    *,
    product_id: int,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    rows = (
        await db.execute(
            text(
                """
                select
                    e.uuid,
                    p.uuid as product_uuid,
                    e.from_status,
                    e.to_status,
                    e.event_type,
                    e.reason_code,
                    e.comment,
                    e.actor_role,
                    e.actor_user_uuid,
                    e.metadata,
                    e.created_at
                from seller_product_status_events e
                join seller_products p on p.id = e.product_id
                where e.product_id = :product_id
                order by e.created_at desc, e.id desc
                limit :limit
                offset :offset
                """
            ),
            {"product_id": int(product_id), "limit": int(limit), "offset": int(offset)},
        )
    ).mappings().all()
    total = int(
        (
            await db.execute(
                text(
                    """
                    select count(*)::int
                    from seller_product_status_events
                    where product_id = :product_id
                    """
                ),
                {"product_id": int(product_id)},
            )
        ).scalar_one()
        or 0
    )
    return {
        "items": [_serialize_status_event(dict(row)) for row in rows],
        "total": total,
        "limit": int(limit),
        "offset": int(offset),
    }
