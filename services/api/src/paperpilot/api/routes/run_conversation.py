from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from paperpilot.api.deps import current_user, get_session
from paperpilot.api.routes.runs import owned_run
from paperpilot.database import (
    ConversationMessageEntity,
    EvidenceEntity,
    ReportRevisionEntity,
    RunEntity,
    UserEntity,
)
from paperpilot.domain.models import Report, RunStatus
from paperpilot.models.deepseek import DeepSeekModel, ModelProviderError, ModelResponseError
from paperpilot.services.llm_synthesis import SynthesisPayload


router = APIRouter(prefix="/v1/runs/{run_id}/conversation", tags=["run-conversation"])


class ConversationMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    evidence_ids: list[str] = Field(default_factory=list)
    report_version: int | None = None
    created_at: datetime


class ConversationResponse(BaseModel):
    contract_version: Literal["1.0"] = "1.0"
    report_version: int
    messages: list[ConversationMessage]


class SendMessageRequest(BaseModel):
    contract_version: Literal["1.0"] = "1.0"
    content: str = Field(min_length=1, max_length=4000)
    action: Literal["discuss", "revise_report"] = "discuss"


class StreamMessageRequest(BaseModel):
    contract_version: Literal["1.0"] = "1.0"
    content: str = Field(min_length=1, max_length=4000)
    append_user: bool = True


class SendMessageResponse(BaseModel):
    contract_version: Literal["1.0"] = "1.0"
    message: ConversationMessage
    report_updated: bool = False
    report_version: int


class BootstrapRequest(BaseModel):
    messages: list[dict[Literal["role", "content"], str]] = Field(max_length=24)


class GroundedReply(BaseModel):
    content: str = Field(min_length=1, max_length=6000)
    evidence_ids: list[str] = Field(default_factory=list)


def _message_payload(message: ConversationMessageEntity) -> ConversationMessage:
    return ConversationMessage(
        id=message.id,
        role=message.role,
        content=message.content,
        evidence_ids=list(message.evidence_ids or []),
        report_version=message.report_version,
        created_at=message.created_at,
    )


