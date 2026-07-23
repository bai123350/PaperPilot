# Conversation Operation Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist safe, fine-grained research operations and render each operation as a full card in the conversation while the report pane waits quietly until the final report is ready.

**Architecture:** A dedicated `run_operations` table is the source of truth. Pipeline and conversation services emit typed operation updates through a small persistence service; a versioned REST response and the existing Run SSE expose safe payloads. The web client merges messages and operations into one chronological timeline and keeps the right pane limited to waiting, terminal error, or final report states.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy 2, Alembic, pytest, Next.js App Router, React, TypeScript, Vitest, Testing Library, Tailwind/global CSS, Playwright.

## Global Constraints

- Keep Run status values limited to `queued/running/waiting/retrying/completed/failed/cancelled`.
- Operation status values are limited to `running/completed/failed`.
- Operation `title`, `summary`, and `metrics` are generated from server-owned templates and allowlists; never persist or transmit prompts, research-question text, paper text, evidence excerpts, or raw model responses.
- All operation reads validate both `run_id` and authenticated `user_id`.
- Project deletion must cascade through Run to operations.
- Demo mode must emit deterministic operations without an external API key.
- The report still contains exactly three Recommendation items and evidence-linked Claims.
- Do not commit, push, create a PR, or deploy unless the user explicitly requests it.
- `.superpowers/` is local brainstorming state and must remain untracked.

---

## File Structure

- `services/api/src/paperpilot/database.py`: add the SQLAlchemy entity and Run relationship.
- `services/api/alembic/versions/20260723_0003_run_operations.py`: create operation storage and constraints.
- `services/api/src/paperpilot/domain/operations.py`: define operation kinds, statuses, update contract, and public payload.
- `services/api/src/paperpilot/services/operation_recorder.py`: generate safe text, allocate sequence numbers, and persist state transitions.
- `services/api/src/paperpilot/services/pipeline.py`: emit real operation updates with counts around pipeline work.
- `services/api/src/paperpilot/run_service.py`: connect pipeline updates to durable storage and record terminal report/failure operations.
- `services/api/src/paperpilot/api/routes/runs.py`: add the versioned operations endpoint and emit operation SSE events.
- `services/api/src/paperpilot/api/routes/run_conversation.py`: record evidence lookup, grounded response, citation audit, revision validation, and version-save operations.
- `apps/web/lib/api.ts`: add operation contracts, list retrieval, and authenticated Run SSE parsing.
- `apps/web/lib/run-timeline.ts`: merge and stably sort messages and operations.
- `apps/web/components/operation-card.tsx`: render a single full operation card.
- `apps/web/components/research-conversation.tsx`: render merged timeline entries.
- `apps/web/components/run-workspace-client.tsx`: load operations, subscribe/fallback refresh, and pass retry behavior.
- `apps/web/components/run-workspace-view.tsx`: render only waiting/error/report content in the right pane.
- `apps/web/app/globals.css`: desktop/mobile operation cards and pane state styling.
- Existing backend and frontend test files: extend behavior coverage without unrelated refactors.

---

### Task 1: Durable Operation Model and Safe Recorder

**Files:**
- Create: `services/api/src/paperpilot/domain/operations.py`
- Create: `services/api/src/paperpilot/services/operation_recorder.py`
- Create: `services/api/alembic/versions/20260723_0003_run_operations.py`
- Modify: `services/api/src/paperpilot/database.py`
- Modify: `services/api/tests/test_migrations.py`
- Create: `services/api/tests/test_operation_recorder.py`

**Interfaces:**
- Produces: `OperationStatus`, `OperationTaskKind`, `OperationKind`, `OperationUpdate`, `RunOperation`.
- Produces: `OperationRecorder.start(run_id, update, conversation_message_id=None) -> str`.
- Produces: `OperationRecorder.complete(operation_id, metrics=None) -> None`.
- Produces: `OperationRecorder.fail(operation_id, error_category) -> None`.
- Produces: `operation_payload(entity) -> RunOperation`.

- [ ] **Step 1: Write migration and recorder tests that describe storage behavior**

Add migration assertions for `run_operations`, its `run_id` index, and the `(run_id, sequence)` unique constraint. Add recorder tests equivalent to:

```python
operation_id = recorder.start(
    run.id,
    OperationUpdate(
        task_kind=OperationTaskKind.RESEARCH_RUN,
        operation_kind=OperationKind.SEARCH_SOURCE,
        stage=RunStage.SEARCHING,
        template_key="search_source",
        metrics={"source_count": 1},
    ),
)
recorder.complete(operation_id, {"candidate_count": 42, "duration_ms": 4800})
stored = session.get(RunOperationEntity, operation_id)
assert stored.sequence == 1
assert stored.status == "completed"
assert stored.title == "检索文献来源"
assert stored.summary == "已完成文献来源检索，发现 42 篇候选文献。"
assert stored.metrics == {"source_count": 1, "candidate_count": 42, "duration_ms": 4800}
```

