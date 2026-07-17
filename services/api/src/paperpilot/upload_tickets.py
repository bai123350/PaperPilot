from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone


class UploadTicketError(ValueError):
    pass


@dataclass(frozen=True)
class UploadTicket:
    user_id: str
    project_id: str
    filename: str
    max_size: int
    expires_at: datetime


class UploadTicketService:
    def __init__(self, secret: str) -> None:
        self.secret = secret.encode()

    def issue(
        self,
        user_id: str,
        project_id: str,
        filename: str,
        max_size: int,
        ttl_seconds: int = 900,
    ) -> tuple[str, datetime]:
        expires = int(time.time()) + ttl_seconds
        payload = {
            "user_id": user_id,
            "project_id": project_id,
            "filename": filename,
            "max_size": max_size,
            "exp": expires,
        }
        encoded = self._encode(json.dumps(payload, separators=(",", ":")).encode())
        signature = self._encode(hmac.new(self.secret, encoded.encode(), hashlib.sha256).digest())
        return f"{encoded}.{signature}", datetime.fromtimestamp(expires, tz=timezone.utc)

    def verify(self, token: str) -> UploadTicket:
        try:
            encoded, supplied = token.split(".", 1)
            expected = self._encode(hmac.new(self.secret, encoded.encode(), hashlib.sha256).digest())
            if not hmac.compare_digest(supplied, expected):
                raise UploadTicketError("Invalid upload signature")
            payload = json.loads(self._decode(encoded))
            if int(payload["exp"]) < int(time.time()):
                raise UploadTicketError("Upload ticket expired")
            return UploadTicket(
                user_id=str(payload["user_id"]),
                project_id=str(payload["project_id"]),
                filename=str(payload["filename"]),
                max_size=int(payload["max_size"]),
                expires_at=datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc),
            )
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            if isinstance(exc, UploadTicketError):
                raise
            raise UploadTicketError("Invalid upload ticket") from exc

    @staticmethod
    def _encode(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).decode().rstrip("=")

    @staticmethod
    def _decode(value: str) -> bytes:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
