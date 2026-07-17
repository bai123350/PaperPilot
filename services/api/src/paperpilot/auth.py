from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time


class TokenError(ValueError):
    pass


class AuthService:
    def __init__(self, secret: str) -> None:
        self.secret = secret.encode("utf-8")

    def issue(self, user_id: str, ttl_seconds: int = 60 * 60 * 24 * 7) -> str:
        payload = {"sub": user_id, "exp": int(time.time()) + ttl_seconds}
        encoded = self._encode(json.dumps(payload, separators=(",", ":")).encode())
        signature = self._sign(encoded)
        return f"{encoded}.{signature}"

    def verify(self, token: str) -> str:
        try:
            encoded, supplied = token.split(".", 1)
            expected = self._sign(encoded)
            if not hmac.compare_digest(supplied, expected):
                raise TokenError("Invalid token signature")
            payload = json.loads(self._decode(encoded))
            if int(payload["exp"]) < int(time.time()):
                raise TokenError("Token expired")
            return str(payload["sub"])
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            if isinstance(exc, TokenError):
                raise
            raise TokenError("Invalid token") from exc

    def _sign(self, encoded: str) -> str:
        return self._encode(hmac.new(self.secret, encoded.encode(), hashlib.sha256).digest())

    @staticmethod
    def _encode(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).decode().rstrip("=")

    @staticmethod
    def _decode(value: str) -> bytes:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
