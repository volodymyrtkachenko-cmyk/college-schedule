import pytest
from app.services.settings import settings_service
from app.services.projection import invalidate_projection_cache
from app.routers.schedule import invalidate_bell_cache
from app.routers import classroom as classroom_router


def _reset():
    settings_service.clear_cache()
    invalidate_bell_cache()
    invalidate_projection_cache()
    classroom_router._last_request_trigger.clear()


@pytest.fixture(autouse=True)
def reset_in_memory_caches():
    _reset()
    yield
    _reset()
