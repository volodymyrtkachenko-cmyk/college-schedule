from datetime import date
from app.services.importer.parsers.kre_parser import KREParser

def test_kre_parser_basic_structure():
    with open("backend/tests/fixtures/kre_schedule.html", "r") as f:
        html = f.read()

    parser = KREParser()
    target = date(2026, 10, 1)
    
    # Run the parser method to ensure it doesn't crash. 
    # (Actual parser logic to extract nodes will go here once tailored to actual HTML).
    parsed = parser.parse(html, target)
    assert parsed is not None
