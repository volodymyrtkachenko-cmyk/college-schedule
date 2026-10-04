from datetime import date
from app.services.importer.parsers.kre_parser import KREParser

def test_kre_parser_real_html():
    with open("backend/tests/fixtures/kre_group_with_substitution.html", "r", encoding="utf-8") as f:
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
