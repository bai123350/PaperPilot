from __future__ import annotations

import json
import re

import httpx


class OpenAICompatibleModel:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.client = client or httpx.AsyncClient(timeout=120)

    async def complete_json(self, system_prompt: str, payload: dict) -> dict:
        response = await self.client.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": self.model,
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ],
            },
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ValueError("Model response must be a JSON object")
        return parsed
