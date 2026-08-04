from __future__ import annotations

import base64
import hashlib
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from paperpilot.database import ModelSettingsEntity
from paperpilot.models.deepseek import ModelProviderError
from paperpilot.models.provider import ModelClientConfig


class ModelSettingsValidationError(ValueError):
    pass


class ModelSettingsStore:
    def __init__(self, secret: str) -> None:
        key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
        self.cipher = Fernet(key)

    def public(self, session: Session, user_id: str) -> dict:
        entity = session.get(ModelSettingsEntity, user_id)
        if entity is None:
            return {
                "provider": "deepseek",
                "model": "deepseek-v4-pro",
                "base_url": "https://api.deepseek.com",
                "configured": False,
                "api_key_hint": None,
            }
        return {
            "provider": entity.provider,
            "model": entity.model,
            "base_url": entity.base_url,
            "configured": True,
            "api_key_hint": entity.api_key_hint,
        }

    def save(
        self,
        session: Session,
        user_id: str,
        *,
        provider: str,
        model: str,
        base_url: str,
        api_key: str,
    ) -> dict:
        provider = provider.strip().lower()
        model = model.strip()
        base_url = base_url.strip().rstrip("/")
        api_key = api_key.strip()
        self._validate(provider, model, base_url)

        entity = session.get(ModelSettingsEntity, user_id)
        if not api_key:
            if entity is None or entity.provider != provider:
                raise ModelSettingsValidationError(
                    "切换大模型厂商时需要填写对应的 API Key"
                )
            encrypted_api_key = entity.encrypted_api_key
            api_key_hint = entity.api_key_hint
        else:
            encrypted_api_key = self.cipher.encrypt(api_key.encode("utf-8")).decode("ascii")
            api_key_hint = self._hint(api_key)

        if entity is None:
            entity = ModelSettingsEntity(
                user_id=user_id,
                provider=provider,
                model=model,
                base_url=base_url,
                encrypted_api_key=encrypted_api_key,
                api_key_hint=api_key_hint,
            )
            session.add(entity)
        else:
            entity.provider = provider
            entity.model = model
            entity.base_url = base_url
            entity.encrypted_api_key = encrypted_api_key
            entity.api_key_hint = api_key_hint
        session.commit()
        return self.public(session, user_id)

    def resolve(self, session: Session, user_id: str) -> ModelClientConfig | None:
        entity = session.get(ModelSettingsEntity, user_id)
        if entity is None:
            return None
        try:
            api_key = self.cipher.decrypt(
                entity.encrypted_api_key.encode("ascii")
            ).decode("utf-8")
        except (InvalidToken, UnicodeDecodeError) as exc:
            raise ModelProviderError("Stored model credential cannot be decrypted") from exc
        return ModelClientConfig(
            provider=entity.provider,
            model=entity.model,
            base_url=entity.base_url,
            api_key=api_key,
        )

    @staticmethod
    def _validate(provider: str, model: str, base_url: str) -> None:
        if provider not in {"deepseek", "openai", "qwen", "custom"}:
            raise ModelSettingsValidationError("不支持的大模型厂商")
        if not model or len(model) > 200:
            raise ModelSettingsValidationError("请输入有效的模型名称")
        if provider == "deepseek" and model not in {
            "deepseek-v4-flash",
            "deepseek-v4-pro",
        }:
            raise ModelSettingsValidationError("DeepSeek 模型名称无效")
        parsed = urlparse(base_url)
        localhost = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if not parsed.hostname or not (
            parsed.scheme == "https" or (parsed.scheme == "http" and localhost)
        ):
            raise ModelSettingsValidationError(
                "API 地址必须使用 HTTPS；本机服务可使用 http://localhost"
            )

    @staticmethod
    def _hint(api_key: str) -> str:
        suffix = api_key[-4:] if len(api_key) >= 4 else api_key
        return f"••••{suffix}"
