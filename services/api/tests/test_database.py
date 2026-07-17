from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import select

from paperpilot.database import Database, UserEntity


def test_in_memory_sqlite_schema_is_shared_with_request_threads() -> None:
    database = Database("sqlite:///:memory:")
    database.create_schema()

    def create_user() -> str:
        with database.session() as session:
            user = UserEntity(email="thread@example.com", name="Thread User")
            session.add(user)
            session.flush()
            return user.id

    with ThreadPoolExecutor(max_workers=1) as executor:
        user_id = executor.submit(create_user).result()

    with database.session() as session:
        assert session.scalar(select(UserEntity).where(UserEntity.id == user_id)) is not None
