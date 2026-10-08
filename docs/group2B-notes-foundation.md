# Group 2B.1 — occurrence notes foundation

## Included
- Active key: group + calendar date + lesson number, independent of replaceable schedule IDs.
- Subject snapshot; the new subject never receives old text.
- Admin/editor group-scoped writes and history. Public schedule exposes only matching active text.
- Optimistic revision checks; stale writes fail with 409, no silent overwrite.
- Delete archives; immutable revision snapshots retain the text.
- Recurring-template PATCH moves matching regular notes within their original calendar week in the same transaction. Occupied destinations block the whole mutation.
- Subject/week changes archive matching regular notes. Imported/practice notes are not mistaken for regular notes.
- New migration follows the current head; it creates two tables, does not alter/delete existing data. Downgrade refuses implicit data loss.

## Explicitly not complete yet
- Date-only move semantics (current schedule PATCH still edits a recurring template).
- Reviewed notes/override mapping for import and generated publish, revision-bound preview, scoped schedule snapshots and rollback.
- Old deleted note text recovery: requires an older backup, not a new empty table.
- A manual subject override not represented by the existing projection is fail-closed for note creation.

The existing protected-publish guard remains enabled: once notes exist, destructive publish may return 409 until the next mapping package. Do not disable that guard.

## Release
The proposed Fly workflow gates deployment on backend tests (including PostgreSQL 18 migration/lock checks), frontend types and auth/note contract tests. The release script no longer re-imports educational process data unless IMPORT_EPS_ON_RELEASE=true is explicitly configured. This release opt-in is operational, not a replacement for authenticated admin import permissions.

A backend push to main starts verification, then deploys on Fly and runs release migrations only after checks pass. Obtain explicit release approval before pushing this migration. Smoke-test on an isolated PostgreSQL database first. Do not run the whole legacy Alembic chain on an empty DB as a rehearsal for production.
