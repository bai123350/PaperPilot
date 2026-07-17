from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from paperpilot.api.routes import auth, projects, runs, uploads
from paperpilot.auth import AuthService
from paperpilot.config import Settings
from paperpilot.database import Database
from paperpilot.run_service import RunService
from paperpilot.storage.factory import create_object_store
from paperpilot.upload_tickets import UploadTicketService


def create_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        if active_settings.auto_create_schema:
            application.state.database.create_schema()
        yield

    app = FastAPI(
        title="PaperPilot API",
        version="0.1.0",
        description="Evidence-first biomedical research intelligence",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[active_settings.web_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = active_settings
    app.state.database = Database(active_settings.database_url)
    app.state.auth = AuthService(active_settings.auth_secret)
    app.state.object_store = create_object_store(active_settings)
    app.state.upload_tickets = UploadTicketService(active_settings.auth_secret)
    app.state.run_service = RunService(app.state.database, active_settings)
    app.state.dispatch_run = lambda run_id: _dispatch_with_celery(run_id, active_settings)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "paperpilot-api"}

    app.include_router(auth.router)
    app.include_router(projects.router)
    app.include_router(runs.router)
    app.include_router(uploads.router)
    return app


def _dispatch_with_celery(run_id: str, settings: Settings) -> None:
    from paperpilot.tasks import execute_research_run

    execute_research_run.apply_async(args=[run_id], queue="research")


app = create_app()
