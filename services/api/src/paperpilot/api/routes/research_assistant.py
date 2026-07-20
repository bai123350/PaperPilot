from __future__ import annotations

import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from paperpilot.api.deps import current_user
from paperpilot.database import UserEntity
from paperpilot.domain.models import ResearchBrief
from paperpilot.models.deepseek import DeepSeekModel, ModelProviderError


router = APIRouter(prefix="/v1/research-assistant", tags=["research-assistant"])


class AssistantMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ResearchAssistantRequest(BaseModel):
    contract_version: Literal["1.0"] = "1.0"
    brief: ResearchBrief
    messages: list[AssistantMessage] = Field(min_length=1, max_length=12)


class ResearchAssistantResponse(BaseModel):
    contract_version: Literal["1.0"] = "1.0"
    message: AssistantMessage


@router.post("/messages", response_model=ResearchAssistantResponse)
async def create_message(
    payload: ResearchAssistantRequest,
    request: Request,
    _user: Annotated[UserEntity, Depends(current_user)],
) -> ResearchAssistantResponse:
    settings = request.app.state.settings
    if settings.demo_mode:
        reply = _demo_reply(payload.brief)
    else:
        model = DeepSeekModel(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            model=settings.deepseek_model,
        )
        try:
            context = json.dumps(payload.brief.model_dump(mode="json"), ensure_ascii=False)
            reply = await model.complete_text(
                (
                    "You help a biomedical researcher refine a research question before a "
                    "literature review. Use the supplied research brief as context. Ask focused "
                    "clarifying questions or give concrete research-design suggestions. Do not "
                    "provide diagnosis or treatment advice. Reply in concise Simplified Chinese. "
                    f"Current research brief: {context}"
                ),
                [message.model_dump() for message in payload.messages],
            )
        except ModelProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="研究助手暂时不可用，请稍后重试",
            ) from exc
        finally:
            await model.aclose()
    return ResearchAssistantResponse(message=AssistantMessage(role="assistant", content=reply))


def _demo_reply(brief: ResearchBrief) -> str:
    missing = []
    if not brief.population:
        missing.append("研究人群")
    if not brief.intervention:
        missing.append("干预或暴露")
    if not brief.outcomes:
        missing.append("主要结局")
    if missing:
        return (
            f"当前问题已经具备研究主题。建议下一步明确{'、'.join(missing)}，"
            "这样可以减少检索噪声并让纳入标准更可执行。你希望先补充哪一项？"
        )
    return (
        "当前研究问题已包含人群、干预或暴露和结局。建议再确认对照条件与时间范围，"
        "并说明更关注疗效、预测价值还是安全性，我可以据此继续收紧检索边界。"
    )