Also assert that unsupported metric keys and string metric values raise `ValueError`, a completed operation cannot transition again, and a second start receives sequence `2`.

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```powershell
cd services/api
..\..\.venv\Scripts\python.exe -m pytest -q tests/test_operation_recorder.py tests/test_migrations.py
```

Expected: collection/import failure because operation types, entity, recorder, and migration do not exist.

- [ ] **Step 3: Implement the domain types, entity, migration, and recorder**

Use string enums for:

```python
class OperationStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class OperationTaskKind(str, Enum):
    RESEARCH_RUN = "research_run"
    DISCUSSION = "discussion"
    REPORT_REVISION = "report_revision"
```

Define controlled operation kinds for structure, source search, deduplication, screening, parsing, evidence creation, synthesis, recommendations, citation audit, report save, evidence lookup, grounded response, revision validation, and revision save.

`RunOperationEntity` uses `UniqueConstraint("run_id", "sequence", name="uq_run_operations_run_sequence")`, JSON metrics, timestamps, and `ondelete="CASCADE"` for Run. `OperationRecorder` owns all Chinese title/summary templates and validates metrics against:

```python
ALLOWED_METRICS = {
    "source_count", "candidate_count", "retained_count",
    "parsed_count", "evidence_count", "recommendation_count",
    "citation_count", "report_version", "duration_ms",
}
```

Use a transaction-local `max(sequence) + 1` allocation. Keep error summaries mapped from a small safe category dictionary; never store `str(exc)`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: all focused tests pass with no warnings from application code.

---

### Task 2: Pipeline and RunService Emit Real Operations

**Files:**
- Modify: `services/api/src/paperpilot/services/pipeline.py`
- Modify: `services/api/src/paperpilot/run_service.py`
- Modify: `services/api/tests/test_pipeline.py`
- Create: `services/api/tests/test_run_operations.py`

**Interfaces:**
- Consumes: `OperationUpdate`, `OperationKind`, `OperationRecorder`.
- Produces: `OperationCallback = Callable[[Literal["start", "complete", "fail"], str | None, OperationUpdate | dict], str | None]`.
- Changes: `ResearchPipeline.run(brief, on_stage, on_operation)` emits deterministic operation boundaries.

- [ ] **Step 1: Add failing pipeline operation-order and RunService persistence tests**

The pipeline test collects updates and asserts the ordered completed kinds:

```python
assert completed_kinds == [
    "structure_question",
    "search_source",
    "deduplicate",
    "screen",
    "parse",
    "create_evidence",
    "synthesize",
    "recommend",
    "citation_audit",
]
assert completed_metrics["search_source"]["candidate_count"] == 1
assert completed_metrics["create_evidence"]["evidence_count"] == 1
assert completed_metrics["recommend"]["recommendation_count"] == 3
```

