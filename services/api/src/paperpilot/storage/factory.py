from paperpilot.config import Settings
from paperpilot.storage.local import LocalObjectStore
from paperpilot.storage.oss import OssObjectStore


def create_object_store(settings: Settings):
    if settings.storage_backend == "oss":
        required = {
            "oss_endpoint": settings.oss_endpoint,
            "oss_bucket": settings.oss_bucket,
            "oss_access_key_id": settings.oss_access_key_id,
            "oss_access_key_secret": settings.oss_access_key_secret,
            "oss_kms_key_id": settings.oss_kms_key_id,
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ValueError(f"Missing OSS settings: {', '.join(missing)}")
        return OssObjectStore.from_credentials(
            endpoint=settings.oss_endpoint,
            bucket_name=settings.oss_bucket,
            access_key_id=settings.oss_access_key_id,
            access_key_secret=settings.oss_access_key_secret,
            kms_key_id=settings.oss_kms_key_id,
        )
    return LocalObjectStore(settings.storage_path)
