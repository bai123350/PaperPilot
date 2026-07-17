import json
from pathlib import Path


def test_biomedical_evaluation_set_contains_twenty_reviewable_topics() -> None:
    path = Path(__file__).parents[3] / "evaluation" / "biomedical_topics.json"
    topics = json.loads(path.read_text(encoding="utf-8"))

    assert len(topics) >= 20
    assert all(len(item["question"]) >= 20 for item in topics)
    assert all(item["domain"] and item["review_dimensions"] for item in topics)
