from __future__ import annotations

import re
from collections.abc import Mapping

import httpx

from paperpilot.domain.models import (
    DatasetModality,
    PublicDataset,
    ResearchBrief,
)


class DemoDatasetConnector:
    name = "demo_public_datasets"

    async def search(self, brief: ResearchBrief) -> list[PublicDataset]:
        return [
            PublicDataset(
                id="dataset-demo-bulk",
                accession="DEMO-GEO-BULK-001",
                title="独立队列的 bulk RNA-seq 表达谱",
                source="NCBI GEO（演示）",
                modality=DatasetModality.BULK_RNA,
                organism="Homo sapiens",
                sample_count=96,
                summary="病例与对照的 bulk RNA-seq 队列，可用于候选信号的表达复现。",
                data_types=["RNA-seq", "processed counts"],
                url="https://www.ncbi.nlm.nih.gov/geo/",
            ),
            PublicDataset(
                id="dataset-demo-single-cell",
                accession="DEMO-CELLXGENE-SC-001",
                title="目标组织的单细胞转录组图谱",
                source="CELLxGENE（演示）",
                modality=DatasetModality.SINGLE_CELL,
                organism="Homo sapiens",
                sample_count=18,
                summary="包含主要细胞类型注释的 scRNA-seq 数据，可定位候选信号的细胞来源。",
                data_types=["scRNA-seq", "h5ad"],
                url="https://cellxgene.cziscience.com/datasets",
            ),
            PublicDataset(
                id="dataset-demo-spatial",
                accession="DEMO-GEO-SPATIAL-001",
                title="疾病组织的空间转录组数据",
                source="NCBI GEO（演示）",
                modality=DatasetModality.SPATIAL,
                organism="Homo sapiens",
                sample_count=12,
                summary="空间表达矩阵与组织切片，可用于验证候选通路的组织区域定位。",
                data_types=["spatial transcriptomics", "tissue images"],
                url="https://www.ncbi.nlm.nih.gov/geo/",
            ),
            PublicDataset(
                id="dataset-demo-atac",
                accession="DEMO-ENCODE-ATAC-001",
                title="相关细胞类型的开放染色质图谱",
                source="ENCODE（演示）",
                modality=DatasetModality.ATAC_SEQ,
                organism="Homo sapiens",
                sample_count=8,
                summary="标准化 ATAC-seq 峰与信号轨迹，可评估候选调控区域的可及性。",
                data_types=["ATAC-seq", "bigWig", "peaks"],
                url="https://www.encodeproject.org/",
            ),
            PublicDataset(
                id="dataset-demo-genomics",
                accession="DEMO-GDC-GENOME-001",
                title="开放访问的队列基因组变异数据",
                source="NCI GDC（演示）",
                modality=DatasetModality.GENOMICS,
                organism="Homo sapiens",
                sample_count=240,
                summary="包含开放层级的体细胞变异与拷贝数数据，可用于候选基因的基因组验证。",
                data_types=["somatic variants", "copy number"],
                url="https://portal.gdc.cancer.gov/",
            ),
        ]


