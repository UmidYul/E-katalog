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
    scrape_inter_request_delay_seconds: float = 0.7
    legacy_write_enabled: bool = False
    ingest_unknown_policy: Literal["fallback_phones", "quarantine"] = "quarantine"
    ingest_category_confidence_threshold: float = 0.70
    ingest_quarantine_enabled: bool = True
    ingest_max_price_uzs: int = 200000000
    scrape_delay_jitter_ratio: float = 0.2
    scrape_default_domain_concurrency: int = 2
    scrape_default_domain_delay_seconds: float = 2.0
    scrape_texnomart_concurrency: int = 3
    scrape_texnomart_delay_seconds: float = 1.5
    scrape_mediapark_concurrency: int = 5
    scrape_mediapark_delay_seconds: float = 1.0
    scrape_asaxiy_concurrency: int = 2
    scrape_asaxiy_delay_seconds: float = 2.0
    scrape_product_limit: int = 0
    max_retries: int = 5
    task_retry_backoff_max_seconds: int = 600
    crawl_interval_minutes: int = 360
    rate_limit_cooldown_seconds: int = 1800

    playwright_headless: bool = True
    ai_spec_enrichment_enabled: bool = False
    ai_spec_strict_mode: bool = False
    ai_spec_max_attempts: int = 2
    ai_request_max_retries: int = 4
    ai_request_base_delay_seconds: float = 1.5
    ai_request_max_delay_seconds: float = 20.0
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
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

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"])
    cursor_secret: str = ""

    user_agents: list[str] = Field(
        default_factory=lambda: [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/123.0",
        ]
    )
    proxies: list[str] = Field(default_factory=list)
    proxy_texnomart: str = ""
    proxy_mediapark: str = ""
    proxy_asaxiy: str = ""

    scraper_provider: Literal["mediapark", "texnomart", "alifshop", "asaxiy", "example"] = "texnomart"

    mediapark_base_url: HttpUrl = "https://mediapark.uz"
    mediapark_category_paths: list[str] = Field(
        default_factory=lambda: [
            "/products/category/smartfony-po-brendu-660/smartfony-samsung-210",
            "/products/category/smartfony-po-brendu-660/smartfony-apple-iphone-211",
        ]
    )

    texnomart_base_url: HttpUrl = "https://texnomart.uz"
    texnomart_category_paths: list[str] = Field(
        default_factory=lambda: [
            "/katalog/smartfony-apple/",
            "/katalog/smartfon-samsung/",
        ]
    )

    alifshop_base_url: HttpUrl = "https://alifshop.uz"
    alifshop_category_paths: list[str] = Field(
        default_factory=lambda: [
            "/ru/categories/smartfoni-apple",
            "/ru/categories/smartfoni-samsung",
        ]
    )

    asaxiy_base_url: HttpUrl = "https://asaxiy.uz"
    asaxiy_category_paths: list[str] = Field(
        default_factory=lambda: [
            "/product/telefony-i-gadzhety/telefony/smartfony",
        ]
    )

    example_store_base_url: HttpUrl = "https://example.com"
    example_store_category_paths: list[str] = Field(default_factory=lambda: ["/phones", "/laptops"])

    @model_validator(mode="after")
    def _validate_cursor_secret(self) -> "Settings":
        env_name = str(self.environment or "").strip().lower()
        secret = str(self.cursor_secret or "").strip()
        if env_name in {"staging", "production"} and (not secret or secret == "change-me-cursor-secret"):
            raise ValueError("CURSOR_SECRET must be explicitly set to a non-default secret in staging/production")
        if env_name == "local" and (not secret or secret == "change-me-cursor-secret"):
            self.cursor_secret = "dev-local-cursor-secret"
        return self

    @staticmethod
    def _parse_proxy_env(raw_value: str | None) -> list[str]:
        if not raw_value:
            return []
        value = str(raw_value).strip()
        if not value:
            return []
        normalized = value.replace("\n", ",").replace(";", ",")
        return [item.strip() for item in normalized.split(",") if item.strip()]

    def proxies_for_host(self, host: str | None) -> list[str]:
        hostname = str(host or "").strip().lower()
        if not hostname:
            return []
        if hostname.endswith("texnomart.uz"):
            return self._parse_proxy_env(self.proxy_texnomart)
        if hostname.endswith("mediapark.uz"):
            return self._parse_proxy_env(self.proxy_mediapark)
        if hostname.endswith("asaxiy.uz"):
            return self._parse_proxy_env(self.proxy_asaxiy)
        return []

    def scrape_limits_for_host(self, host: str | None) -> tuple[int, float]:
        hostname = str(host or "").strip().lower()
        if hostname.endswith("texnomart.uz"):
            return max(1, int(self.scrape_texnomart_concurrency)), max(0.0, float(self.scrape_texnomart_delay_seconds))
        if hostname.endswith("mediapark.uz"):
            return max(1, int(self.scrape_mediapark_concurrency)), max(0.0, float(self.scrape_mediapark_delay_seconds))
        if hostname.endswith("asaxiy.uz"):
            return max(1, int(self.scrape_asaxiy_concurrency)), max(0.0, float(self.scrape_asaxiy_delay_seconds))
        default_concurrency = int(self.scrape_default_domain_concurrency or self.request_concurrency)
        default_delay = float(self.scrape_default_domain_delay_seconds or self.scrape_inter_request_delay_seconds)
        return max(1, default_concurrency), max(0.0, default_delay)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
