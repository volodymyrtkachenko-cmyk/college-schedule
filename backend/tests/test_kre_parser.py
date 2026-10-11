from datetime import date
from pathlib import Path
from app.services.importer.parsers.kre_parser import KREParser

def test_kre_parser_real_html():
    fixture_path = Path(__file__).parent / "fixtures" / "kre_group_with_substitution.html"
    with open(fixture_path, "r", encoding="utf-8") as f:
        html = f.read()

    parser = KREParser()
    parsed = parser.parse(html)
    
    assert parsed.groups
    assert '82' in parsed.groups
    assert len(parsed.lessons) > 0
    
    # Check if a substitution is found
    subs = [l for l in parsed.lessons if l.is_substitution]
    assert len(subs) > 0

    first_sub = subs[0]
    assert first_sub.lesson_number in [0, 1, 2, 3, 4]
    
    # Print for manual inspection during test execution
    print(f"\nTotal lessons: {len(parsed.lessons)}, Total substitutions: {len(subs)}")
    print(f"Sample Substitution: {first_sub.date} | {first_sub.subject_name} | Sub: {first_sub.is_substitution}")


def test_kre_parser_requires_exact_substitution_class_token():
    html = """
    <div class="ktt-week__parity">Знаменник</div>
    <div class="ktt-groups"><a aria-current="true">82</a></div>
    <div class="ktt-day" data-day="2026-10-05">
      <ol>
        <li class="ktt-lesson not-is-substitution">
          <p class="ktt-lesson__time"><b>9:00</b></p>
          <p class="ktt-lesson__subject">Математика</p>
        </li>
      </ol>
    </div>
    """

    lesson = KREParser().parse(html).lessons[0]

    assert lesson.is_substitution is False


import pytest
from app.services.importer.parsers.kre_parser import ParseError
from app.services.importer.normalizer import EntityNormalizer, clean_name


def _page(lessons_html: str) -> str:
    return f"""
    <div class="ktt-week__parity">Чисельник</div>
    <div class="ktt-groups"><a aria-current="true">82</a></div>
    <div class="ktt-day" data-day="2026-10-05"><ol>{lessons_html}</ol></div>
    """


def test_empty_week_is_valid():
    parsed = KREParser().parse(_page(""))
    assert parsed.lessons == []
    assert parsed.week_type == "numerator"


def test_unknown_bell_time_fails_loudly():
    html = _page('<li class="ktt-lesson"><p class="ktt-lesson__time"><b>8:15</b></p>'
                 '<p class="ktt-lesson__subject">X</p></li>')
    with pytest.raises(ParseError):
        KREParser().parse(html)


def test_bell_time_must_match_exactly():
    # "19:00" must not be mistaken for "9:00".
    html = _page('<li class="ktt-lesson"><p class="ktt-lesson__time"><b>19:00</b></p>'
                 '<p class="ktt-lesson__subject">X</p></li>')
    with pytest.raises(ParseError):
        KREParser().parse(html)


def test_normalizer_matches_star_and_truncated_teacher():
    n = EntityNormalizer(db=None)
    n.remember("subject", "Інформатика", 1)
    n.remember("teacher", "Миргородський Д.О.", 7)
    n.remember("teacher", "Шевченко В.І.", 8)
    n.remember("teacher", "Шевченко В.П.", 9)
    assert n.normalize_subject("Інформатика*") == 1
    assert n.normalize_subject("  інформатика ") == 1
    assert n.normalize_teacher("Миргородський Д.") == 7
    assert n.normalize_teacher("Шевченко В.") is None  # ambiguous prefix
    assert clean_name("Інформатика*") == "Інформатика"
