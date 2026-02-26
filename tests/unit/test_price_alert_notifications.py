from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.tasks.maintenance_tasks import _should_send_price_alert
from app.tasks.maintenance_tasks import _telegram_chat_id


def test_should_send_price_alert_hits_target_without_cooldown_block() -> None:
    now_dt = datetime.now(UTC)
    assert _should_send_price_alert(
        current_price=Decimal("999.00"),
        target_price=Decimal("1000.00"),
        baseline_price=Decimal("1200.00"),
        last_notified_at=None,
        cooldown_minutes=720,
        now_dt=now_dt,
    )


def test_should_send_price_alert_respects_cooldown() -> None:
    now_dt = datetime.now(UTC)
    assert not _should_send_price_alert(
        current_price=Decimal("999.00"),
        target_price=Decimal("1000.00"),
        baseline_price=None,
        last_notified_at=now_dt - timedelta(minutes=30),
        cooldown_minutes=60,
        now_dt=now_dt,
    )


def test_should_send_price_alert_uses_baseline_when_target_missing() -> None:
    now_dt = datetime.now(UTC)
    assert _should_send_price_alert(
        current_price=Decimal("899.00"),
        target_price=None,
        baseline_price=Decimal("1000.00"),
        last_notified_at=None,
        cooldown_minutes=0,
        now_dt=now_dt,
    )


def test_telegram_chat_id_parses_prefixed_value() -> None:
    assert _telegram_chat_id("chatid:-100123456") == "-100123456"
    assert _telegram_chat_id("  @my_channel  ") == "@my_channel"
    assert _telegram_chat_id("") is None
