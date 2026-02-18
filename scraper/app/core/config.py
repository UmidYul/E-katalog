from functools import lru_cache
from typing import Literal

from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    environment: Literal["local", "staging", "production"] = "local"
    log_level: str = "INFO"

    database_url: str = Field(default="postgresql+asyncpg://postgres:postgres@db:5432/scraper")
    redis_url: str = Field(default="redis://redis:6379/0")

    celery_broker_url: str = Field(default="redis://redis:6379/1")
    celery_result_backend: str = Field(default="redis://redis:6379/2")

    default_timeout_seconds: float = 20.0
    request_concurrency: int = 20
    max_retries: int = 5
    crawl_interval_minutes: int = 360

    playwright_headless: bool = True

    user_agents: list[str] = Field(
        default_factory=lambda: [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/123.0",
        ]
    )
    proxies: list[str] = Field(default_factory=list)

    example_store_base_url: HttpUrl = "https://example-store.uz"
    example_store_category_paths: list[str] = Field(default_factory=lambda: ["/phones", "/laptops"])


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