The RunService test executes a demo Run and asserts the persisted last operation is `save_report/completed`, all sequences are ordered, and no title/summary contains the brief question.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd services/api
..\..\.venv\Scripts\python.exe -m pytest -q tests/test_pipeline.py tests/test_run_operations.py
```

Expected: failures because `on_operation` and persisted operations are missing.

- [ ] **Step 3: Implement operation emissions**

Wrap each actual pipeline action with start/complete calls. Search emits one operation per connector with aggregate-safe counts but never the query or paper titles. Deduplication reports input and retained counts using allowed metrics. Parsing and evidence creation report counts. Recommendation completion always reports `recommendation_count=3`.

In `RunService.execute`, instantiate `OperationRecorder`, translate pipeline callbacks to recorder calls, append a `save_report` operation only after evidence and report persistence succeeds, and mark the active operation failed with a safe category when an exception escapes.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: all pipeline and RunService operation tests pass.

---

### Task 3: Versioned Operations API and Run SSE

**Files:**
- Modify: `services/api/src/paperpilot/api/routes/runs.py`
- Modify: `services/api/tests/test_api.py`

**Interfaces:**
- Consumes: `RunOperation`, `operation_payload`.
- Produces: `GET /v1/runs/{run_id}/operations` returning `{"contract_version":"1.0","operations":[...]}`.
- Extends: `GET /v1/runs/{run_id}/events` with `event: operation` and a stable `id`.

- [ ] **Step 1: Add failing API tests**

Add tests that:

```python
response = client.get(f"/v1/runs/{run_id}/operations", headers=owner)
assert response.json()["contract_version"] == "1.0"
assert [item["sequence"] for item in response.json()["operations"]] == sorted(...)
assert set(response.json()["operations"][0]) == {
    "id", "run_id", "sequence", "task_kind", "operation_kind", "stage",
    "title", "summary", "status", "metrics", "conversation_message_id",
    "started_at", "completed_at",
}
assert client.get(..., headers=stranger).status_code == 404
assert "event: operation" in client.get(f"/v1/runs/{run_id}/events", headers=owner).text
```

Also delete the Project and assert no operation rows remain.

- [ ] **Step 2: Run the API tests and verify RED**

Run:

```powershell
cd services/api
..\..\.venv\Scripts\python.exe -m pytest -q tests/test_api.py -k "operation or deleting_project"
```

Expected: 404 for the new endpoint or missing operation events.

- [ ] **Step 3: Implement the REST and SSE contracts**

Define Pydantic response models with `Literal["1.0"]`. Query operations only after `owned_run(session, user.id, run_id)` succeeds. Order by sequence and stable ID. In SSE, track delivered operation IDs independently from legacy stage-array position and emit:

```python
{
    "event": "operation",
    "id": operation.id,
    "data": json.dumps(operation_payload(operation).model_dump(mode="json")),
}
```

Do not add arbitrary exception text to SSE.

- [ ] **Step 4: Run focused API tests and verify GREEN**

Run the command from Step 2.

Expected: all selected API tests pass.

---

### Task 4: Conversation and Report Revision Operations

**Files:**
- Modify: `services/api/src/paperpilot/api/routes/run_conversation.py`
- Modify: `services/api/tests/test_api.py`

**Interfaces:**
- Consumes: `OperationRecorder`.
- Produces discussion operations: `lookup_evidence`, `grounded_response`, `citation_audit`, `save_response`.
- Produces revision operations: `lookup_evidence`, `revise_report`, `revision_validation`, `save_revision`.

- [ ] **Step 1: Add failing conversation-operation tests**

Extend the existing revision and stream tests:

```python
operations = client.get(f"/v1/runs/{run_id}/operations", headers=headers).json()["operations"]
revision_ops = [item for item in operations if item["task_kind"] == "report_revision"]
assert [item["operation_kind"] for item in revision_ops] == [
    "lookup_evidence", "revise_report", "revision_validation", "save_revision"
]
assert revision_ops[-1]["metrics"]["report_version"] == 2
```

For a discussion response, assert evidence lookup and grounded-response cards are persisted and associated with the user message. Add a provider-failure case that leaves the prior report/version unchanged and stores a failed operation with a safe summary.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd services/api
..\..\.venv\Scripts\python.exe -m pytest -q tests/test_api.py -k "conversation or revision"
```

Expected: operation-list assertions fail because conversation routes do not record operations.

- [ ] **Step 3: Add recorder boundaries to conversation routes**

Create all operations after the user message is flushed so `conversation_message_id` is available. Complete evidence lookup with `evidence_count`; complete citation audit with validated citation count. For revision, do not complete or save `save_revision` until `SynthesisPayload`, allowed evidence IDs, Claim coverage, and exactly three recommendations are validated. On provider or response failure, fail the active operation using a safe category and keep existing HTTP/SSE user-facing errors.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: all selected conversation tests pass and existing report-version assertions remain valid.

---

### Task 5: Frontend Contracts, Timeline Merge, and Full Operation Cards

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/lib/run-timeline.ts`
- Create: `apps/web/lib/run-timeline.test.ts`
- Create: `apps/web/components/operation-card.tsx`
- Create: `apps/web/components/operation-card.test.tsx`
- Modify: `apps/web/components/research-conversation.tsx`
- Modify: `apps/web/components/research-conversation.test.tsx`

**Interfaces:**
- Produces: `RunOperation`, `RunOperationList`.
- Produces: `api.getRunOperations(id)`.
- Produces: `mergeRunTimeline(messages, operations) -> RunTimelineEntry[]`.
- Changes: `ResearchConversation` accepts `operations: RunOperation[]` and optional `onRetry`.

- [ ] **Step 1: Add failing timeline and component tests**

Test stable chronological merging and ID deduplication. Render each operation state and assert accessible text:

```tsx
expect(screen.getByText("已完成文献来源检索，发现 42 篇候选文献。")).toBeInTheDocument();
expect(screen.getByText("42 篇候选文献")).toBeInTheDocument();
expect(screen.getByText("4.8 秒")).toBeInTheDocument();
expect(screen.getByText("进行中")).toBeInTheDocument();
```

Add a conversation test with one user message, one intervening operation, and one assistant message; assert DOM order reflects timestamps.

- [ ] **Step 2: Run focused web tests and verify RED**

Run:

```powershell
npm test -- --run apps/web/lib/run-timeline.test.ts apps/web/components/operation-card.test.tsx apps/web/components/research-conversation.test.tsx
```

Expected: missing modules/types or missing operation content.

- [ ] **Step 3: Implement contracts, merger, and card**

Add exact TypeScript unions matching API literals. `mergeRunTimeline` creates discriminated entries:

```ts
type RunTimelineEntry =
  | { kind: "message"; id: string; createdAt: string; message: RunConversationMessage }
  | { kind: "operation"; id: string; createdAt: string; sequence: number; operation: RunOperation };
