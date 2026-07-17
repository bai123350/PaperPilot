from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from paperpilot.api.deps import get_session
from paperpilot.database import UserEntity


router = APIRouter(prefix="/v1/auth", tags=["auth"])


class DemoLogin(BaseModel):
    email: Annotated[
        str,
        Field(
            min_length=5,
            max_length=320,
            pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$",
        ),
    ]
    name: str = Field(min_length=2, max_length=200)


@router.post("/demo")
def demo_login(
    payload: DemoLogin,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    if not request.app.state.settings.demo_mode:
        raise HTTPException(status_code=404, detail="Demo authentication is disabled")
    user = session.scalar(select(UserEntity).where(UserEntity.email == str(payload.email)))
    if not user:
        user = UserEntity(email=str(payload.email), name=payload.name)
        session.add(user)
        session.commit()
        session.refresh(user)
    return {"access_token": request.app.state.auth.issue(user.id), "token_type": "bearer"}
