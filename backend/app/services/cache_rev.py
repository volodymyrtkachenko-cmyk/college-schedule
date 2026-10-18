"""Process-local schedule revisions used for cache invalidation and HTTP ETags.

Revisions are bumped only *after* a successful commit (see
``app.models.bump_updated_at``), so readers can never re-cache pre-commit data.

* ``global_rev``  – entities that affect every group (versions, periods,
  subjects, teachers, groups, settings, bell times, bulk DML).
* ``group_rev``   – per-group data (lessons, overrides, imports, notes, events).
* ``any_rev``     – bumped on every change; used by teacher-scoped responses
  because a single group change can move a teacher.

The process runs a single uvicorn worker. If several Fly machines serve
traffic, each only sees its own writes, so ETags additionally embed a time
bucket (``ETAG_BUCKET_SECONDS``) that bounds cross-machine staleness, matching
the existing projection cache TTL semantics.
"""
from __future__ import annotations

import itertools
import time
from collections.abc import Iterable

ETAG_BUCKET_SECONDS = 60

_BOOT = format(int(time.time()), "x")
_counter = itertools.count(1)

global_rev = 0
any_rev = 0
group_rev: dict[int, int] = {}


def bump(groups: Iterable[int] = (), global_: bool = False) -> None:
    global global_rev, any_rev
    n = next(_counter)
    any_rev = n
    groups = [g for g in groups if g is not None]
    if global_ or not groups:
        global_rev = n
    for g in groups:
        group_rev[g] = n


def reset() -> None:
    """Test helper."""
    global global_rev, any_rev
    global_rev = 0
    any_rev = 0
    group_rev.clear()


def schedule_etag(*, group_id: int | None, teacher_id: int | None, variant: str) -> str:
    """Weak ETag for a public schedule response.

    ``variant`` must contain every request input that changes the body
    (resolved dates, include_cancelled, endpoint kind).
    """
    if group_id is not None:
        scope = f"g{group_id}.{global_rev}.{group_rev.get(group_id, 0)}"
    elif teacher_id is not None:
        scope = f"t{teacher_id}.{any_rev}"
    else:
        scope = f"all.{any_rev}"
    bucket = int(time.time() // ETAG_BUCKET_SECONDS)
    return f'W/"{_BOOT}-{format(bucket, "x")}-{scope}-{variant}"'


def etag_matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    if if_none_match.strip() == "*":
        return True
    candidates = {c.strip() for c in if_none_match.split(",")}
    # Weak comparison: ignore W/ prefix on both sides.
    bare = etag.removeprefix("W/")
    return any(c.removeprefix("W/") == bare for c in candidates)
