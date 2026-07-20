from __future__ import annotations

import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from paperpilot.api.deps import current_user, get_session
from paperpilot.api.routes.projects import owned_project
from paperpilot.database import EvidenceEntity, ProjectEntity, RunEntity, UserEntity
from paperpilot.domain.models import ResearchBrief, RunStatus
from paperpilot.domain.models import Report
from paperpilot.models.deepseek import ModelProviderError
from paperpilot.services.markdown_export import render_markdown


router = APIRouter(prefix="/v1", tags=["research-runs"])


def owned_run(session: Session, user_id: str, run_id: str) -> RunEntity:
    run = session.scalar(
        select(RunEntity)
        .join(ProjectEntity)
        .where(RunEntity.id == run_id, ProjectEntity.user_id == user_id)
    )
    if not run:
        raise HTTPException(status_code=404, detail="Research run not found")
    return run


def run_payload(run: RunEntity) -> dict:
    return {
        "id": run.id,
        "project_id": run.project_id,
        "status": run.status,
        "stage": run.stage,
        "error": run.error,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "completed_at": run.completed_at,
        "report_version": run.report_version,
    }


@router.post("/projects/{project_id}/runs", status_code=status.HTTP_202_ACCEPTED)
def create_run(
    project_id: str,
    brief: ResearchBrief,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    owned_project(session, user.id, project_id)
    run = RunEntity(
        project_id=project_id,
        status=RunStatus.QUEUED.value,
        brief=brief.model_dump(mode="json"),
        events=[],
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run_payload(run)


@router.post("/runs/{run_id}/start", status_code=status.HTTP_202_ACCEPTED)
def start_run(
    run_id: str,
    request: Request,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    run = owned_run(session, user.id, run_id)
    if run.status != RunStatus.QUEUED.value:
        return run_payload(run)
    if request.app.state.settings.task_always_eager:
        try:
            request.app.state.run_service.execute(run.id)
        except Exception:
            # RunService persists a safe failed state before propagating the cause.
            pass
        session.expire_all()
        run = owned_run(session, user.id, run.id)
    else:
        request.app.state.dispatch_run(run.id)
    return run_payload(run)


@router.get("/runs/{run_id}")
def get_run(
    run_id: str,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    return run_payload(owned_run(session, user.id, run_id))


@router.post("/runs/{run_id}/cancel")
def cancel_run(
    run_id: str,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    run = owned_run(session, user.id, run_id)
    if run.status not in {RunStatus.COMPLETED.value, RunStatus.FAILED.value}:
        run.status = RunStatus.CANCELLED.value
        session.commit()
    return run_payload(run)


@router.post("/runs/{run_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def retry_run(
    run_id: str,
    request: Request,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    run = owned_run(session, user.id, run_id)
    if run.status not in {RunStatus.FAILED.value, RunStatus.CANCELLED.value}:
        raise HTTPException(status_code=409, detail="Only failed or cancelled runs can be retried")
    run.status = RunStatus.RETRYING.value
    run.error = None
    session.commit()
    if request.app.state.settings.task_always_eager:
        try:
            request.app.state.run_service.execute(run.id)
        except ModelProviderError:
            pass
        session.expire_all()
        run = owned_run(session, user.id, run.id)
    else:
        request.app.state.dispatch_run(run.id)
    return run_payload(run)


@router.get("/runs/{run_id}/report")
def get_report(
    run_id: str,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    run = owned_run(session, user.id, run_id)
    if not run.report:
        raise HTTPException(status_code=404, detail="Report not available")
    return run.report


@router.get("/runs/{run_id}/report.md")
def export_report_markdown(
    run_id: str,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    run = owned_run(session, user.id, run_id)
    if not run.report:
        raise HTTPException(status_code=404, detail="Report not available")
    content = render_markdown(Report.model_validate(run.report))
    return Response(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="paperpilot-{run_id[:8]}.md"'},
    )


@router.get("/runs/{run_id}/evidence")
def get_evidence(
    run_id: str,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> list[dict]:
    owned_run(session, user.id, run_id)
    records = session.scalars(select(EvidenceEntity).where(EvidenceEntity.run_id == run_id))
    return [record.payload for record in records]


@router.get("/runs/{run_id}/events")
def stream_events(
    run_id: str,
    request: Request,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> EventSourceResponse:
    owned_run(session, user.id, run_id)

    async def generate():
        delivered = 0
        while not await request.is_disconnected():
            with request.app.state.database.session() as stream_session:
                run = owned_run(stream_session, user.id, run_id)
                events = list(run.events or [])
                for event in events[delivered:]:
                    yield {"event": "stage", "data": json.dumps(event)}
                delivered = len(events)
                if run.status in {
                    RunStatus.COMPLETED.value,
                    RunStatus.FAILED.value,
                    RunStatus.CANCELLED.value,
                }:
                    yield {"event": "done", "data": json.dumps(run_payload(run), default=str)}
                    return
            await asyncio.sleep(0.5)

    return EventSourceResponse(generate())
