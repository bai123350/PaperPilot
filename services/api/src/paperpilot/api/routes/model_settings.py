from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from paperpilot.api.deps import current_user, get_session
from paperpilot.database import UserEntity
from paperpilot.services.model_settings import ModelSettingsValidationError


router = APIRouter(prefix="/v1/model-settings", tags=["model-settings"])


class ModelSettingsResponse(BaseModel):
    provider: Literal["deepseek", "openai", "qwen", "custom"]
    model: str
    base_url: str
    configured: bool
    api_key_hint: str | None


class SaveModelSettingsRequest(BaseModel):
    provider: Literal["deepseek", "openai", "qwen", "custom"]
    model: str = Field(min_length=1, max_length=200)
    base_url: str = Field(min_length=1, max_length=1000)
    api_key: str = Field(default="", max_length=4096)


@router.get("", response_model=ModelSettingsResponse)
def get_model_settings(
    request: Request,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    return request.app.state.model_settings_store.public(session, user.id)


@router.put("", response_model=ModelSettingsResponse)
def save_model_settings(
    payload: SaveModelSettingsRequest,
    request: Request,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    try:
        return request.app.state.model_settings_store.save(
            session,
            user.id,
            provider=payload.provider,
            model=payload.model,
            base_url=payload.base_url,
            api_key=payload.api_key,
        )
    except ModelSettingsValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
