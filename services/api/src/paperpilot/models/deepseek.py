from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
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
        user_content = json.dumps(payload, ensure_ascii=False)
        for attempt in range(2):
            retry_instruction = (
                " The previous attempt was not a complete JSON object. Return one compact, "
                "complete JSON object only; omit Markdown and all explanatory text."
                if attempt
                else ""
            )
            response = await self._request_json_completion(
                f"{system_prompt}{retry_instruction}", user_content
            )
            content = self._response_content(response)
            try:
                return self._parse_json_object(content)
            except json.JSONDecodeError:
                if attempt == 1:
                    raise ModelResponseError("DeepSeek returned invalid JSON") from None
        raise ModelResponseError("DeepSeek returned invalid JSON")

    async def _request_json_completion(self, system_prompt: str, user_content: str) -> Any:
        try:
            return await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                stream=False,
                temperature=0.1,
                max_tokens=8192,
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

    @staticmethod
    def _response_content(response: Any) -> str:
        try:
            content = response.choices[0].message.content
        except (AttributeError, IndexError, TypeError):
            raise ModelResponseError("DeepSeek returned an invalid response envelope") from None
        if not isinstance(content, str):
            raise ModelResponseError("DeepSeek returned invalid message content")
        return content

    @staticmethod
    def _parse_json_object(content: str) -> dict:
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as original_error:
            decoder = json.JSONDecoder()
            candidates: list[tuple[int, dict]] = []
            for match in re.finditer(r"\{", cleaned):
                try:
                    candidate, length = decoder.raw_decode(cleaned[match.start() :])
                except json.JSONDecodeError:
                    continue
                if isinstance(candidate, dict):
                    candidates.append((length, candidate))
            if not candidates:
                raise original_error
            parsed = max(candidates, key=lambda item: item[0])[1]
        if not isinstance(parsed, dict):
            raise ModelResponseError("DeepSeek response must be a JSON object")
        return parsed

    async def complete_text(self, system_prompt: str, messages: list[dict[str, str]]) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": system_prompt}, *messages],
                stream=False,
                temperature=0.2,
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
        if not isinstance(content, str) or not content.strip():
            raise ModelResponseError("DeepSeek returned invalid message content")
        return content.strip()

    async def stream_text(
        self, system_prompt: str, messages: list[dict[str, str]]
    ) -> AsyncIterator[str]:
        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": system_prompt}, *messages],
                stream=True,
                temperature=0.2,
                reasoning_effort="high",
                extra_body={"thinking": {"type": "enabled"}},
            )
            async for chunk in stream:
                try:
                    content = chunk.choices[0].delta.content
                except (AttributeError, IndexError, TypeError):
                    continue
                if isinstance(content, str) and content:
                    yield content
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

    async def aclose(self) -> None:
        if self._owns_client:
            await self.client.close()
