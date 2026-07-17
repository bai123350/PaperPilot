# PaperPilot

PaperPilot is an evidence-first biomedical research intelligence workspace for individual researchers. It turns a structured research question and optional private PDFs into an auditable progress report, evidence records, research gaps, and three testable next-step proposals.

## Interface preview

### Evidence-linked report

The desktop report keeps claims, research gaps, three next-step proposals, and the supporting Evidence Record in one auditable workspace.

![PaperPilot desktop research report with the evidence drawer open](docs/images/paperpilot-report-desktop.png)

### Responsive report reader

The same evidence workflow adapts to mobile screens with a fixed bottom navigation and a full-width evidence drawer.

<p align="center">
  <img src="docs/images/paperpilot-report-mobile.png" alt="PaperPilot mobile research report with the evidence drawer open" width="360" />
</p>

## Local development

Prerequisites: Python 3.10+, Node.js 22+, npm, and `uv`.

```powershell
uv venv .venv --python 3.10
uv pip install --python .venv\Scripts\python.exe -e "services/api[dev]"
npm install
```

Start the API in one terminal:

```powershell
$env:PYTHONPATH = "services/api/src"
.\.venv\Scripts\python.exe -m uvicorn paperpilot.api.app:app --reload --port 8000
```

Start the web app in another terminal:

```powershell
npm run dev
```

Open `http://localhost:3000`. Demo mode uses an offline literature fixture and a deterministic evidence report, so no API keys are required.

## Full container stack

```bash
docker compose up --build
```

Enable GROBID full-text parsing with `docker compose --profile fulltext up --build`. Before any public deployment, change `PAPERPILOT_AUTH_SECRET`, disable demo mode, configure an enterprise model endpoint, and switch storage to OSS.

## Verification

```powershell
cd services/api
..\..\.venv\Scripts\python.exe -m pytest -q
..\..\.venv\Scripts\ruff.exe check src tests
cd ..\..
npm test
npm run build
```

Architecture and privacy details are in [docs/architecture.md](docs/architecture.md) and [docs/privacy.md](docs/privacy.md). The initial quality benchmark is under [evaluation](evaluation/README.md).
