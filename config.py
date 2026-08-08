"""
Centralized application configuration.

Every environment variable the project reads used to be a scattered
`os.getenv(...)` call in db.py, storage.py, deepseek_parser.py, security.py,
and web_app.py, each with its own inline default and no validation - a
typo'd variable name silently becomes "not configured" instead of a
startup error, and nothing documents the full set of knobs in one place.

This module is the single source of truth: one `Settings` object, built
once at import time via `pydantic-settings`, validated at process start
(fails fast and loud instead of failing confusingly at request time), and
every other module imports `settings` from here instead of calling
`os.getenv` directly.

Existing env var names are preserved exactly (DB_PATH, DEEPSEEK_API_KEY,
R2_ACCOUNT_ID, etc.) so this is a drop-in change - no .env file needs to
change, only the code that reads it.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # --- App / environment -------------------------------------------
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: Literal["json", "console"] = "console"

    # --- Server ---------------------------------------------------------
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    # Comma-separated in the env var; parsed into a list below. Tighten
    # this to your real frontend domain(s) before going to production -
    # "*" (the old hardcoded default) allows any site to call the API
    # from a browser, which is fine for local dev only.
    CORS_ORIGINS: str = "*"

    # --- Persistence ------------------------------------------------
    DB_PATH: str = "nl_to_cad.db"
    OUTPUT_DIR: str = "./output"

    # --- Rate limiting (slowapi / limits syntax, e.g. "20/minute") ---
    RATE_LIMIT_GENERATE: str = "20/minute"
    RATE_LIMIT_KEY_ISSUE: str = "5/hour"

    # --- DeepSeek parser ------------------------------------------------
    DEEPSEEK_API_KEY: str | None = None
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    DEEPSEEK_DEFAULT_MODEL: str = "deepseek-v4-flash"
    DEEPSEEK_TIMEOUT_SECONDS: float = 20.0

    # --- Cloudflare R2 storage (optional; falls back to local disk) ----
    R2_ACCOUNT_ID: str | None = None
    R2_ACCESS_KEY_ID: str | None = None
    R2_SECRET_ACCESS_KEY: str | None = None
    R2_BUCKET_NAME: str | None = None
    R2_PUBLIC_URL: str | None = None
    R2_PRESIGNED_EXPIRY_SECONDS: int = 7 * 24 * 3600

    # --- OKX / x402 (a2mcp/) ------------------------------------------
    OKX_API_KEY: str | None = None
    OKX_SECRET_KEY: str | None = None
    OKX_PASSPHRASE: str | None = None
    PAY_TO_ADDRESS: str | None = None

    @field_validator("LOG_LEVEL")
    @classmethod
    def _validate_log_level(cls, v: str) -> str:
        v = v.upper()
        valid = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        if v not in valid:
            raise ValueError(f"LOG_LEVEL must be one of {valid}, got {v!r}")
        return v

    @property
    def cors_origins_list(self) -> list[str]:
        if self.CORS_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def r2_configured(self) -> bool:
        return bool(self.R2_ACCOUNT_ID and self.R2_ACCESS_KEY_ID and self.R2_SECRET_ACCESS_KEY)


@lru_cache
def get_settings() -> Settings:
    """Cached so `Settings()` (which reads the environment and .env file)
    only runs once per process; call `get_settings.cache_clear()` in tests
    that need to reload with different env vars."""
    return Settings()


settings = get_settings()
