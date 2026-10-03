from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional
from selectolax.parser import HTMLParser
import re

@dataclass
class ParsedLesson:
    date: str
    group_name: str
    lesson_number: int
    subject_name: str
    teacher_name: Optional[str] = None
    room: Optional[str] = None
    is_substitution: bool = False

@dataclass
class ParsedWeek:
    groups: List[str] = field(default_factory=list)
    lessons: List[ParsedLesson] = field(default_factory=list)
    week_type: str = "both"  # "numerator", "denominator", "both"

class ParseError(Exception):
    pass

class KREParser:
    def parse(self, html: str) -> ParsedWeek:
        tree = HTMLParser(html)
        week = ParsedWeek()
        
        parity_node = tree.css_first(".ktt-week__parity")
        if parity_node:
            parity_text = parity_node.text(strip=True).lower()
            if "чисельник" in parity_text:
                week.week_type = "numerator"
            elif "знаменник" in parity_text:
                week.week_type = "denominator"
                
        # 1. Parse Groups
        group_nodes = tree.css(".ktt-groups a")
        if not group_nodes:
            raise ParseError("No groups found structure might have changed")
            
        week.groups = list(set([g.text(strip=True) for g in group_nodes if g.text(strip=True)]))
        
        # Find active group
        active_group_node = tree.css_first(".ktt-groups a[aria-current='true']")
        if not active_group_node:
            raise ParseError("Cannot find active group on the page")
        active_group = active_group_node.text(strip=True)

        # 2. Parse Days and lessons for the active group
        day_nodes = tree.css(".ktt-day")
        if not day_nodes:
            raise ParseError("No schedule days found")

        # Map start hour to lesson number (approximate logic based on KRE bells)
        # 07:30 -> 0
        # 09:00 -> 1
        # 10:40 -> 2
        # 12:30 -> 3
        # 14:00 -> 4
        def resolve_lesson_number(time_str: str) -> int:
            if not time_str:
                return 1
            if "7:30" in time_str or "07:30" in time_str: return 0
            if "9:00" in time_str or "09:00" in time_str: return 1
            if "10:40" in time_str: return 2
            if "12:30" in time_str: return 3
            if "14:00" in time_str: return 4
            if "15:30" in time_str: return 5
            return 1 # Fallback

        for day in day_nodes:
            date_str = day.attributes.get("data-day")
            if not date_str:
                continue
                
            lessons = day.css(".ktt-lesson")
            for lesson_node in lessons:
                classes = lesson_node.attributes.get("class", "")
                is_substitution = "is-substitution" in classes
                
                time_b = lesson_node.css_first(".ktt-lesson__time b")
                time_str = time_b.text(strip=True) if time_b else ""
                lesson_number = resolve_lesson_number(time_str)
                
                subject_node = lesson_node.css_first(".ktt-lesson__subject")
                subject_name = subject_node.text(strip=True) if subject_node else "Unknown"
                
                teacher_name, room = None, None
                meta_nodes = lesson_node.css(".ktt-lesson__meta")
                for meta in meta_nodes:
                    text = meta.text(strip=True)
                    if text.lower().startswith("аудиторія") or text.lower().startswith("ауд"):
                        room = text
                    else:
                        teacher_name = text
                
                # Double check substitution badge
                badge = lesson_node.css_first(".ktt-lesson__badge")
                if badge and "Заміна" in badge.text(strip=True):
                    is_substitution = True
                    
                pl = ParsedLesson(
                    date=datetime.strptime(date_str, "%Y-%m-%d").date(),
                    group_name=active_group,
                    lesson_number=lesson_number,
                    subject_name=subject_name,
                    teacher_name=teacher_name,
                    room=room,
                    is_substitution=is_substitution
                )
                week.lessons.append(pl)
                
        if len(week.lessons) == 0:
            raise ParseError("Parsed 0 lessons. HTML structure anomaly.")

        return week
