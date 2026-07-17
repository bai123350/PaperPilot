from paperpilot.domain.models import Paper, ResearchBrief


class DemoConnector:
    name = "demo"

    async def search(self, brief: ResearchBrief) -> list[Paper]:
        return [
            Paper(
                id="demo-1",
                title="Prospective validation of circulating biomarkers for treatment response",
                abstract=(
                    "A prospective multicenter cohort of 312 adults found that a circulating "
                    "biomarker panel predicted treatment response with an area under the curve of "
                    "0.82. Calibration was acceptable, but external geographic validation was not performed."
                ),
                year=2024,
                doi="10.1000/demo.2024.1",
                pmid="39000001",
                authors=["Liu Y", "Zhang Q"],
                journal="Translational Medicine Reports",
                url="https://pubmed.ncbi.nlm.nih.gov/39000001/",
                source=self.name,
            ),
            Paper(
                id="demo-2",
                title="External replication of a multi-analyte response signature",
                abstract=(
                    "An independent cohort replicated the direction of association, although effect "
                    "sizes were smaller and varied by assay batch. The authors called for harmonized "
                    "pre-analytic procedures and prospectively locked thresholds."
                ),
                year=2023,
                doi="10.1000/demo.2023.2",
                pmid="38000002",
                authors=["Wang H", "Chen M"],
                journal="BMC Precision Health",
                source=self.name,
            ),
            Paper(
                id="demo-3",
                title="Systematic assessment of assay variability in biomarker studies",
                abstract=(
                    "Across 18 studies, inconsistent specimen handling and endpoint definitions "
                    "accounted for substantial heterogeneity. Standard operating procedures reduced "
                    "between-laboratory variation in a blinded ring trial."
                ),
                year=2021,
                doi="10.1000/demo.2021.3",
                pmid="35000003",
                authors=["Xu R", "Sun J"],
                journal="Clinical Biomarker Methods",
                source=self.name,
            ),
        ]
