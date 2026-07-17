from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4


class OssObjectStore:
    def __init__(self, bucket: object, kms_key_id: str) -> None:
        self.bucket = bucket
        self.kms_key_id = kms_key_id

    @classmethod
    def from_credentials(
        cls,
        endpoint: str,
        bucket_name: str,
        access_key_id: str,
        access_key_secret: str,
        kms_key_id: str,
    ) -> "OssObjectStore":
        try:
            import oss2
        except ImportError as exc:
            raise RuntimeError("Install paperpilot-api[cloud] to use Alibaba Cloud OSS") from exc
        auth = oss2.Auth(access_key_id, access_key_secret)
        return cls(oss2.Bucket(auth, endpoint, bucket_name), kms_key_id)

    def put(self, user_id: str, project_id: str, filename: str, content: bytes) -> str:
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).name).strip(".-")
        key = f"{self._scope(user_id)}/{self._scope(project_id)}/{uuid4().hex[:12]}-{safe_name or 'upload.bin'}"
        self.bucket.put_object(
            key,
            content,
            headers={
                "x-oss-server-side-encryption": "KMS",
                "x-oss-server-side-encryption-key-id": self.kms_key_id,
            },
        )
        return key

    def read(self, key: str) -> bytes:
        return self.bucket.get_object(key).read()

    def exists(self, key: str) -> bool:
        return bool(self.bucket.object_exists(key))

    def delete_project(self, user_id: str, project_id: str) -> None:
        prefix = f"{self._scope(user_id)}/{self._scope(project_id)}/"
        result = self.bucket.list_objects_v2(prefix=prefix)
        keys = [item.key for item in result.object_list]
        if keys:
            self.bucket.batch_delete_objects(keys)

    def purge_older_than(self, age: timedelta) -> list[str]:
        cutoff = datetime.now(timezone.utc) - age
        result = self.bucket.list_objects_v2()
        keys = [
            item.key
            for item in result.object_list
            if datetime.fromtimestamp(item.last_modified, tz=timezone.utc) < cutoff
        ]
        if keys:
            self.bucket.batch_delete_objects(keys)
        return keys

    @staticmethod
    def _scope(value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise ValueError("Invalid storage scope")
        return value
