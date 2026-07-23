from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from paperpilot.database import Base


def test_initial_migration_builds_the_schema_from_zero(tmp_path: Path) -> None:
    api_root = Path(__file__).parents[1]
    config = Config(api_root / "alembic.ini")
    config.set_main_option("script_location", str(api_root / "alembic"))
    database_url = f"sqlite:///{tmp_path / 'migration.db'}"
    config.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(config, "head")

    tables = set(inspect(create_engine(database_url)).get_table_names())
    assert {
        "users",
        "projects",
        "private_uploads",
        "research_runs",
        "evidence_records",
        "run_conversation_messages",
        "report_revisions",
        "run_operations",
    } <= tables
    operation_constraints = {
        item["name"]
        for item in inspect(create_engine(database_url)).get_unique_constraints("run_operations")
    }
    assert "uq_run_operations_run_sequence" in operation_constraints


def test_conversation_migration_handles_an_auto_created_legacy_database(tmp_path: Path) -> None:
    api_root = Path(__file__).parents[1]
    config = Config(api_root / "alembic.ini")
    config.set_main_option("script_location", str(api_root / "alembic"))
    database_url = f"sqlite:///{tmp_path / 'legacy.db'}"
    config.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(config, "20260717_0001")
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    command.upgrade(config, "head")

    inspector = inspect(engine)
    assert "report_version" in {
        column["name"] for column in inspector.get_columns("research_runs")
    }
    assert {"run_conversation_messages", "report_revisions", "run_operations"} <= set(
        inspector.get_table_names()
    )
