from paperpilot.domain.models import Paper
from paperpilot.services.deduplication import deduplicate_papers


def test_deduplicates_by_doi_before_title() -> None:
    papers = [
        Paper(
            id="a",
            title="A randomized trial of an intervention",
            abstract="First source abstract",
            year=2024,
            doi="10.1000/trial",
            source="pubmed",
        ),
        Paper(
            id="b",
            title="A Randomized Trial of an Intervention",
            abstract="A more complete abstract from Europe PMC with additional details.",
            year=2024,
            doi="https://doi.org/10.1000/TRIAL",
            pmid="1234",
            source="europe_pmc",
        ),
    ]

    result = deduplicate_papers(papers)

    assert len(result) == 1
    assert result[0].pmid == "1234"
    assert result[0].abstract.startswith("A more complete")


def test_keeps_distinct_papers_with_similar_but_nonidentical_titles() -> None:
    papers = [
        Paper(id="a", title="Microbiome signatures in colorectal cancer", source="pubmed"),
        Paper(id="b", title="Microbiome signatures after colorectal cancer therapy", source="pubmed"),
    ]

    assert len(deduplicate_papers(papers)) == 2
