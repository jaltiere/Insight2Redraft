"""add team sleeper_display_name

Revision ID: 73ef2410abfa
Revises: 198fa9815fce
Create Date: 2026-07-29 10:15:26.622562

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '73ef2410abfa'
down_revision: Union[str, Sequence[str], None] = '198fa9815fce'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "team",
        sa.Column("sleeper_display_name", sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("team", "sleeper_display_name")
