from __future__ import annotations

import os
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4


class LocalObjectStore:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root).resolve()

    def put(
        self,
        user_id: str,
        project_id: str,
        filename: str,
        content: bytes,
    ) -> str:
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).name).strip(".-")
        safe_name = safe_name or "upload.bin"
        key = f"{self._scope(user_id)}/{self._scope(project_id)}/{uuid4().hex[:12]}-{safe_name}"
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return key

    def read(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def set_created_at(self, key: str, created_at: datetime) -> None:
        timestamp = created_at.timestamp()
        os.utime(self._path(key), (timestamp, timestamp))

    def purge_older_than(self, age: timedelta) -> list[str]:
        if not self.root.exists():
            return []
        cutoff = datetime.now(timezone.utc).timestamp() - age.total_seconds()
        deleted: list[str] = []
        for path in self.root.rglob("*"):
            if path.is_file() and path.stat().st_mtime < cutoff:
                deleted.append(path.relative_to(self.root).as_posix())
                path.unlink()
        return deleted

    def delete_project(self, user_id: str, project_id: str) -> None:
        path = self._path(f"{self._scope(user_id)}/{self._scope(project_id)}")
        if path.exists():
            shutil.rmtree(path)

    def _path(self, key: str) -> Path:
        path = (self.root / Path(key)).resolve()
        if self.root not in path.parents and path != self.root:
            raise ValueError("Object key escapes the configured storage root")
        return path

    @staticmethod
    def _scope(value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise ValueError("Invalid storage scope")
        return value
