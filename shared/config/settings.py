from functools import lru_cache
from typing import Literal

from pydantic import Field, HttpUrl, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore")

    environment: Literal["local", "staging", "production"] = "local"
    log_level: str = "INFO"

    database_url: str = Field(default="postgresql+asyncpg://postgres:postgres@localhost:5432/scraper")
    redis_url: str = Field(default="redis://localhost:6379/0")

    celery_broker_url: str = Field(default="redis://localhost:6379/1")
    celery_result_backend: str = Field(default="redis://localhost:6379/2")

    default_timeout_seconds: float = 20.0
    http_verify_ssl: bool = True
    http_ca_bundle: str | None = None
    request_concurrency: int = 20
    max_retries: int = 5
    task_retry_backoff_max_seconds: int = 600
    crawl_interval_minutes: int = 360

    playwright_headless: bool = True
    ai_spec_enrichment_enabled: bool = False
    ai_spec_strict_mode: bool = False
    ai_spec_max_attempts: int = 2
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    ai_canonical_matching_enabled: bool = False
    ai_canonical_min_confidence: float = 0.90
    ai_canonical_candidates_limit: int = 20
    ai_dedupe_merge_enabled: bool = False
    ai_dedupe_min_confidence: float = 0.95
    ai_product_copy_enabled: bool = False
    ai_product_copy_min_compare_confidence: float = 0.70
    ai_product_copy_batch_limit: int = 300
    embedding_model_name: str = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
    embedding_dimension: int = 768
    embedding_batch_limit: int = 400
    embedding_ann_maintenance_reindex_enabled: bool = False
    quality_report_enabled: bool = True
    quality_report_stale_offer_hours: int = 48
    quality_report_active_without_offers_warn_ratio: float = 0.20
    quality_report_active_without_offers_critical_ratio: float = 0.40
    quality_report_search_mismatch_warn_ratio: float = 0.03
    quality_report_search_mismatch_critical_ratio: float = 0.10
    quality_report_stale_offer_warn_ratio: float = 0.15
    quality_report_stale_offer_critical_ratio: float = 0.30
    quality_report_low_quality_image_warn_ratio: float = 0.20
    quality_report_low_quality_image_critical_ratio: float = 0.35
    quality_report_autoheal_enabled: bool = True
    quality_report_autoheal_max_products: int = 1000
    quality_report_auto_deactivate_no_offer_enabled: bool = True
    quality_report_auto_deactivate_no_offer_hours: int = 72
    quality_report_auto_deactivate_no_offer_limit: int = 500
    quality_report_adaptive_thresholds_enabled: bool = True
    quality_report_adaptive_window_reports: int = 14
    quality_report_alert_webhook_url: str | None = None
    quality_report_alert_min_status: Literal["warning", "critical"] = "critical"
    quality_report_alert_cooldown_minutes: int = 90
    quality_report_alert_min_delta: float = 0.01
    offer_trust_score_enabled: bool = True
    offer_trust_score_refresh_limit: int = 200000
    offer_trust_score_freshness_hours: int = 72
    offer_trust_score_stock_window_days: int = 14
    b2b_enabled: bool = False
    b2b_click_dedupe_window_seconds: int = 120
    b2b_click_token_ttl_seconds: int = 900
    b2b_default_click_price_uzs: float = 0.0
    b2b_shadow_billing_enabled: bool = False
    b2b_invoice_due_days: int = 7
    b2b_low_balance_threshold_uzs: float = 100000.0
    normalization_rules_enabled: bool = True
    normalization_rules_path: str = "services/worker/app/platform/services/normalization_rules.yaml"
    normalization_rules_reload_seconds: int = 60
    canonical_index_cache_enabled: bool = True
    canonical_index_cache_ttl_seconds: int = 21600
    canonical_index_cache_prefix: str = "canonidx"
    admin_alerts_enabled: bool = True
    admin_alert_quality_warn_ratio: float = 0.20
    admin_alert_quality_critical_ratio: float = 0.40
    admin_alert_search_mismatch_warn_ratio: float = 0.03
    admin_alert_search_mismatch_critical_ratio: float = 0.10
    admin_alert_moderation_pending_warn: int = 200
    admin_alert_moderation_pending_critical: int = 500
    admin_alert_order_cancel_rate_warn: float = 0.08
    admin_alert_order_cancel_rate_critical: float = 0.15
    admin_alert_operation_failed_rate_warn: float = 0.10
    admin_alert_operation_failed_rate_critical: float = 0.20
    price_alerts_delivery_enabled: bool = True
    price_alerts_scan_limit: int = 500
    price_alerts_notify_cooldown_minutes: int = 720
    price_alerts_telegram_bot_token: str | None = None
    price_alerts_telegram_api_base: str = "https://api.telegram.org"
    price_alerts_email_enabled: bool = True
    price_alerts_email_from: str = "noreply@localhost"
    price_alerts_smtp_host: str = ""
    price_alerts_smtp_port: int = 587
    price_alerts_smtp_username: str = ""
    price_alerts_smtp_password: str = ""
    price_alerts_smtp_use_tls: bool = True
    price_alerts_smtp_use_ssl: bool = False
    price_alerts_email_timeout_seconds: float = 10.0
    price_alerts_webhook_url: str | None = None
    price_alerts_webhook_secret: str = ""
    price_alerts_webhook_timeout_seconds: float = 10.0
    worker_metrics_port: int = 9108

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_version_header_value: str = "v1"
    api_security_headers_enabled: bool = True
    api_cors_allow_credentials: bool = True
    api_cors_allow_methods: list[str] = Field(default_factory=lambda: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    api_cors_allow_headers: list[str] = Field(
        default_factory=lambda: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"]
    )
    api_strict_transport_security: str = "max-age=31536000; includeSubDomains"
    api_content_security_policy: str = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    api_referrer_policy: str = "strict-origin-when-cross-origin"
    api_permissions_policy: str = "camera=(), microphone=(), geolocation=()"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"])
    cursor_secret: str = ""
    admin_seed_enabled: bool = False
    admin_email: str = "admin@zinc.local"
    admin_password: str = ""
    admin_full_name: str = "Platform Admin"
    admin_role: Literal["admin", "moderator"] = "admin"
    auth_storage_mode: Literal["redis", "dual", "postgres"] = "redis"
    auth_session_cleanup_enabled: bool = True
    auth_session_cleanup_max_age_days: int = 90
    auth_session_cleanup_scan_limit: int = 50000
    auth_lockout_enabled: bool = True
    auth_lockout_window_seconds: int = 900
    auth_lockout_block_seconds: int = 900
    auth_lockout_max_attempts_ip: int = 25
    auth_lockout_max_attempts_email: int = 8
    auth_password_reset_ttl_seconds: int = 1800
    auth_password_reset_debug_return_token: bool = False
    auth_email_confirmation_ttl_seconds: int = 86400
    auth_email_confirmation_debug_return_token: bool = False
    auth_email_delivery_enabled: bool = True
    auth_email_from: str = "noreply@localhost"
    auth_smtp_host: str = ""
    auth_smtp_port: int = 587
    auth_smtp_username: str = ""
    auth_smtp_password: str = ""
    auth_smtp_use_tls: bool = True
    auth_smtp_use_ssl: bool = False
    auth_email_timeout_seconds: float = 10.0
    auth_token_cleanup_enabled: bool = True
    auth_password_reset_used_retention_days: int = 7
    auth_email_confirmation_used_retention_days: int = 30
    auth_session_token_revoked_retention_days: int = 30
    auth_session_revoked_retention_days: int = 30
    auth_2fa_challenge_ttl_seconds: int = 300
    auth_oauth_state_ttl_seconds: int = 600
    auth_ephemeral_cleanup_enabled: bool = True
    auth_ephemeral_cleanup_scan_limit: int = 20000
    auth_legacy_redis_cleanup_enabled: bool = True
    auth_legacy_redis_cleanup_grace_days: int = 30
    auth_legacy_redis_cleanup_scan_limit: int = 20000
    health_check_timeout_seconds: float = 2.0
    health_require_celery_worker: bool = False
    idempotency_enabled: bool = True
    idempotency_ttl_seconds: int = 86400
    sentry_enabled: bool = False
    sentry_dsn: str | None = None
    sentry_release: str = ""
    sentry_traces_sample_rate: float = 0.10
    sentry_profiles_sample_rate: float = 0.0
    sentry_send_default_pii: bool = False
    sentry_ignored_errors: list[str] = Field(
        default_factory=lambda: [
            "cancellederror",
            "clientdisconnect",
            "connectionreseterror",
            "brokenpipeerror",
            "upstream blocked requests",
            "rate limit exceeded",
        ]
    )
    slo_api_5xx_target_ratio: float = 0.005
    slo_api_latency_p95_target_seconds: float = 0.5
    slo_api_latency_p99_target_seconds: float = 1.0
    next_public_app_url: str = "http://localhost"
    oauth_totp_issuer: str = "Doxx"
    oauth_google_client_id: str | None = None
    oauth_google_client_secret: str | None = None
    oauth_facebook_client_id: str | None = None
    oauth_facebook_client_secret: str | None = None

    user_agents: list[str] = Field(
        default_factory=lambda: [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/123.0",
        ]
    )
    proxies: list[str] = Field(default_factory=list)

    example_store_base_url: HttpUrl = "https://example.com"
    example_store_category_paths: list[str] = Field(default_factory=lambda: ["/phones", "/laptops"])

    @model_validator(mode="after")
    def _validate_security_sensitive_settings(self) -> "Settings":
        env_name = str(self.environment or "").strip().lower()
        secret = str(self.cursor_secret or "").strip()
        if env_name in {"staging", "production"} and (not secret or secret == "change-me-cursor-secret"):
            raise ValueError("CURSOR_SECRET must be explicitly set to a non-default secret in staging/production")
        if env_name == "local" and (not secret or secret == "change-me-cursor-secret"):
            self.cursor_secret = "dev-local-cursor-secret"

        if bool(self.admin_seed_enabled):
            password = str(self.admin_password or "").strip()
            if not password or password == "Admin12345":
                raise ValueError("ADMIN_PASSWORD must be explicitly set when ADMIN_SEED_ENABLED=true")
            if str(self.environment or "").strip().lower() in {"staging", "production"}:
                raise ValueError("ADMIN_SEED_ENABLED must be false in staging/production")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