```

Sort by `createdAt`, then operation sequence, then ID. `OperationCard` maps controlled kinds to Lucide icons, formats allowed metrics, uses `<article aria-label="研究操作：...">`, and shows Retry only for a failed research-run operation when `onRetry` exists.

- [ ] **Step 4: Run focused web tests and verify GREEN**

Run the command from Step 2.

Expected: all selected tests pass.

---

### Task 6: Live Workspace, Quiet Report Pane, and Responsive Layout

**Files:**
- Modify: `apps/web/components/run-workspace-client.tsx`
- Modify: `apps/web/components/run-workspace-view.tsx`
- Modify: `apps/web/components/run-workspace-view.test.tsx`
- Create: `apps/web/components/run-workspace-client.test.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/e2e/research-flow.spec.ts`

**Interfaces:**
- Consumes: `api.getRunOperations`, `ResearchConversation.operations`.
- Produces: quiet waiting, terminal error, and report-only right-pane states.
- Produces: `retryRun` UI behavior from the last failed research operation.

- [ ] **Step 1: Add failing workspace tests**

Test that a running Run renders `报告准备中` and does not render `研究流水线`, a percentage, or `运行信息`. Test that completed Run renders the report. Test failed Run renders `尚未生成报告` and provides retry through the conversation card. In the client test, mock Run/Conversation/Operations responses and assert new operations appear after refresh without duplicate IDs.

- [ ] **Step 2: Run focused workspace tests and verify RED**

Run:

```powershell
npm test -- --run apps/web/components/run-workspace-view.test.tsx apps/web/components/run-workspace-client.test.tsx
```

Expected: old stage rail/progress remains and operations are not loaded.

- [ ] **Step 3: Implement workspace state and CSS**

Remove `StageRail`, progress percent, progress track, and run facts from `RunWorkspaceView`. Add semantic waiting and terminal placeholders. Load operations alongside Run and Conversation; refresh them on the existing 1.2-second loop and after conversation/revision requests. Use ID-based replacement so an updated running card becomes completed rather than duplicated. Preserve report fetching only for completed Run.

CSS requirements:

- Desktop grid uses approximately `420px minmax(0, 1fr)`.
- Full operation cards wrap metrics and never overflow.
- At `max-width: 1050px`, running pages keep conversation first.
- At completed state, apply a class that places report first and conversation second on mobile.
- Add `@media (prefers-reduced-motion: reduce)` to disable operation animations.
- Keep input controls above the fixed mobile bottom navigation.

- [ ] **Step 4: Update E2E expectations**

During Run, assert `报告准备中` and at least one operation card. After completion, assert the report and evidence drawer remain usable. Add mobile viewport checks for no horizontal overflow:

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- --run apps/web/components/run-workspace-view.test.tsx apps/web/components/run-workspace-client.test.tsx apps/web/components/research-conversation.test.tsx apps/web/components/operation-card.test.tsx apps/web/lib/run-timeline.test.ts
```

Expected: all selected tests pass.

---

### Task 7: Repository Hygiene and Full Verification

**Files:**
- Modify: `.gitignore`
- Verify only: all changed implementation and test files.

**Interfaces:**
- No new runtime interface.

- [ ] **Step 1: Keep Visual Companion state out of Git**

Add:

```gitignore
.superpowers/
```

Verify `git status --short` no longer lists `.superpowers/`.

- [ ] **Step 2: Run backend tests and lint**

Run:

```powershell
cd services/api
..\..\.venv\Scripts\python.exe -m pytest -q
..\..\.venv\Scripts\python.exe -m ruff check --no-cache src tests
```

Expected: zero failures and zero lint errors.

- [ ] **Step 3: Run frontend tests, lint, and production build**

Run from repository root:

```powershell
npm test
npm run lint --workspace @paperpilot/web
npm run build
```

Expected: zero test failures, zero lint errors, and successful Next.js production build.

- [ ] **Step 4: Run Compose validation**

Run:

```powershell
docker compose config --quiet
```

Expected: exit code `0`.

- [ ] **Step 5: Run desktop and mobile E2E when local services are available**

Start the API and web servers using the repository commands, then run:

```powershell
npm run test:e2e
```

Expected: all desktop and mobile research-flow tests pass. If Docker, browser binaries, or local services are unavailable, report the exact command and failure without claiming E2E success.

- [ ] **Step 6: Review the final diff against the design**

Run:

```powershell
git diff --check
git status --short --branch
git diff --stat
```

Confirm no secrets, uploads, databases, caches, screenshots, build outputs, model outputs, or `.superpowers/` files are included. Do not stage or commit.
