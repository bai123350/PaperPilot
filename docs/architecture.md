# PaperPilot Architecture

PaperPilot is a web-first biomedical research workspace. The Next.js client owns project navigation and report reading. FastAPI owns authentication, project isolation, upload tickets, persistence, and versioned HTTP contracts. Celery workers execute the durable research pipeline.

## Research flow

1. Convert the submitted brief into a structured biomedical question.
2. Search PubMed, Europe PMC, Crossref, and OpenAlex; private PDFs enter through the same connector boundary.
3. Normalize PMID, PMCID, and DOI before title-based deduplication.
4. Parse private PDFs with GROBID and fall back to PyMuPDF.
5. Create immutable `EvidenceRecord` objects before synthesis.
6. Generate claims and exactly three recommendations. Model-generated evidence IDs must belong to the current run.
7. Persist the versioned report and evidence records, then expose HTML, JSON, SSE, and Markdown views.

The demo connector and deterministic synthesizer make local development reproducible. Production enables real connectors with `PAPERPILOT_DEMO_MODE=false` and enables the model synthesizer only when all model settings are present.

## Boundaries

- API and worker share domain models; the frontend maps one versioned report JSON document.
- PostgreSQL is the source of truth. pgvector is reserved for retrieval and never replaces evidence records.
- Redis carries jobs and transient task results, not private document content.
- Storage adapters share user/project-scoped object keys. OSS uploads request KMS server-side encryption.
- Desktop and local execution are not implemented. A future executor can consume the same research-run contract.