@router.get("", response_model=ConversationResponse)
def get_conversation(
    run_id: str,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ConversationResponse:
    run = owned_run(session, user.id, run_id)
    messages = list(
        session.scalars(
            select(ConversationMessageEntity)
            .where(ConversationMessageEntity.run_id == run_id)
            .order_by(ConversationMessageEntity.created_at, ConversationMessageEntity.id)
        )
    )
    return ConversationResponse(
        report_version=run.report_version,
        messages=[_message_payload(message) for message in messages],
    )


@router.post("/bootstrap", response_model=ConversationResponse)
def bootstrap_conversation(
    run_id: str,
    payload: BootstrapRequest,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ConversationResponse:
    owned_run(session, user.id, run_id)
    existing = session.scalar(
        select(ConversationMessageEntity.id).where(ConversationMessageEntity.run_id == run_id)
    )
    if not existing:
        for raw in payload.messages:
            role = raw.get("role")
            content = raw.get("content", "").strip()
            if role in {"user", "assistant"} and content:
                session.add(
                    ConversationMessageEntity(
                        run_id=run_id,
                        role=role,
                        content=content[:4000],
                        evidence_ids=[],
                    )
                )
        session.commit()
    return get_conversation(run_id, user, session)


@router.post("/messages", response_model=SendMessageResponse)
async def send_message(
    run_id: str,
    payload: SendMessageRequest,
    request: Request,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> SendMessageResponse:
    run = owned_run(session, user.id, run_id)
    if payload.action == "revise_report" and run.status != RunStatus.COMPLETED.value:
        raise HTTPException(status_code=409, detail="研究完成后才能修订报告")

    user_message = ConversationMessageEntity(
        run_id=run_id,
        role="user",
        content=payload.content.strip(),
        evidence_ids=[],
        report_version=run.report_version if run.report else None,
    )
    session.add(user_message)
    session.commit()

    recent = list(
        session.scalars(
            select(ConversationMessageEntity)
            .where(ConversationMessageEntity.run_id == run_id)
            .order_by(ConversationMessageEntity.created_at.desc())
            .limit(12)
        )
    )[::-1]
    evidence = list(
        session.scalars(select(EvidenceEntity).where(EvidenceEntity.run_id == run_id))
    )

    try:
        if request.app.state.settings.demo_mode:
            reply, report_updated = _demo_response(run, payload, evidence)
        else:
            reply, report_updated = await _model_response(
                run, payload, recent, evidence, request.app.state.settings
            )
    except ModelProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="研究对话暂时不可用，请稍后重试",
        ) from exc

    if report_updated:
        session.add(
            ReportRevisionEntity(
                run_id=run.id,
                version=run.report_version,
                report=run.report,
                instruction=payload.content.strip(),
            )
        )
        run.report = report_updated
        run.report_version += 1

    assistant_message = ConversationMessageEntity(
        run_id=run_id,
        role="assistant",
        content=reply.content,
        evidence_ids=reply.evidence_ids,
        report_version=run.report_version if run.report else None,
    )
    session.add(assistant_message)
    session.commit()
    session.refresh(assistant_message)
    return SendMessageResponse(
        message=_message_payload(assistant_message),
        report_updated=bool(report_updated),
        report_version=run.report_version,
    )


@router.post("/messages/stream")
async def stream_message(
    run_id: str,
    payload: StreamMessageRequest,
    request: Request,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> EventSourceResponse:
    run = owned_run(session, user.id, run_id)
    content = payload.content.strip()
    if payload.append_user:
        session.add(
            ConversationMessageEntity(
                run_id=run_id,
                role="user",
                content=content,
                evidence_ids=[],
                report_version=run.report_version if run.report else None,
            )
        )
        run.project.updated_at = datetime.now(timezone.utc)
        session.commit()
    else:
        latest = session.scalar(
            select(ConversationMessageEntity)
            .where(ConversationMessageEntity.run_id == run_id)
            .order_by(ConversationMessageEntity.created_at.desc(), ConversationMessageEntity.id.desc())
            .limit(1)
        )
        if not latest or latest.role != "user" or latest.content != content:
            raise HTTPException(status_code=409, detail="没有可继续回复的用户消息")

    async def generate():
        model: DeepSeekModel | None = None
        try:
            with request.app.state.database.session() as stream_session:
                current_run = owned_run(stream_session, user.id, run_id)
                recent = list(
                    stream_session.scalars(
                        select(ConversationMessageEntity)
                        .where(ConversationMessageEntity.run_id == run_id)
                        .order_by(ConversationMessageEntity.created_at.desc())
                        .limit(12)
                    )
                )[::-1]
                evidence = list(
                    stream_session.scalars(
                        select(EvidenceEntity).where(EvidenceEntity.run_id == run_id)
                    )
                )
                if request.app.state.settings.demo_mode:
                    reply, _ = _demo_response(
                        current_run,
                        SendMessageRequest(content=content),
                        evidence,
                    )
                    chunks = [reply.content[index : index + 12] for index in range(0, len(reply.content), 12)]

                    async def demo_chunks():
                        for chunk in chunks:
                            await asyncio.sleep(0)
                            yield chunk

                    source = demo_chunks()
                else:
                    model = DeepSeekModel(
                        api_key=request.app.state.settings.deepseek_api_key,
                        base_url=request.app.state.settings.deepseek_base_url,
                        model=request.app.state.settings.deepseek_model,
                    )
                    context = {
                        "run": {
                            "status": current_run.status,
                            "stage": current_run.stage,
                            "brief": current_run.brief,
                        },
                        "report": (
                            Report.model_validate(current_run.report).model_dump(
                                mode="json", exclude={"evidence", "papers"}
                            )
                            if current_run.report
                            else None
                        ),
                        "evidence": [
                            {
                                "id": item.id,
                                "excerpt": item.payload.get("excerpt"),
                                "locator": item.payload.get("locator"),
                                "evidence_type": item.payload.get("evidence_type"),
                            }
                            for item in evidence
                        ],
                    }
                    source = model.stream_text(
                        (
                            "You are a biomedical research assistant. Reply in concise Simplified "
                            "Chinese. Use only the supplied run context and evidence. Before the report "
                            "is complete, clearly distinguish progress updates from evidence-backed "
                            "conclusions. Never provide diagnosis or treatment advice. Do not invent or "
                            "print evidence identifiers. Current run context: "
                            f"{json.dumps(context, ensure_ascii=False)}"
                        ),
                        [{"role": item.role, "content": item.content} for item in recent],
                    )

                parts: list[str] = []
                async for chunk in source:
                    parts.append(chunk)
                    if sum(len(part) for part in parts) > 6000:
                        raise ModelResponseError("Model reply exceeded the conversation limit")
                    yield {"event": "delta", "data": json.dumps({"content": chunk}, ensure_ascii=False)}

                reply_content = "".join(parts).strip()
                if not reply_content:
                    raise ModelResponseError("Model returned an empty reply")
                assistant_message = ConversationMessageEntity(
                    run_id=run_id,
                    role="assistant",
                    content=reply_content,
                    evidence_ids=[],
                    report_version=current_run.report_version if current_run.report else None,
                )
                stream_session.add(assistant_message)
                current_run.project.updated_at = datetime.now(timezone.utc)
                stream_session.flush()
                message = _message_payload(assistant_message).model_dump(mode="json")
                stream_session.commit()
                yield {
                    "event": "complete",
                    "data": json.dumps(
                        {"message": message, "report_version": current_run.report_version},
                        ensure_ascii=False,
                    ),
                }
        except ModelProviderError:
            yield {
                "event": "error",
                "data": json.dumps({"detail": "研究对话暂时不可用，请稍后重试"}, ensure_ascii=False),
            }
        finally:
            if model is not None:
                await model.aclose()

    return EventSourceResponse(generate())


def _demo_response(
    run: RunEntity,
    payload: SendMessageRequest,
    evidence: list[EvidenceEntity],
) -> tuple[GroundedReply, dict | None]:
    evidence_ids = [item.id for item in evidence[:3]]
    if run.status != RunStatus.COMPLETED.value:
        stage = run.stage or "等待启动"
        return (
            GroundedReply(
                content=(
                    f"当前研究处于“{stage}”阶段。我已经记录你的要求。"
                    "报告生成前，我会继续以当前研究问题和后续纳入证据为边界回答。"
                )
            ),
            None,
        )
    if payload.action == "revise_report":
        current = Report.model_validate(run.report)
        note = "现有证据仍需结合研究设计差异、样本代表性和外部验证情况谨慎解释。"
        gaps = list(current.gaps)
        if note not in gaps:
            gaps.append(note)
        revised = current.model_copy(
            update={"gaps": gaps, "generated_at": datetime.now(timezone.utc)}
        )
        return (
            GroundedReply(
                content=(
                    f"已根据你的要求生成报告版本 {run.report_version + 1}，"
                    "补充了证据边界与外部验证局限。报告中的主要结论和三个研究建议仍保持原证据关联。"
                ),
                evidence_ids=evidence_ids,
            ),
            revised.model_dump(mode="json"),
        )
    return (
        GroundedReply(
            content=(
                "基于当前研究已纳入的证据，报告结论应重点关注证据一致性、"
                "研究设计差异和外部验证充分性。你可以继续追问具体结论，或选择“据此修订报告”。"
            ),
            evidence_ids=evidence_ids,
        ),
        None,
    )


async def _model_response(
    run: RunEntity,
    payload: SendMessageRequest,
    recent: list[ConversationMessageEntity],
    evidence: list[EvidenceEntity],
    settings: object,
) -> tuple[GroundedReply, dict | None]:
    model = DeepSeekModel(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        model=settings.deepseek_model,
    )
    try:
        evidence_payload = [
            {
                "id": item.id,
                "excerpt": item.payload.get("excerpt"),
                "locator": item.payload.get("locator"),
                "evidence_type": item.payload.get("evidence_type"),
            }
            for item in evidence
        ]
        if payload.action == "revise_report":
            current = Report.model_validate(run.report)
            raw = await model.complete_json(
                (
                    "Revise the biomedical research report from the user's instruction. Use only "
                    "the supplied immutable evidence records. Every claim and recommendation must "
                    "cite allowed evidence IDs, and there must be exactly three recommendations. "
                    "Return only JSON matching output_schema. Reply content must be Simplified Chinese."
                ),
                {
                    "instruction": payload.content,
                    "current_report": current.model_dump(mode="json", exclude={"evidence", "papers"}),
                    "evidence": evidence_payload,
                    "output_schema": SynthesisPayload.model_json_schema(),
                },
            )
            try:
                synthesis = SynthesisPayload.model_validate(raw)
            except ValidationError:
                raise ModelResponseError("Model returned an invalid report revision") from None
            allowed = {item.id for item in evidence}
            cited = {
                evidence_id
                for collection in (synthesis.claims, synthesis.recommendations)
                for item in collection
                for evidence_id in item.evidence_ids
            }
            if cited - allowed:
                raise ModelResponseError("Model cited evidence outside this research run")
            revised = current.model_copy(
                update={
                    **synthesis.model_dump(),
                    "generated_at": datetime.now(timezone.utc),
                }
            )
            return (
                GroundedReply(
                    content=f"已按你的要求生成报告版本 {run.report_version + 1}。",
                    evidence_ids=sorted(cited),
                ),
                revised.model_dump(mode="json"),
            )

        raw_reply = await model.complete_json(
            (
                "Answer as a biomedical research assistant in concise Simplified Chinese. "
                "Use only the supplied run context and evidence. Return content and evidence_ids as JSON. "
                "Never provide diagnosis or treatment advice and never cite an unknown evidence ID."
            ),
            {
                "run": {"status": run.status, "stage": run.stage, "brief": run.brief},
                "report": (
                    Report.model_validate(run.report).model_dump(
                        mode="json", exclude={"evidence", "papers"}
                    )
                    if run.report
                    else None
                ),
                "evidence": evidence_payload,
                "conversation": [
                    {"role": item.role, "content": item.content} for item in recent
                ],
                "output_schema": GroundedReply.model_json_schema(),
            },
        )
        reply = GroundedReply.model_validate(raw_reply)
        allowed = {item.id for item in evidence}
        if set(reply.evidence_ids) - allowed:
            raise ModelResponseError("Model cited evidence outside this research run")
        return reply, None
    finally:
        await model.aclose()
