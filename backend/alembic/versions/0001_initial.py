from alembic import op
import sqlalchemy as sa
revision = "0001_initial"
down_revision = None
def upgrade():
    op.create_table("users", sa.Column("id", sa.Integer, primary_key=True), sa.Column("email", sa.String(255), unique=True), sa.Column("name", sa.String(255), nullable=False), sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()))
    op.create_table("faculties", sa.Column("id", sa.Integer, primary_key=True), sa.Column("name", sa.String(255), unique=True, nullable=False), sa.Column("short_name", sa.String(50)), sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()))
    op.create_table("groups", sa.Column("id", sa.Integer, primary_key=True), sa.Column("name", sa.String(100), unique=True, nullable=False), sa.Column("faculty_id", sa.Integer, sa.ForeignKey("faculties.id"), nullable=False), sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()))
    for table in ("teachers", "rooms", "subjects"):
        cols = [sa.Column("id", sa.Integer, primary_key=True), sa.Column("name", sa.String(255), nullable=False), sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true())]
        if table == "rooms": cols += [sa.Column("building", sa.String(100)), sa.Column("capacity", sa.Integer)]
        else: cols += [sa.Column("short_name", sa.String(50))] if table == "subjects" else [sa.Column("email", sa.String(255))]
        op.create_table(table, *cols)
    op.create_table("schedule", sa.Column("id", sa.Integer, primary_key=True), sa.Column("group_id", sa.Integer, sa.ForeignKey("groups.id"), nullable=False), sa.Column("teacher_id", sa.Integer, sa.ForeignKey("teachers.id")), sa.Column("room_id", sa.Integer, sa.ForeignKey("rooms.id")), sa.Column("subject_id", sa.Integer, sa.ForeignKey("subjects.id"), nullable=False), sa.Column("day_of_week", sa.Integer, nullable=False), sa.Column("lesson_number", sa.Integer, nullable=False), sa.Column("start_time", sa.Time, nullable=False), sa.Column("end_time", sa.Time, nullable=False), sa.Column("week_type", sa.String(20), nullable=False), sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()))
    op.create_table("lesson_notes", sa.Column("id", sa.Integer, primary_key=True), sa.Column("schedule_id", sa.Integer, sa.ForeignKey("schedule.id"), nullable=False), sa.Column("note_date", sa.Date, nullable=False), sa.Column("note", sa.Text, nullable=False))
    op.create_table("feedback", sa.Column("id", sa.Integer, primary_key=True), sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id")), sa.Column("message", sa.Text, nullable=False), sa.Column("created_at", sa.DateTime, nullable=False))
    op.create_table("settings", sa.Column("key", sa.String(100), primary_key=True), sa.Column("value", sa.Text, nullable=False), sa.Column("updated_at", sa.DateTime, nullable=False))
def downgrade():
    for table in ("settings", "feedback", "lesson_notes", "schedule", "subjects", "rooms", "teachers", "groups", "faculties", "users"): op.drop_table(table)
