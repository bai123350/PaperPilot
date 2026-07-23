import pytest
from sse_starlette.sse import AppStatus


@pytest.fixture(autouse=True)
def reset_sse_starlette_app_status() -> None:
    """Keep sse-starlette's module-level exit event inside one TestClient loop."""
    AppStatus.should_exit = False
    AppStatus.should_exit_event = None
    yield
    AppStatus.should_exit = False
    AppStatus.should_exit_event = None