class NcbiGeoDatasetConnector:
    name = "ncbi_geo_datasets"
    base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    modality_queries: Mapping[DatasetModality, str] = {
        DatasetModality.BULK_RNA: (
            '"RNA sequencing" OR "expression profiling by high throughput sequencing"'
        ),
        DatasetModality.SINGLE_CELL: (
            '"single cell RNA-seq" OR scRNA-seq OR snRNA-seq OR "single nucleus RNA-seq"'
        ),
        DatasetModality.SPATIAL: (
            '"spatial transcriptomics" OR "spatially resolved transcriptomics" OR Visium'
        ),
        DatasetModality.ATAC_SEQ: (
            'ATAC-seq OR "assay for transposase-accessible chromatin"'
        ),
        DatasetModality.GENOMICS: (
            '"whole genome sequencing" OR "whole exome sequencing" OR WGS OR WES'
        ),
    }

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        email: str = "researcher@example.com",
        api_key: str | None = None,
        limit_per_modality: int = 3,
    ) -> None:
        self.client = client or httpx.AsyncClient(timeout=30)
        self.email = email
        self.api_key = api_key
        self.limit_per_modality = limit_per_modality

    async def search(self, brief: ResearchBrief) -> list[PublicDataset]:
        common = {"retmode": "json", "tool": "paperpilot", "email": self.email}
        if self.api_key:
            common["api_key"] = self.api_key

        datasets: list[PublicDataset] = []
        seen: set[str] = set()
        base_query = self._base_query(brief)
        for modality, modality_query in self.modality_queries.items():
            search = await self.client.get(
                f"{self.base_url}/esearch.fcgi",
                params={
                    **common,
                    "db": "gds",
                    "term": f"({base_query}) AND ({modality_query}) AND gse[ETYP]",
                    "retmax": self.limit_per_modality,
                },
            )
            search.raise_for_status()
            ids = search.json().get("esearchresult", {}).get("idlist", [])
            if not ids:
                continue
            summary = await self.client.get(
                f"{self.base_url}/esummary.fcgi",
                params={**common, "db": "gds", "id": ",".join(ids)},
            )
            summary.raise_for_status()
            result = summary.json().get("result", {})
            for uid in result.get("uids", []):
                dataset = self._dataset(result.get(uid, {}), modality)
                if not dataset or dataset.accession in seen:
                    continue
                seen.add(dataset.accession)
                datasets.append(dataset)
        return datasets

    @staticmethod
    def _base_query(brief: ResearchBrief) -> str:
        parts = [brief.question.rstrip("?？")]
        parts.extend(brief.keywords[:6])
        if brief.population:
            parts.append(brief.population)
        return " AND ".join(f"({part})" for part in parts if part.strip())

    @classmethod
    def _dataset(
        cls,
        record: Mapping[str, object],
        fallback_modality: DatasetModality,
    ) -> PublicDataset | None:
        accession = str(record.get("accession") or "").strip()
        title = str(record.get("title") or "").strip()
        if not accession or not title:
            return None
        sample_count = cls._integer(record.get("n_samples"))
        data_type = str(record.get("gdsType") or record.get("gdstype") or "").strip()
        summary = str(record.get("summary") or "").strip()
        modality = cls._infer_modality(" ".join((title, summary, data_type)), fallback_modality)
        return PublicDataset(
            id=f"ncbi-geo-{accession.lower()}",
            accession=accession,
            title=title,
            source="NCBI GEO",
            modality=modality,
            organism=str(record.get("taxon") or "").strip() or None,
            sample_count=sample_count,
            summary=summary[:3000],
            data_types=[data_type] if data_type else [],
            url=f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={accession}",
        )

    @staticmethod
    def _integer(value: object) -> int | None:
        match = re.search(r"\d+", str(value or ""))
        return int(match.group()) if match else None

    @staticmethod
    def _infer_modality(text: str, fallback: DatasetModality) -> DatasetModality:
        normalized = text.lower()
        if any(term in normalized for term in ("spatial", "visium", "slide-seq")):
            return DatasetModality.SPATIAL
        if any(term in normalized for term in ("single cell", "single-cell", "scrna", "snrna")):
            return DatasetModality.SINGLE_CELL
        if any(term in normalized for term in ("atac-seq", "chromatin accessibility")):
            return DatasetModality.ATAC_SEQ
        if any(term in normalized for term in ("whole genome", "whole exome", "genomic", "wgs", "wes")):
            return DatasetModality.GENOMICS
        return fallback


class EncodeDatasetConnector:
    name = "encode_datasets"
    endpoint = "https://www.encodeproject.org/search/"
    assays: Mapping[DatasetModality, tuple[str, ...]] = {
        DatasetModality.BULK_RNA: ("total RNA-seq", "polyA plus RNA-seq"),
        DatasetModality.ATAC_SEQ: ("ATAC-seq",),
    }

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        limit_per_assay: int = 2,
    ) -> None:
        self.client = client or httpx.AsyncClient(timeout=30)
        self.limit_per_assay = limit_per_assay

    async def search(self, brief: ResearchBrief) -> list[PublicDataset]:
        datasets: list[PublicDataset] = []
        seen: set[str] = set()
        search_term = self._search_term(brief)
        for modality, assays in self.assays.items():
            for assay in assays:
                response = await self.client.get(
                    self.endpoint,
                    params={
                        "type": "Experiment",
                        "assay_title": assay,
                        "status": "released",
                        "searchTerm": search_term,
                        "format": "json",
                        "limit": self.limit_per_assay,
                    },
                    headers={"Accept": "application/json"},
                )
                response.raise_for_status()
                for record in response.json().get("@graph", []):
                    dataset = self._dataset(record, modality, assay)
                    if not dataset or dataset.accession in seen:
                        continue
                    seen.add(dataset.accession)
                    datasets.append(dataset)
        return datasets

    @staticmethod
    def _search_term(brief: ResearchBrief) -> str:
        if brief.keywords:
            return " ".join(brief.keywords[:6])
        if brief.population:
            return brief.population
        return brief.question.rstrip("?？")

    @staticmethod
    def _dataset(
        record: Mapping[str, object],
        modality: DatasetModality,
        assay: str,
    ) -> PublicDataset | None:
        accession = str(record.get("accession") or "").strip()
        if not accession:
            return None
        descriptions = record.get("description")
        description = (
            " ".join(str(item) for item in descriptions)
            if isinstance(descriptions, list)
            else str(descriptions or "").strip()
        )
        biosample = str(record.get("biosample_summary") or "").strip()
        title = biosample or description or f"{assay} experiment {accession}"
        replicates = record.get("replicates")
        sample_count = len(replicates) if isinstance(replicates, list) else None
        return PublicDataset(
            id=f"encode-{accession.lower()}",
            accession=accession,
            title=title,
            source="ENCODE",
            modality=modality,
            sample_count=sample_count,
            summary=description[:3000],
            data_types=[assay],
            url=f"https://www.encodeproject.org/experiments/{accession}/",
        )
