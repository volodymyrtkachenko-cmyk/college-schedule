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
        ]
        for override, first_room, second_room, expected in cases:
            with self.subTest(override=override, first=first_room, second=second_room):
                teacher = SimpleNamespace(room=first_room) if first_room is not None else None
                second = SimpleNamespace(room=second_room) if second_room is not None else None
                self.assertEqual(resolve_effective_room(override, teacher, second), expected)

    def test_teacher_without_room_attribute(self):
        self.assertIsNone(resolve_effective_room(None, SimpleNamespace()))
