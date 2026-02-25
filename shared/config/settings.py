from functools import lru_cache
from typing import Literal

from pydantic import Field, HttpUrl
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
    quality_report_alert_webhook_url: str | None = None
    quality_report_alert_min_status: Literal["warning", "critical"] = "critical"
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

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"])
    cursor_secret: str = "change-me-cursor-secret"
    admin_seed_enabled: bool = True
    admin_email: str = "admin@zinc.local"
    admin_password: str = "Admin12345"
    admin_full_name: str = "Platform Admin"
    admin_role: Literal["admin", "moderator"] = "admin"
    auth_storage_mode: Literal["redis", "dual", "postgres"] = "redis"
    auth_session_cleanup_enabled: bool = True
    auth_session_cleanup_max_age_days: int = 90
    auth_session_cleanup_scan_limit: int = 50000
    auth_password_reset_ttl_seconds: int = 1800
    auth_password_reset_debug_return_token: bool = False
    next_public_app_url: str = "http://localhost"
    oauth_totp_issuer: str = "ZincMarket"
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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
