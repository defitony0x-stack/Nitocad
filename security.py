"""
API key authentication for nl-to-cad, backed by db.py's sqlite3 layer.

Same principle as Stitchfren's app/core/security.py (hash on write, hash
on read, never persist or log the raw key) - reimplemented against plain
sqlite3 here instead of SQLAlchemy, matching db.py's choice.
"""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security.api_key import APIKeyHeader

import db

API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)


def get_current_key(api_key: Optional[str] = Depends(API_KEY_HEADER)) -> dict:
    """FastAPI dependency - raises 401/403 on missing/invalid/inactive
    key, otherwise returns the key's row (user_id, usage_count, etc.)."""
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="Missing API key. Generate one via POST /api/keys/generate "
            "and send it back as the X-API-Key header.",
        )

    key_info = db.validate_api_key(api_key)
    if key_info is None:
        raise HTTPException(status_code=401, detail="Invalid or deactivated API key")

    return key_info
