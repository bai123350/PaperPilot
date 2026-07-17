from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from paperpilot.api.deps import current_user, get_session
from paperpilot.api.routes.projects import owned_project
from paperpilot.database import UploadEntity, UserEntity
from paperpilot.upload_tickets import UploadTicketError


router = APIRouter(prefix="/v1", tags=["uploads"])
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


class PresignRequest(BaseModel):
    filename: str = Field(min_length=5, max_length=255, pattern=r"(?i)^.+\.pdf$")
    content_type: str = Field(pattern=r"^application/pdf$")
    size: int = Field(gt=0, le=MAX_UPLOAD_BYTES)


@router.post("/projects/{project_id}/uploads/presign")
def presign_upload(
    project_id: str,
    payload: PresignRequest,
    request: Request,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    owned_project(session, user.id, project_id)
    token, expires_at = request.app.state.upload_tickets.issue(
        user_id=user.id,
        project_id=project_id,
        filename=payload.filename,
        max_size=payload.size,
    )
    return {
        "upload_url": f"/v1/uploads/{token}",
        "method": "PUT",
        "expires_at": expires_at,
        "required_headers": {"Content-Type": "application/pdf"},
    }


@router.put("/uploads/{token}", status_code=status.HTTP_201_CREATED)
async def upload_pdf(token: str, request: Request) -> dict:
    try:
        ticket = request.app.state.upload_tickets.verify(token)
    except UploadTicketError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    content = await request.body()
    if len(content) > ticket.max_size:
        raise HTTPException(status_code=413, detail="Upload exceeds the signed size")
    if request.headers.get("content-type", "").split(";", 1)[0] != "application/pdf":
        raise HTTPException(status_code=415, detail="Only application/pdf is accepted")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="File signature is not a PDF")
    key = request.app.state.object_store.put(
        ticket.user_id,
        ticket.project_id,
        ticket.filename,
        content,
    )
    with request.app.state.database.session() as session:
        session.add(
            UploadEntity(
                project_id=ticket.project_id,
                object_key=key,
                filename=ticket.filename,
                content_type="application/pdf",
                expires_at=datetime.now(timezone.utc)
                + timedelta(hours=request.app.state.settings.upload_retention_hours),
            )
        )
    return {"object_key": key, "retention_hours": request.app.state.settings.upload_retention_hours}
