import asyncio
from datetime import datetime, timedelta
from shared.utils.time import UTC
from decimal import Decimal

from services.worker.app.tasks.maintenance_tasks import _should_send_price_alert
from services.worker.app.tasks.maintenance_tasks import _email_contact
from services.worker.app.tasks.maintenance_tasks import _build_price_alert_email_subject
from services.worker.app.tasks.maintenance_tasks import _send_email_text
from services.worker.app.tasks.maintenance_tasks import _telegram_chat_id
from services.worker.app.tasks import maintenance_tasks


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


def test_email_contact_validates_basic_format() -> None:
    assert _email_contact(" user@example.com ") == "user@example.com"
    assert _email_contact("invalid-email") is None
    assert _email_contact("") is None


def test_build_price_alert_email_subject_contains_product_title() -> None:
    assert _build_price_alert_email_subject(product_title="iPhone 15") == "Price alert: iPhone 15"


def test_send_email_text_connects_to_smtp_server() -> None:
    class _FakeSMTP:
        host: str | None = None
        port: int | None = None
        timeout: float | None = None
        starttls_called = False
        login_args: tuple[str, str] | None = None
        send_message_called = False

        def __init__(self, host: str, port: int, timeout: float) -> None:
            _FakeSMTP.host = host
            _FakeSMTP.port = port
            _FakeSMTP.timeout = timeout

        def __enter__(self) -> "_FakeSMTP":
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def starttls(self) -> None:
            _FakeSMTP.starttls_called = True

        def login(self, username: str, password: str) -> None:
            _FakeSMTP.login_args = (username, password)

        def send_message(self, msg) -> None:
            _FakeSMTP.send_message_called = True

    original_smtp = maintenance_tasks.smtplib.SMTP
    original_enabled = maintenance_tasks.settings.price_alerts_email_enabled
    original_host = maintenance_tasks.settings.price_alerts_smtp_host
    original_port = maintenance_tasks.settings.price_alerts_smtp_port
    original_username = maintenance_tasks.settings.price_alerts_smtp_username
    original_password = maintenance_tasks.settings.price_alerts_smtp_password
    original_use_tls = maintenance_tasks.settings.price_alerts_smtp_use_tls
    original_use_ssl = maintenance_tasks.settings.price_alerts_smtp_use_ssl
    original_from = maintenance_tasks.settings.price_alerts_email_from
    original_timeout = maintenance_tasks.settings.price_alerts_email_timeout_seconds

    try:
        maintenance_tasks.smtplib.SMTP = _FakeSMTP
        maintenance_tasks.settings.price_alerts_email_enabled = True
        maintenance_tasks.settings.price_alerts_smtp_host = "smtp.example.com"
        maintenance_tasks.settings.price_alerts_smtp_port = 587
        maintenance_tasks.settings.price_alerts_smtp_username = "mailer-user"
        maintenance_tasks.settings.price_alerts_smtp_password = "mailer-pass"
        maintenance_tasks.settings.price_alerts_smtp_use_tls = True
        maintenance_tasks.settings.price_alerts_smtp_use_ssl = False
        maintenance_tasks.settings.price_alerts_email_from = "noreply@example.com"
        maintenance_tasks.settings.price_alerts_email_timeout_seconds = 7.5

        delivered, error = asyncio.run(
            _send_email_text(
                recipient="buyer@example.com",
                subject="Price alert: Test",
                text_value="Test body",
            )
        )
    finally:
        maintenance_tasks.smtplib.SMTP = original_smtp
        maintenance_tasks.settings.price_alerts_email_enabled = original_enabled
        maintenance_tasks.settings.price_alerts_smtp_host = original_host
        maintenance_tasks.settings.price_alerts_smtp_port = original_port
        maintenance_tasks.settings.price_alerts_smtp_username = original_username
        maintenance_tasks.settings.price_alerts_smtp_password = original_password
        maintenance_tasks.settings.price_alerts_smtp_use_tls = original_use_tls
        maintenance_tasks.settings.price_alerts_smtp_use_ssl = original_use_ssl
        maintenance_tasks.settings.price_alerts_email_from = original_from
        maintenance_tasks.settings.price_alerts_email_timeout_seconds = original_timeout

    assert delivered is True
    assert error is None
    assert _FakeSMTP.host == "smtp.example.com"
    assert _FakeSMTP.port == 587
    assert _FakeSMTP.timeout == 7.5
    assert _FakeSMTP.starttls_called is True
    assert _FakeSMTP.login_args == ("mailer-user", "mailer-pass")
    assert _FakeSMTP.send_message_called is True

