from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional
from selectolax.parser import HTMLParser

@dataclass
class ParsedLesson:
    date: date
    group_name: str
    lesson_number: int
    subject_name: str
    teacher_name: Optional[str] = None
    room: Optional[str] = None
    is_substitution: bool = False

@dataclass
class ParsedWeek:
    groups: List[str] = field(default_factory=list)
    bells: List[str] = field(default_factory=list)
    lessons: List[ParsedLesson] = field(default_factory=list)

class ParseError(Exception):
    pass

class KREParser:
    def parse(self, html: str, target_date: date) -> ParsedWeek:
        tree = HTMLParser(html)
        # TODO: Real logic for parsing KRE schedule
        # It should raise ParseError if structure changes and few records returned
        week = ParsedWeek()
        
        # Hypothetical parsing logic based on generic table or div structure
        # ...
        
        return week
