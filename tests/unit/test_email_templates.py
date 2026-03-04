from services.api.app.services.email_templates import (
    build_auth_email_confirmation_email,
    build_auth_new_login_email,
    build_auth_password_changed_email,
    build_auth_password_reset_email,
    build_partner_lead_submission_email,
    render_text_as_html_email,
)


def test_render_text_as_html_email_escapes_and_linkifies() -> None:
    html_value = render_text_as_html_email(
        subject="Test message",
        text_value="Hello <team>\n\nTrack: https://example.com/status?lead=abc&token=xyz",
    )

    assert "&lt;team&gt;" in html_value
    assert 'href="https://example.com/status?lead=abc&amp;token=xyz"' in html_value
    assert "Open link" in html_value


def test_build_partner_lead_submission_email_contains_status_link() -> None:
    subject, text_value, html_value = build_partner_lead_submission_email(
        contact_name="Jane",
        company_name="Acme Store",
        lead_id="aee9cc4e-eceb-4ca0-9421-96b0d91ece6a",
        status_url="https://app.example.com/partners/status?lead=lead-1&token=track-1",
        support_email="support@example.com",
    )

    assert subject == "Partnership application received"
    assert "Lead ID: aee9cc4e-eceb-4ca0-9421-96b0d91ece6a" in text_value
    assert "Status page: https://app.example.com/partners/status?lead=lead-1&token=track-1" in text_value
    assert "Check application status" in html_value
    assert 'href="https://app.example.com/partners/status?lead=lead-1&amp;token=track-1"' in html_value


def test_build_auth_email_confirmation_email_contains_ttl_and_button() -> None:
    subject, text_value, html_value = build_auth_email_confirmation_email(
        full_name="Nodir",
        confirmation_link="https://app.example.com/auth/confirm-email?token=abc",
        expires_in_seconds=3600,
    )

    assert subject == "Confirm your email address"
    assert "expires in 1 hour" in text_value
    assert "Confirm email" in html_value
    assert 'href="https://app.example.com/auth/confirm-email?token=abc"' in html_value


def test_build_auth_password_reset_email_contains_reset_link() -> None:
    subject, text_value, html_value = build_auth_password_reset_email(
        full_name="Nodir",
        reset_link="https://app.example.com/auth/reset-password?token=def",
        expires_in_seconds=1800,
    )

    assert subject == "Password reset request"
    assert "Reset link: https://app.example.com/auth/reset-password?token=def" in text_value
    assert "Reset password" in html_value


def test_build_auth_security_emails_include_context() -> None:
    login_subject, login_text, login_html = build_auth_new_login_email(
        full_name="Nodir",
        happened_at="2026-03-03T12:00:00+00:00",
        ip_address="10.0.0.1",
        device="Chrome on Windows",
        location="UZ",
        login_link="https://app.example.com/login",
    )
    changed_subject, changed_text, changed_html = build_auth_password_changed_email(
        full_name="Nodir",
        happened_at="2026-03-03T12:10:00+00:00",
        ip_address="10.0.0.1",
        device="Chrome on Windows",
        location="UZ",
        login_link="https://app.example.com/login",
    )

    assert login_subject == "New sign-in detected"
    assert "Device: Chrome on Windows" in login_text
    assert "Review account" in login_html
    assert changed_subject == "Your password was changed"
    assert "IP: 10.0.0.1" in changed_text
    assert "Open login page" in changed_html
