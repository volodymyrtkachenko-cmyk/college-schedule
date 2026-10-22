"""Regression coverage for projection imports and effective room selection."""
from types import SimpleNamespace
from typing import Any, Optional, get_type_hints
import unittest

from app.services.projection import resolve_effective_room


class RoomResolutionTests(unittest.TestCase):
    def test_annotations_resolve(self):
        # Importing the real module above must succeed during pytest collection.
        hints = get_type_hints(resolve_effective_room)
        self.assertEqual(hints["teacher"], Optional[Any])
        self.assertEqual(hints["return"], Optional[str])

    def test_room_resolution(self):
        cases = [
            (" 203 ", "426", "408", "203"),
            (None, " 426 ", None, "426"),
            ("   ", "426", None, "426"),
            (None, None, " 408 ", "408"),
            (None, "426", "408", "426 / 408"),
            (None, "   ", "", None),
            (None, None, None, None),
            ("спортивний комплекс", "426", None, "спортивний комплекс"),
            ("аудиторія 207", None, None, "207"),
            ("ауд. иторія 426", None, None, "426"),
            ("ауд. 305", None, None, "305"),
        ]
        for override, first_room, second_room, expected in cases:
            with self.subTest(override=override, first=first_room, second=second_room):
                teacher = SimpleNamespace(room=first_room) if first_room is not None else None
                second = SimpleNamespace(room=second_room) if second_room is not None else None
                self.assertEqual(resolve_effective_room(override, teacher, second), expected)

    def test_teacher_without_room_attribute(self):
        self.assertIsNone(resolve_effective_room(None, SimpleNamespace()))

    def test_is_same_day_swap(self):
        from app.services.projection import is_same_day_swap
        base = [
            SimpleNamespace(group_id=1, subject_id=101, teacher_id=10, lesson_number=1),
            SimpleNamespace(group_id=1, subject_id=102, teacher_id=11, lesson_number=2),
            SimpleNamespace(group_id=1, subject_id=103, teacher_id=12, lesson_number=3),
        ]
        # Swapped slot 3 to slot 1: subject 103, teacher 12 belongs to base
        self.assertTrue(is_same_day_swap(1, 103, 12, base))
        # Swapped slot 1 to slot 3: subject 101, teacher 10 belongs to base
        self.assertTrue(is_same_day_swap(1, 101, 10, base))
        # External substitution: subject 999 is NOT on this day
        self.assertFalse(is_same_day_swap(1, 999, 12, base))
        # Different group
        self.assertFalse(is_same_day_swap(2, 101, 10, base))

