from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from paperpilot.api.deps import current_user, get_session
from paperpilot.database import ProjectEntity, UserEntity


router = APIRouter(prefix="/v1/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=4000)


def project_payload(project: ProjectEntity) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def owned_project(session: Session, user_id: str, project_id: str) -> ProjectEntity:
    project = session.scalar(
        select(ProjectEntity).where(
            ProjectEntity.id == project_id,
            ProjectEntity.user_id == user_id,
        )
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("")
def list_projects(
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> list[dict]:
    projects = session.scalars(
        select(ProjectEntity).where(ProjectEntity.user_id == user.id).order_by(ProjectEntity.updated_at.desc())
    )
    return [project_payload(project) for project in projects]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    project = ProjectEntity(user_id=user.id, name=payload.name, description=payload.description)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project_payload(project)


@router.get("/{project_id}")
def get_project(
    project_id: str,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    return project_payload(owned_project(session, user.id, project_id))


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: str,
    request: Request,
    user: Annotated[UserEntity, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    project = owned_project(session, user.id, project_id)
    session.delete(project)
    session.commit()
    request.app.state.object_store.delete_project(user.id, project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
