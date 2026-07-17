from celery import Celery

from paperpilot.config import Settings
from paperpilot.database import Database
from paperpilot.run_service import RunService
from paperpilot.storage.factory import create_object_store

from datetime import timedelta


settings = Settings()
celery_app = Celery("paperpilot", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)


@celery_app.task(name="paperpilot.execute_research_run", bind=True, max_retries=3)
def execute_research_run(self, run_id: str) -> None:
    try:
        RunService(Database(settings.database_url), settings).execute(run_id)
    except Exception as exc:
        raise self.retry(exc=exc, countdown=min(60, 2 ** self.request.retries)) from exc


@celery_app.task(name="paperpilot.purge_expired_uploads")
def purge_expired_uploads() -> list[str]:
    return create_object_store(settings).purge_older_than(
        timedelta(hours=settings.upload_retention_hours)
    )


celery_app.conf.beat_schedule = {
    "purge-expired-uploads-hourly": {
        "task": "paperpilot.purge_expired_uploads",
        "schedule": 3600.0,
    }
}
