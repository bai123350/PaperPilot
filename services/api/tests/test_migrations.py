from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


def test_initial_migration_builds_the_schema_from_zero(tmp_path: Path) -> None:
    api_root = Path(__file__).parents[1]
    config = Config(api_root / "alembic.ini")
    config.set_main_option("script_location", str(api_root / "alembic"))
    database_url = f"sqlite:///{tmp_path / 'migration.db'}"
    config.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(config, "head")

    tables = set(inspect(create_engine(database_url)).get_table_names())
    assert {"users", "projects", "private_uploads", "research_runs", "evidence_records"} <= tables
