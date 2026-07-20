"""Persist run conversations and report revisions.

Revision ID: 20260720_0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260720_0002"
down_revision: str | None = "20260717_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    run_columns = {column["name"] for column in inspector.get_columns("research_runs")}
    if "report_version" not in run_columns:
        op.add_column(
            "research_runs",
            sa.Column("report_version", sa.Integer(), nullable=False, server_default="1"),
        )
    if "run_conversation_messages" not in tables:
        op.create_table(
            "run_conversation_messages",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "run_id",
                sa.String(36),
                sa.ForeignKey("research_runs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("role", sa.String(16), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("evidence_ids", sa.JSON(), nullable=False),
            sa.Column("report_version", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_run_conversation_messages_run_id",
            "run_conversation_messages",
            ["run_id"],
        )
    if "report_revisions" not in tables:
        op.create_table(
            "report_revisions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "run_id",
                sa.String(36),
                sa.ForeignKey("research_runs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("report", sa.JSON(), nullable=False),
            sa.Column("instruction", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("run_id", "version", name="uq_report_revisions_run_version"),
        )
        op.create_index("ix_report_revisions_run_id", "report_revisions", ["run_id"])


def downgrade() -> None:
    op.drop_table("report_revisions")
    op.drop_table("run_conversation_messages")
    op.drop_column("research_runs", "report_version")
