from __future__ import annotations

import json
import re
from typing import Any

import openai
from openai import AsyncOpenAI


class ModelProviderError(RuntimeError):
    """A permanent, safely reportable model provider failure."""


class TransientModelProviderError(ModelProviderError):
    """A model provider failure that can be retried."""


class ModelResponseError(ModelProviderError):
    """The provider returned a response that violates the model contract."""


class DeepSeekModel:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.deepseek.com",
        model: str = "deepseek-v4-pro",
        client: AsyncOpenAI | Any | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.client = client or AsyncOpenAI(api_key=api_key, base_url=self.base_url, timeout=120)
        self._owns_client = client is None

    async def complete_json(self, system_prompt: str, payload: dict) -> dict:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ],
                stream=False,
                temperature=0.1,
                response_format={"type": "json_object"},
                reasoning_effort="high",
                extra_body={"thinking": {"type": "enabled"}},
            )
        except (openai.APITimeoutError, openai.APIConnectionError):
            raise TransientModelProviderError("DeepSeek is temporarily unavailable") from None
        except openai.APIStatusError as exc:
            if exc.status_code == 429 or exc.status_code >= 500:
                raise TransientModelProviderError("DeepSeek is temporarily unavailable") from None
            raise ModelProviderError(
                f"DeepSeek request rejected with HTTP {exc.status_code}"
            ) from None
        except openai.APIError:
            raise ModelProviderError("DeepSeek request failed") from None

        try:
            content = response.choices[0].message.content
        except (AttributeError, IndexError, TypeError):
            raise ModelResponseError("DeepSeek returned an invalid response envelope") from None
        if not isinstance(content, str):
            raise ModelResponseError("DeepSeek returned invalid message content")

        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            raise ModelResponseError("DeepSeek returned invalid JSON") from None
        if not isinstance(parsed, dict):
            raise ModelResponseError("DeepSeek response must be a JSON object")
        return parsed

    async def aclose(self) -> None:
        if self._owns_client:
            await self.client.close()
