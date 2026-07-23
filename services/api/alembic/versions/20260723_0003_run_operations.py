"""Persist safe research run operations.

Revision ID: 20260723_0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260723_0003"
down_revision: str | None = "20260720_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "run_operations" in set(inspector.get_table_names()):
        return
    op.create_table(
        "run_operations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("research_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("task_kind", sa.String(24), nullable=False),
        sa.Column("operation_kind", sa.String(48), nullable=False),
        sa.Column("stage", sa.String(32), nullable=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("summary", sa.String(500), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.Column(
            "conversation_message_id",
            sa.String(36),
            sa.ForeignKey("run_conversation_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "run_id",
            "sequence",
            name="uq_run_operations_run_sequence",
        ),
    )
    op.create_index("ix_run_operations_run_id", "run_operations", ["run_id"])
    op.create_index(
        "ix_run_operations_conversation_message_id",
        "run_operations",
        ["conversation_message_id"],
    )


def downgrade() -> None:
    op.drop_table("run_operations")
