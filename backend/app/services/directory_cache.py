"""Shared in-memory directory cache and invalidation helper."""
from typing import Any

_DIR_CACHE: dict[tuple[Any, int], Any] = {}


def invalidate_directory_cache() -> None:
    """Clear the cached directory entries."""
    _DIR_CACHE.clear()
