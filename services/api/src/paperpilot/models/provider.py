from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias

from paperpilot.config import Settings
from paperpilot.models.deepseek import DeepSeekModel, ModelProviderError


ConversationModel: TypeAlias = str


@dataclass(frozen=True)
class ModelClientConfig:
    provider: str
    model: str
    base_url: str
    api_key: str


def create_model_client(
    settings: Settings,
    model: ConversationModel | None = None,
    stored: ModelClientConfig | None = None,
) -> DeepSeekModel:
    if stored is not None:
        selected = (
            model
            if stored.provider == "deepseek"
            and model in {"deepseek-v4-flash", "deepseek-v4-pro"}
            else stored.model
        )
        return DeepSeekModel(
            api_key=stored.api_key,
            base_url=stored.base_url,
            model=selected,
            provider=stored.provider,
        )

    selected = model or settings.deepseek_model
    if selected not in {
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "gpt-5-mini",
        "qwen-plus",
    }:
        raise ModelProviderError("Requested model is not configured")
    if selected == "gpt-5-mini":
        provider = "openai"
        api_key = settings.openai_api_key
        base_url = settings.openai_base_url
    elif selected == "qwen-plus":
        provider = "qwen"
        api_key = settings.qwen_api_key
        base_url = settings.qwen_base_url
    else:
        provider = "deepseek"
        api_key = settings.deepseek_api_key
        base_url = settings.deepseek_base_url

    if not api_key:
        raise ModelProviderError("Selected model provider is not configured")
    return DeepSeekModel(
        api_key=api_key,
        base_url=base_url,
        model=selected,
        provider=provider,
    )
