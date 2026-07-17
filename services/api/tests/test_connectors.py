import httpx

from paperpilot.connectors.crossref import CrossrefConnector
from paperpilot.connectors.europe_pmc import EuropePmcConnector
from paperpilot.connectors.openalex import OpenAlexConnector
from paperpilot.connectors.pubmed import PubMedConnector
from paperpilot.domain.models import ResearchBrief


async def test_pubmed_search_fetches_summaries_and_normalizes_identifiers() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("esearch.fcgi"):
            assert "circulating biomarkers" in request.url.params["term"]
            return httpx.Response(200, json={"esearchresult": {"idlist": ["12345678"]}})
        return httpx.Response(
            200,
            json={
                "result": {
                    "uids": ["12345678"],
                    "12345678": {
                        "uid": "12345678",
                        "title": "Prospective validation of circulating biomarkers",
                        "pubdate": "2024 Jan",
                        "fulljournalname": "Journal of Translational Medicine",
                        "authors": [{"name": "Zhang L"}],
                        "articleids": [
                            {"idtype": "doi", "value": "10.1000/BIOMARKER"},
                            {"idtype": "pmc", "value": "PMC999"},
                        ],
                    },
                }
            },
        )

    connector = PubMedConnector(
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        email="researcher@example.com",
    )

    papers = await connector.search(
        ResearchBrief(question="What is the evidence for circulating biomarkers in treatment response?")
    )

    assert len(papers) == 1
    assert papers[0].pmid == "12345678"
    assert papers[0].doi == "10.1000/biomarker"
    assert papers[0].pmcid == "PMC999"


async def test_europe_pmc_maps_open_access_results() -> None:
    payload = {
        "resultList": {
            "result": [
                {
                    "id": "MED/9876543",
                    "pmid": "9876543",
                    "pmcid": "PMC123",
                    "doi": "10.1000/EPMC",
                    "title": "External biomarker validation",
                    "authorString": "Li X, Wang Y",
                    "journalTitle": "BMC Medicine",
                    "pubYear": "2023",
                    "abstractText": "An external cohort confirmed clinically useful discrimination.",
                    "isOpenAccess": "Y",
                }
            ]
        }
    }
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)))
    connector = EuropePmcConnector(client=client)

    papers = await connector.search(
        ResearchBrief(question="How well do circulating biomarkers predict treatment response?")
    )

    assert papers[0].source == "europe_pmc"
    assert papers[0].url.endswith("PMC123")
    assert papers[0].authors == ["Li X", "Wang Y"]


async def test_crossref_skips_incomplete_records_without_losing_valid_results() -> None:
    payload = {
        "message": {
            "items": [
                {"DOI": "10.1000/no-title"},
                {
                    "DOI": "10.1000/CROSSREF",
                    "title": ["A valid biomedical cohort"],
                    "abstract": "<jats:p>The cohort supported external validation.</jats:p>",
                    "published": {"date-parts": [[2022, 4, 2]]},
                    "author": [{"given": "Mei", "family": "Chen"}],
                    "container-title": ["Clinical Evidence"],
                    "URL": "https://doi.org/10.1000/crossref",
                },
            ]
        }
    }
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)))

    papers = await CrossrefConnector(client=client).search(
        ResearchBrief(question="Which prospective cohorts validate treatment response biomarkers?")
    )

    assert len(papers) == 1
    assert papers[0].doi == "10.1000/crossref"
    assert papers[0].abstract == "The cohort supported external validation."


async def test_openalex_reconstructs_abstract_and_pmid() -> None:
    payload = {
        "results": [
            {
                "id": "https://openalex.org/W123",
                "display_name": "OpenAlex biomarker study",
                "publication_year": 2020,
                "doi": "https://doi.org/10.1000/OA",
                "ids": {"pmid": "https://pubmed.ncbi.nlm.nih.gov/34567890"},
                "authorships": [{"author": {"display_name": "Lin Zhao"}}],
                "primary_location": {"landing_page_url": "https://example.org/paper"},
                "abstract_inverted_index": {"External": [0], "validation": [1], "succeeded": [2]},
            }
        ]
    }
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)))

    papers = await OpenAlexConnector(client=client).search(
        ResearchBrief(question="What external validation exists for response biomarkers?")
    )

    assert papers[0].abstract == "External validation succeeded"
    assert papers[0].pmid == "34567890"
