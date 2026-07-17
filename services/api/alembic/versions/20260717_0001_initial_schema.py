"""Initial PaperPilot schema.

Revision ID: 20260717_0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260717_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_projects_user_id", "projects", ["user_id"])
    op.create_table(
        "private_uploads",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("object_key", sa.String(1000), nullable=False, unique=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_private_uploads_project_id", "private_uploads", ["project_id"])
    op.create_table(
        "research_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("stage", sa.String(32), nullable=True),
        sa.Column("brief", sa.JSON(), nullable=False),
        sa.Column("report", sa.JSON(), nullable=True),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_research_runs_project_id", "research_runs", ["project_id"])
    op.create_index("ix_research_runs_status", "research_runs", ["status"])
    op.create_table(
        "evidence_records",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("research_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_index("ix_evidence_records_run_id", "evidence_records", ["run_id"])


def downgrade() -> None:
    op.drop_table("evidence_records")
    op.drop_table("research_runs")
    op.drop_table("private_uploads")
    op.drop_table("projects")
    op.drop_table("users")
