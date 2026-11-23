from __future__ import annotations

import base64
from datetime import datetime
from uuid import UUID

from .database import ServiceError


def encode_cursor(row: dict) -> str:
    return base64.urlsafe_b64encode(
        f"{row['created_at'].isoformat()}|{row['id']}".encode()
    ).decode()


def decode_cursor(value: str | None):
    if not value:
        return None
    try:
        if len(value) > 200:
            raise ValueError
        stamp, identity = base64.b64decode(value, altchars=b"-_", validate=True).decode().split("|")
        timestamp = datetime.fromisoformat(stamp)
        if timestamp.tzinfo is None:
            raise ValueError
        return timestamp, UUID(identity)
    except (ValueError, UnicodeError) as exc:
        raise ServiceError(400, "invalid_cursor") from exc
