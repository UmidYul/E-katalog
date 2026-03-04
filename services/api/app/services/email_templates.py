from __future__ import annotations

import html
import re


_URL_PATTERN = re.compile(r"https?://[^\s<]+", re.IGNORECASE)


def _normalize_lines(text_value: str) -> list[str]:
    normalized = str(text_value or "").replace("\r\n", "\n").replace("\r", "\n")
    return normalized.split("\n")


def _linkify_plain_text(raw_value: str) -> str:
    value = str(raw_value or "")
    chunks: list[str] = []
    cursor = 0
    for match in _URL_PATTERN.finditer(value):
        start, end = match.span()
        chunks.append(html.escape(value[cursor:start]))
        url = match.group(0)
        safe_url = html.escape(url, quote=True)
        chunks.append(
            f'<a href="{safe_url}" style="color:#0b63ce;text-decoration:none;font-weight:600;">'
            f"{html.escape(url)}</a>"
        )
        cursor = end
    chunks.append(html.escape(value[cursor:]))
    return "".join(chunks)


def _paragraphs_from_text(text_value: str) -> list[str]:
    paragraphs: list[str] = []
    chunk: list[str] = []
    for line in _normalize_lines(text_value):
        stripped = line.strip()
        if not stripped:
            if chunk:
                paragraphs.append("<br/>".join(chunk))
                chunk = []
            continue
        chunk.append(_linkify_plain_text(stripped))
    if chunk:
        paragraphs.append("<br/>".join(chunk))
    return paragraphs


def _first_url(value: str) -> str | None:
    match = _URL_PATTERN.search(str(value or ""))
    return match.group(0) if match else None


def render_text_as_html_email(
    *,
    subject: str,
    text_value: str,
    cta_url: str | None = None,
    cta_label: str | None = None,
    brand_name: str = "E-katalog",
) -> str:
    title = html.escape(str(subject or "Notification"))
    brand = html.escape(str(brand_name or "E-katalog"))
    paragraphs = _paragraphs_from_text(text_value)
    if not paragraphs:
        paragraphs = [html.escape("Please review this message.")]

    body_html = "".join(
        f'<p style="margin:0 0 12px 0;color:#0f172a;font-size:15px;line-height:1.55;">{paragraph}</p>'
        for paragraph in paragraphs
    )
    action_url = str(cta_url or "").strip() or _first_url(text_value)
    action_html = ""
    if action_url:
        safe_action_url = html.escape(action_url, quote=True)
        action_label_text = html.escape(str(cta_label or "Open link"))
        action_html = (
            '<div style="margin:24px 0 2px 0;">'
            f'<a href="{safe_action_url}" '
            "style=\"display:inline-block;background:#0ea5e9;border-radius:10px;padding:12px 20px;"
            "color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;\">"
            f"{action_label_text}</a>"
            "</div>"
        )

    return (
        "<!doctype html>"
        "<html lang=\"en\">"
        "<head>"
        "<meta charset=\"utf-8\"/>"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>"
        "<title>"
        f"{title}"
        "</title>"
        "</head>"
        "<body style=\"margin:0;padding:0;background:#eef3fa;\">"
        "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
        "style=\"background:#eef3fa;padding:28px 14px;\">"
        "<tr><td align=\"center\">"
        "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
        "style=\"max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;"
        "border:1px solid #dbe5f2;font-family:Segoe UI,Arial,sans-serif;\">"
        "<tr><td style=\"padding:24px 24px 20px 24px;background:linear-gradient(135deg,#0ea5e9,#22c55e);\">"
        f"<p style=\"margin:0;color:#e2f4ff;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;\">{brand}</p>"
        f"<h1 style=\"margin:8px 0 0 0;color:#ffffff;font-size:24px;line-height:1.2;\">{title}</h1>"
        "</td></tr>"
        "<tr><td style=\"padding:24px 24px 8px 24px;\">"
        f"{body_html}"
        f"{action_html}"
        "</td></tr>"
        "<tr><td style=\"padding:20px 24px 24px 24px;\">"
        "<p style=\"margin:0;color:#64748b;font-size:12px;line-height:1.5;\">"
        "This is an automated email. If you did not expect this message, you can ignore it."
        "</p>"
        "</td></tr>"
        "</table>"
        "</td></tr>"
        "</table>"
        "</body>"
        "</html>"
    )


