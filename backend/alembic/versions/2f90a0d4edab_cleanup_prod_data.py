"""cleanup_prod_data

Revision ID: 2f90a0d4edab
Revises: fd38b0122846
Create Date: 2026-09-30 08:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2f90a0d4edab'
down_revision: Union[str, None] = 'fd38b0122846'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Заняття з предметом 78 переведи на 79 (36 занять)
    op.execute("UPDATE schedule SET subject_id = 79 WHERE subject_id = 78")
    op.execute("UPDATE schedule_override SET subject_id = 79 WHERE subject_id = 78")
    
    # Видали предмет 78
    op.execute("DELETE FROM subjects WHERE id = 78")
    
    # 2. Видали тестових викладачів (id 64–68)
    op.execute("DELETE FROM teachers WHERE id IN (64, 65, 66, 67, 68)")
    
    # 3. Видали тестові предмети (id 83–87)
    op.execute("DELETE FROM subjects WHERE id IN (83, 84, 85, 86, 87)")
    
    # 4. Виправ обрізану назву предмета 56 «Основи національного с» в довідниках.
    op.execute("UPDATE subjects SET name = 'Основи національного спротиву' WHERE id = 56")
    
    # 5. 6 неактивних занять можна видалити остаточно.
    op.execute("DELETE FROM schedule WHERE is_active = FALSE")


def downgrade() -> None:
    pass
