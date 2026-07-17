from paperpilot.models.deepseek import (
    ModelProviderError,
    ModelResponseError,
    TransientModelProviderError,
)
from paperpilot.tasks import should_retry_model_error


def test_only_transient_model_failures_are_retried() -> None:
    assert should_retry_model_error(TransientModelProviderError("temporary")) is True
    assert should_retry_model_error(ModelProviderError("permanent")) is False
    assert should_retry_model_error(ModelResponseError("invalid response")) is False
    assert should_retry_model_error(ValueError("invalid synthesis")) is False
