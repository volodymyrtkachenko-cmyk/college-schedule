"""Deterministic canonical hashing and room normalization for schedule imports."""
import hashlib
import json


def normalize_room(value: str | None) -> str:
    """Normalize classroom labels for import diffing."""
    normalized = " ".join((value or "").casefold().split())
    for prefix in ("аудиторія ", "ауд. ", "ауд "):
        if normalized.startswith(prefix):
            return normalized[len(prefix):].strip()
    return normalized


def hash_payload(payload: dict) -> str:
    """Compute SHA-256 digest of a JSON-serializable payload."""
    serialized = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def import_payload_hash(payload: dict) -> str:
    """Compute a deterministic hash of an import draft payload ignoring order and metadata."""
    comparable = {
        key: value
        for key, value in payload.items()
        if key not in {"created_curriculum_ids", "import_scope", "auto_publish_skipped_reason"}
    }
    for key in ("base_slots", "substitutions", "cancelled"):
        values = comparable.get(key)
        if isinstance(values, list):
            if key in {"substitutions", "cancelled"}:
                values = [
                    {field: value for field, value in item.items() if field != "kind"}
                    if isinstance(item, dict) else item
                    for item in values
                ]
            comparable[key] = sorted(
                values,
                key=lambda value: json.dumps(value, sort_keys=True, default=str),
            )
    return hash_payload(comparable)


def canonical_change_records(
    substitutions: list[dict],
    cancelled: list[dict],
) -> list[dict]:
    """Canonicalize substitutions and cancellations into comparable change records."""
    records = [
        {
            "date": item["date"],
            "lesson_number": item["lesson_number"],
            "group_id": item["group_id"],
            "subject_id": item.get("subject_id"),
            "teacher_id": item.get("teacher_id"),
            "second_teacher_id": item.get("second_teacher_id"),
            "room": normalize_room(item.get("room")),
            "kind": "substitution",
        }
        for item in substitutions
    ]
    records.extend(
        {
            "date": item["date"],
            "lesson_number": item["lesson_number"],
            "group_id": item["group_id"],
            "subject_id": None,
            "teacher_id": None,
            "second_teacher_id": None,
            "room": None,
            "kind": "cancelled",
        }
        for item in cancelled
    )
    return sorted(
        records,
        key=lambda item: json.dumps(item, sort_keys=True, default=str),
    )


def import_changes_hash(payload: dict) -> str:
    """Hash canonicalized import changes for unchanged-payload detection."""
    if "changes" in payload:
        records = sorted(
            payload["changes"],
            key=lambda item: json.dumps(item, sort_keys=True, default=str),
        )
    else:
        records = canonical_change_records(
            payload.get("substitutions", []),
            payload.get("cancelled", []),
        )
    return hash_payload({"changes": records})
