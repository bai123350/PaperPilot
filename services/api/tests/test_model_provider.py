import json

import httpx
import pytest
from openai import AsyncOpenAI
from paperpilot.config import Settings
from paperpilot.domain.models import EvidenceRecord, Paper, ResearchBrief
from paperpilot.models.deepseek import (
    DeepSeekModel,
    ModelProviderError,
    ModelResponseError,
    TransientModelProviderError,
)
from paperpilot.models.provider import create_model_client
from paperpilot.services.llm_synthesis import LlmReportSynthesizer


def deepseek_model(handler, base_url: str = "https://api.deepseek.com") -> DeepSeekModel:
    sdk_client = AsyncOpenAI(
        api_key="secret",
        base_url=base_url,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    return DeepSeekModel(
        api_key="secret",
        base_url=base_url,
        client=sdk_client,
    )


@pytest.mark.parametrize(
    "content",
    [
        '{"summary": "Grounded"}',
        '```json\n{"summary": "Grounded"}\n```',
        'Result:\n```json\n{"summary": "Grounded"}\n```\nDone.',
    ],
)
async def test_deepseek_model_sends_expected_request_and_parses_json(content: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://gateway.example/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer secret"
        payload = json.loads(request.content)
        assert payload["model"] == "deepseek-v4-pro"
        assert payload["temperature"] == 0.1
        assert payload["max_tokens"] == 8192
        assert payload["stream"] is False
        assert payload["reasoning_effort"] == "high"
        assert payload["thinking"] == {"type": "enabled"}
        assert payload["response_format"] == {"type": "json_object"}
        assert "中文证据" in payload["messages"][1]["content"]
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    model = deepseek_model(handler, "https://gateway.example/v1/")

    assert await model.complete_json("Return JSON", {"evidence": ["中文证据"]}) == {
        "summary": "Grounded"
    }


async def test_deepseek_model_retries_one_truncated_json_response() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        content = '{"summary":' if calls == 1 else '{"summary": "Recovered"}'
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    model = deepseek_model(handler)

    assert await model.complete_json("Return JSON", {}) == {"summary": "Recovered"}
    assert calls == 2


async def test_deepseek_model_sends_conversation_and_returns_text() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["temperature"] == 0.2
        assert payload["stream"] is False
        assert payload["messages"] == [
            {"role": "system", "content": "Refine the question"},
            {"role": "user", "content": "范围是否太宽？"},
        ]
        assert "response_format" not in payload
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "  建议明确主要结局。  "}}]},
        )

    model = deepseek_model(handler)

    reply = await model.complete_text(
        "Refine the question",
        [{"role": "user", "content": "范围是否太宽？"}],
    )

    assert reply == "建议明确主要结局。"


async def test_deepseek_model_streams_text_deltas() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["stream"] is True
        chunks = (
            'data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, text=chunks, headers={"content-type": "text/event-stream"})

    model = deepseek_model(handler)

    parts = [part async for part in model.stream_text(
        "Continue the research", [{"role": "user", "content": "继续讨论"}]
    )]

    assert parts == ["第一段", "第二段"]


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (httpx.Response(200, json={}), "invalid response envelope"),
        (
            httpx.Response(200, json={"choices": [{"message": {"content": "not-json"}}]}),
            "invalid JSON",
        ),
        (
            httpx.Response(200, json={"choices": [{"message": {"content": "[]"}}]}),
            "JSON object",
        ),
    ],
)
async def test_deepseek_model_rejects_invalid_responses(
    response: httpx.Response, message: str
) -> None:
    model = deepseek_model(lambda _: response)

    with pytest.raises(ModelResponseError, match=message):
        await model.complete_json("Return JSON", {})


@pytest.mark.parametrize("status_code", [429, 500, 503])
async def test_deepseek_model_marks_retryable_http_errors(status_code: int) -> None:
    model = deepseek_model(lambda _: httpx.Response(status_code, text="private provider response"))

    with pytest.raises(TransientModelProviderError, match="temporarily unavailable") as caught:
        await model.complete_json("Return JSON", {})

    assert "private provider response" not in str(caught.value)


@pytest.mark.parametrize("status_code", [400, 401, 403])
async def test_deepseek_model_marks_permanent_http_errors(status_code: int) -> None:
    model = deepseek_model(lambda _: httpx.Response(status_code, text="private provider response"))

    with pytest.raises(ModelProviderError, match=f"HTTP {status_code}") as caught:
        await model.complete_json("Return JSON", {})

    assert not isinstance(caught.value, TransientModelProviderError)
    assert "private provider response" not in str(caught.value)


def test_deepseek_configuration_defaults_and_custom_gateway() -> None:
    settings = Settings(demo_mode=False, deepseek_api_key="secret")
    custom = Settings(
        demo_mode=False,
        deepseek_api_key="secret",
        deepseek_base_url="https://gateway.example/v1",
    )

    assert settings.deepseek_base_url == "https://api.deepseek.com"
    assert settings.deepseek_model == "deepseek-v4-pro"
    assert custom.deepseek_base_url == "https://gateway.example/v1"


@pytest.mark.parametrize(
    ("selected", "key_field", "key", "expected_url", "expected_provider"),
    [
        ("deepseek-v4-flash", "deepseek_api_key", "deepseek-key", "https://api.deepseek.com", "deepseek"),
        ("gpt-5-mini", "openai_api_key", "openai-key", "https://api.openai.com/v1", "openai"),
        (
            "qwen-plus",
            "qwen_api_key",
            "qwen-key",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "qwen",
        ),
    ],
)
def test_model_factory_routes_supported_models_to_their_provider(
    selected: str,
    key_field: str,
    key: str,
    expected_url: str,
    expected_provider: str,
) -> None:
    model = create_model_client(Settings(**{key_field: key}), selected)  # type: ignore[arg-type]

    assert model.model == selected
    assert model.base_url == expected_url
    assert model.provider == expected_provider