def build_partner_lead_submission_email(
    *,
    contact_name: str,
    company_name: str,
    lead_id: str,
    status_url: str,
    support_email: str | None = None,
) -> tuple[str, str, str]:
    contact = str(contact_name or "").strip() or "partner"
    company = str(company_name or "").strip() or "your company"
    lead = str(lead_id or "").strip()
    status_link = str(status_url or "").strip()
    support = str(support_email or "").strip()

    text_lines = [
        f"Hello, {contact}!",
        "",
        f"We received your partnership application for {company}.",
        "Our team will review it and update the status shortly.",
        "",
        f"Lead ID: {lead}",
        f"Status page: {status_link}",
        "Please save this link. It includes your secure access token.",
    ]
    if support:
        text_lines.extend(["", f"Need help? Contact us at {support}."])
    text_lines.append("")
    text_lines.append("Thank you for choosing E-katalog.")

    subject = "Partnership application received"
    text_value = "\n".join(text_lines)
    html_value = render_text_as_html_email(
        subject=subject,
        text_value=text_value,
        cta_url=status_link or None,
        cta_label="Check application status",
    )
    return subject, text_value, html_value


def _display_name(value: str | None) -> str:
    normalized = str(value or "").strip()
    return normalized or "there"


def _ttl_human(seconds: int) -> str:
    total_seconds = max(60, int(seconds))
    minutes = total_seconds // 60
    if minutes < 60:
        return f"{minutes} minute" if minutes == 1 else f"{minutes} minutes"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} hour" if hours == 1 else f"{hours} hours"
    days = hours // 24
    return f"{days} day" if days == 1 else f"{days} days"


def build_auth_email_confirmation_email(
    *,
    full_name: str,
    confirmation_link: str,
    expires_in_seconds: int,
) -> tuple[str, str, str]:
    subject = "Confirm your email address"
    text_value = "\n".join(
        [
            f"Hello, {_display_name(full_name)}!",
            "",
            "Welcome to E-katalog.",
            "Please confirm your email address to protect your account and enable full access.",
            "",
            f"Confirmation link: {confirmation_link}",
            f"This link expires in {_ttl_human(expires_in_seconds)}.",
            "",
            "If you did not create this account, you can ignore this message.",
        ]
    )
    html_value = render_text_as_html_email(
        subject=subject,
        text_value=text_value,
        cta_url=confirmation_link,
        cta_label="Confirm email",
    )
    return subject, text_value, html_value


def build_auth_password_reset_email(
    *,
    full_name: str,
    reset_link: str,
    expires_in_seconds: int,
) -> tuple[str, str, str]:
    subject = "Password reset request"
    text_value = "\n".join(
        [
            f"Hello, {_display_name(full_name)}!",
            "",
            "We received a request to reset your password.",
            f"Reset link: {reset_link}",
            f"This link expires in {_ttl_human(expires_in_seconds)}.",
            "",
            "If this request was not made by you, ignore this email and keep your account secure.",
        ]
    )
    html_value = render_text_as_html_email(
        subject=subject,
        text_value=text_value,
        cta_url=reset_link,
        cta_label="Reset password",
    )
    return subject, text_value, html_value


def build_auth_password_changed_email(
    *,
    full_name: str,
    happened_at: str,
    ip_address: str,
    device: str,
    location: str,
    login_link: str,
) -> tuple[str, str, str]:
    subject = "Your password was changed"
    text_value = "\n".join(
        [
            f"Hello, {_display_name(full_name)}!",
            "",
            "Your account password was just updated.",
            "",
            f"Time: {happened_at}",
            f"IP: {ip_address}",
            f"Device: {device}",
            f"Location: {location}",
            "",
            f"Login: {login_link}",
            "If this was not you, reset your password immediately and contact support.",
        ]
    )
    html_value = render_text_as_html_email(
        subject=subject,
        text_value=text_value,
        cta_url=login_link,
        cta_label="Open login page",
    )
    return subject, text_value, html_value


def build_auth_new_login_email(
    *,
    full_name: str,
    happened_at: str,
    ip_address: str,
    device: str,
    location: str,
    login_link: str,
) -> tuple[str, str, str]:
    subject = "New sign-in detected"
    text_value = "\n".join(
        [
            f"Hello, {_display_name(full_name)}!",
            "",
            "We noticed a new sign-in to your account.",
            "",
            f"Time: {happened_at}",
            f"IP: {ip_address}",
            f"Device: {device}",
            f"Location: {location}",
            "",
            f"Account access: {login_link}",
            "If this wasn't you, reset your password and revoke active sessions.",
        ]
    )
    html_value = render_text_as_html_email(
        subject=subject,
        text_value=text_value,
        cta_url=login_link,
        cta_label="Review account",
    )
    return subject, text_value, html_value
