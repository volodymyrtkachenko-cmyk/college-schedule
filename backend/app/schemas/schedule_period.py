from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.common import DirectoryItem


class SchedulePeriodSlotInput(BaseModel):
    group_id: int = Field(gt=0)
    subject_id: int = Field(gt=0)
    teacher_id: int = Field(gt=0)
    second_teacher_id: int | None = Field(default=None, gt=0)
    day_of_week: int = Field(ge=1, le=5)
    lesson_number: int = Field(ge=1, le=5)
    room_override: str | None = Field(default=None, max_length=100)


class SchedulePeriodCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    period_type: Literal["practice", "holiday"]
    start_date: date
    end_date: date
    group_ids: list[int] = Field(default_factory=list)
    slots: list[SchedulePeriodSlotInput] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Вкажіть назву періоду")
        return value

    @model_validator(mode="after")
    def validate_period(self):
        if self.start_date > self.end_date:
            raise ValueError("Дата початку має бути не пізніше дати завершення")
        if len(set(self.group_ids)) != len(self.group_ids) or any(group_id <= 0 for group_id in self.group_ids):
            raise ValueError("Список груп містить недопустимі або повторні значення")
        if self.period_type == "holiday":
            if self.slots:
                raise ValueError("Для канікул не потрібно вказувати пари")
            return self

        if not self.group_ids or not self.slots:
            raise ValueError("Для практики потрібно вказати групи та пари")
        selected_groups = set(self.group_ids)
        slot_keys = set()
        groups_with_slots = set()
        for slot in self.slots:
            if slot.group_id not in selected_groups:
                raise ValueError("Кожна пара має належати до вибраної групи")
            if slot.teacher_id == slot.second_teacher_id:
                raise ValueError("Викладачі пари мають бути різними")
            key = (slot.group_id, slot.day_of_week, slot.lesson_number)
            if key in slot_keys:
                raise ValueError("У групи не може бути двох пар в один день і час")
            slot_keys.add(key)
            groups_with_slots.add(slot.group_id)
        if groups_with_slots != selected_groups:
            raise ValueError("Для кожної вибраної групи потрібно додати хоча б одну пару")
        return self


class SchedulePeriodSlotResponse(SchedulePeriodSlotInput):
    model_config = ConfigDict(from_attributes=True)
    id: int
    group: DirectoryItem
    subject: DirectoryItem
    teacher: DirectoryItem
    second_teacher: DirectoryItem | None = None


class SchedulePeriodResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    period_type: str
    start_date: date
    end_date: date
    groups: list[DirectoryItem]
    slots: list[SchedulePeriodSlotResponse]