def test_live_mode_is_default_and_credentials_can_be_configured_per_user() -> None:
    assert Settings(_env_file=None).demo_mode is False
    assert Settings(demo_mode=False, deepseek_api_key=None).deepseek_api_key is None
    assert Settings(demo_mode=True, deepseek_api_key=None).deepseek_api_key is None

    with pytest.raises(ModelProviderError, match="not configured"):
        create_model_client(Settings(demo_mode=False), "deepseek-v4-pro")


class InvalidEvidenceModel:
    async def complete_json(self, system_prompt: str, payload: dict) -> dict:
        evidence_id = payload["evidence"][0]["id"]
        recommendation = {
            "title": "External validation",
            "rationale": "The evidence requires independent external validation.",
            "hypothesis": "The observed association persists in another cohort.",
            "minimal_validation": "Evaluate the locked analysis in an independent cohort.",
            "resources": ["Independent cohort"],
            "risks": ["Selection bias"],
            "stop_condition": "Stop when discrimination is below 0.65.",
            "evidence_ids": [evidence_id],
        }
        return {
            "summary": "A sufficiently detailed evidence-grounded summary.",
            "themes": ["Validation"],
            "claims": [
                {"statement": "A sufficiently detailed supported claim.", "evidence_ids": ["unknown"]}
            ],
            "controversies": [],
            "gaps": ["External validation is limited."],
            "recommendations": [recommendation, recommendation, recommendation],
        }


def evidence_fixture() -> EvidenceRecord:
    return EvidenceRecord(
        id="allowed",
        paper_id="paper-1",
        excerpt="An external cohort confirmed the direction of the observed association.",
        locator="Abstract",
        evidence_type="result",
        confidence=0.8,
    )


async def test_synthesizer_rejects_model_citations_outside_the_evidence_set() -> None:
    evidence = evidence_fixture()
    synthesizer = LlmReportSynthesizer(InvalidEvidenceModel())

    with pytest.raises(ModelResponseError, match="outside the current research run"):
        await synthesizer.synthesize(
            ResearchBrief(question="What evidence supports external biomarker validation?"),
            [Paper(id="paper-1", title="External validation", abstract=evidence.excerpt, source="test")],
            [evidence],
        )


class InvalidPayloadModel:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    async def complete_json(self, system_prompt: str, payload: dict) -> dict:
        return self.payload


class CorrectingPayloadModel:
    def __init__(self, evidence_id: str) -> None:
        self.evidence_id = evidence_id
        self.calls: list[tuple[str, dict]] = []

    async def complete_json(self, system_prompt: str, payload: dict) -> dict:
        self.calls.append((system_prompt, payload))
        if len(self.calls) == 1:
            return {"summary": "too short"}
        recommendation = {
            "title": "Independent external validation",
            "rationale": "The current evidence base requires independent external validation.",
            "hypothesis": "The reported association persists in an independent cohort.",
            "minimal_validation": "Evaluate the locked analysis in an independent prospective cohort.",
            "resources": ["Independent cohort"],
            "risks": ["Selection bias"],
            "stop_condition": "Stop when discrimination is below 0.65.",
            "evidence_ids": [self.evidence_id],
        }
        return {
            "summary": "A corrected and sufficiently detailed evidence-grounded synthesis.",
            "themes": ["External validation"],
            "claims": [
                {
                    "statement": "The evidence supports further independent validation.",
                    "evidence_ids": [self.evidence_id],
                }
            ],
            "controversies": ["Validation methods differ between studies."],
            "gaps": ["Independent prospective validation remains limited."],
            "recommendations": [recommendation, recommendation, recommendation],
        }


async def test_synthesizer_corrects_one_invalid_structured_response() -> None:
    evidence = evidence_fixture()
    model = CorrectingPayloadModel(evidence.id)
    synthesizer = LlmReportSynthesizer(model)

    result = await synthesizer.synthesize(
        ResearchBrief(question="What evidence supports external biomarker validation?"),
        [Paper(id="paper-1", title="External validation", abstract=evidence.excerpt, source="test")],
        [evidence],
    )

    assert len(result["recommendations"]) == 3
    assert len(model.calls) == 2
    assert "output_schema" in model.calls[0][1]
    assert model.calls[1][1]["validation_errors"]
    assert "too short" not in json.dumps(model.calls[1][1])


@pytest.mark.parametrize(
    "payload",
    [
        {
            "summary": "A sufficiently detailed evidence-grounded summary.",
            "themes": [],
            "claims": [],
            "controversies": [],
            "gaps": ["Validation is missing."],
            "recommendations": [],
        },
        {
            "summary": "A sufficiently detailed evidence-grounded summary.",
            "themes": [],
            "claims": [{"statement": "A supported finding has been reported.", "evidence_ids": []}],
            "controversies": [],
            "gaps": ["Validation is missing."],
            "recommendations": [],
        },
    ],
)
async def test_synthesizer_rejects_invalid_claims_and_recommendation_count(payload: dict) -> None:
    evidence = evidence_fixture()
    synthesizer = LlmReportSynthesizer(InvalidPayloadModel(payload))

    with pytest.raises(ModelResponseError, match="invalid synthesis payload"):
        await synthesizer.synthesize(
            ResearchBrief(question="What evidence supports external biomarker validation?"),
            [Paper(id="paper-1", title="External validation", abstract=evidence.excerpt, source="test")],
            [evidence],
        )
