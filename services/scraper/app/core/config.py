from functools import lru_cache
from typing import Literal

from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

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

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"])
    cursor_secret: str = "change-me-cursor-secret"

    user_agents: list[str] = Field(
        default_factory=lambda: [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/123.0",
        ]
    )
    proxies: list[str] = Field(default_factory=list)

    scraper_provider: Literal["mediapark", "texnomart", "example"] = "texnomart"

    mediapark_base_url: HttpUrl = "https://mediapark.uz"
    mediapark_category_paths: list[str] = Field(
        default_factory=lambda: ["/products/category/smartfony-po-brendu-660/smartfony-apple-iphone-211"]
    )

    texnomart_base_url: HttpUrl = "https://texnomart.uz"
    texnomart_category_paths: list[str] = Field(default_factory=lambda: ["/ru/katalog/smartfony"])

    example_store_base_url: HttpUrl = "https://example.com"
    example_store_category_paths: list[str] = Field(default_factory=lambda: ["/phones", "/laptops"])


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
