from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from paperpilot.auth import TokenError
from paperpilot.database import UserEntity


security = HTTPBearer(auto_error=False)


def get_session(request: Request):
    session = request.app.state.database.SessionLocal()
    try:
        yield session
    finally:
        session.close()


def current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    session: Annotated[Session, Depends(get_session)],
) -> UserEntity:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    try:
        user_id = request.app.state.auth.verify(credentials.credentials)
    except TokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    user = session.get(UserEntity, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")
    return user
