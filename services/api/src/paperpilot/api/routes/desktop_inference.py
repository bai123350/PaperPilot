from __future__ import annotations

import hashlib
import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from paperpilot.auth import TokenError


router = APIRouter(prefix="/v1/desktop", tags=["desktop-inference"])
bearer = HTTPBearer(auto_error=False)


class InstallationRequest(BaseModel):
    contract_version: Literal["1.0"]
    installation_id: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")


class InferenceRequest(BaseModel):
    contract_version: Literal["1.0"]
    request_id: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    operation: Literal[
        "classify_intent",
        "structure_question",
        "extract_evidence",
        "synthesize_report",
        "grounded_reply",
        "revise_report",
    ]
    payload: dict[str, Any]
    allowed_evidence_ids: list[str] = Field(default_factory=list, max_length=500)


@router.post("/installations", status_code=status.HTTP_201_CREATED)
def create_installation(payload: InstallationRequest, request: Request) -> dict[str, str]:
    subject = f"desktop:{payload.installation_id}"
    return {
        "contract_version": "1.0",
        "access_token": request.app.state.auth.issue(subject, ttl_seconds=60 * 60 * 24 * 30),
        "token_type": "bearer",
    }


@router.post("/inference")
def execute_inference(
    payload: InferenceRequest,
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(bearer)],
) -> dict[str, Any]:
    installation = _installation_subject(request, credentials)
    cache_key = (installation, payload.request_id)
    fingerprint = hashlib.sha256(
        json.dumps(payload.model_dump(), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    cached = request.app.state.desktop_inference_cache.get(cache_key)
    if cached:
        if cached["fingerprint"] != fingerprint:
            raise HTTPException(status_code=409, detail="request_id was reused with different input")
        return cached["response"]

    requested = set(payload.payload.get("requested_evidence_ids", []))
    allowed = set(payload.allowed_evidence_ids)
    if not requested.issubset(allowed):
        raise HTTPException(
            status_code=422,
            detail="requested evidence is outside the current run",
        )

    response = {
        "contract_version": "1.0",
        "request_id": payload.request_id,
        "operation": payload.operation,
        "result": _demo_result(payload),
    }
    request.app.state.desktop_inference_cache[cache_key] = {
        "fingerprint": fingerprint,
        "response": response,
    }
    return response


def _installation_subject(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> str:
    if not credentials:
        raise HTTPException(status_code=401, detail="installation token required")
    try:
        subject = request.app.state.auth.verify(credentials.credentials)
    except TokenError as exc:
        raise HTTPException(status_code=401, detail="invalid installation token") from exc
    if not subject.startswith("desktop:"):
        raise HTTPException(status_code=403, detail="desktop installation token required")
    return subject


def _demo_result(payload: InferenceRequest) -> dict[str, Any]:
    if payload.operation == "classify_intent":
        content = str(payload.payload.get("content", ""))
        discussion_markers = ("为什么", "为何", "如何", "依据", "证据")
        revision_markers = ("把", "请将", "调整", "修改", "纠正", "改为", "补充", "限制为")
        action = (
            "revise_report"
            if not any(marker in content for marker in discussion_markers)
            and any(marker in content for marker in revision_markers)
            else "discuss"
        )
        return {"action": action}
    if payload.operation == "grounded_reply":
        return {
            "content": "回答仅基于当前运行允许的 Evidence Record。",
            "evidence_ids": payload.payload.get("requested_evidence_ids", []),
        }
    return {"accepted": True, "mode": "demo"}
