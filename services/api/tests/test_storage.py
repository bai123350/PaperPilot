from datetime import datetime, timedelta, timezone

from paperpilot.storage.local import LocalObjectStore
from paperpilot.storage.oss import OssObjectStore


def test_local_object_store_uses_scoped_keys_and_purges_expired_files(tmp_path) -> None:
    store = LocalObjectStore(tmp_path)
    key = store.put(
        user_id="user-1",
        project_id="project-1",
        filename="unpublished.pdf",
        content=b"%PDF-1.7 private material",
    )
    store.set_created_at(key, datetime.now(timezone.utc) - timedelta(hours=25))

    assert key.startswith("user-1/project-1/")
    assert store.read(key).startswith(b"%PDF")
    assert store.purge_older_than(timedelta(hours=24)) == [key]
    assert not store.exists(key)


def test_project_delete_removes_only_the_target_scope(tmp_path) -> None:
    store = LocalObjectStore(tmp_path)
    target = store.put("user-1", "project-1", "a.pdf", b"target")
    retained = store.put("user-1", "project-2", "b.pdf", b"retained")

    store.delete_project("user-1", "project-1")

    assert not store.exists(target)
    assert store.exists(retained)


class FakeBucket:
    def __init__(self) -> None:
        self.uploads: list[tuple[str, bytes, dict]] = []

    def put_object(self, key: str, content: bytes, headers: dict) -> None:
        self.uploads.append((key, content, headers))


def test_oss_store_scopes_objects_and_requires_kms_encryption() -> None:
    bucket = FakeBucket()
    store = OssObjectStore(bucket=bucket, kms_key_id="kms-key-123")

    key = store.put("user-1", "project-1", "private.pdf", b"%PDF-private")

    assert key.startswith("user-1/project-1/")
    assert bucket.uploads[0][2] == {
        "x-oss-server-side-encryption": "KMS",
        "x-oss-server-side-encryption-key-id": "kms-key-123",
    }
