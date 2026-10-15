import pytest
from app.services.settings import settings_service
from app.routers.schedule import invalidate_bell_cache

@pytest.fixture(autouse=True)
def reset_in_memory_caches():
    settings_service.clear_cache()
    invalidate_bell_cache()
    yield
    settings_service.clear_cache()
    invalidate_bell_cache()
