import time
import hashlib
from fastapi import Request

# In-memory presence tracker
# Maps tab/session identifiers (sid:client_tab) to user presence info:
# {"last_seen": float, "role": str, "username": str, "name": str}
_active_users: dict[str, dict] = {}

# With a frontend ping interval of 15 seconds, a 35-second window
# provides instant detection while tolerating minor network latency.
ACTIVE_WINDOW = 35

MAX_TRACKED_USERS = 5000

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def track_request(request: Request):
    path = request.url.path
    if path in ("/api/health", "/api/metrics") or not path.startswith("/api/"):
        return

    # Check for session id from query param or header
    sid = request.query_params.get("sid") or request.headers.get("X-Session-Id")

    # Only track active user presence from /api/ping or requests explicitly tagged with sid.
    # We do NOT fallback to IP+UA for untagged requests because that causes duplicate
    # phantom entries alongside sid heartbeats and incorrectly collapses multiple users on the same Wi-Fi.
    if not sid and path != "/api/ping":
        return

    if not sid:
        ip = get_client_ip(request)
        ua = request.headers.get("user-agent", "unknown")
        sid = hashlib.md5(f"{ip}-{ua}".encode()).hexdigest()

    identifier = f"sid:{sid}"

    # If the user closes the tab/app, the frontend sends a leave beacon
    if request.query_params.get("leave") == "1":
        _active_users.pop(identifier, None)
        return

    role = request.query_params.get("role") or "guest"
    username = request.query_params.get("u") or ""
    name = request.query_params.get("n") or ""

    # Verify authorization if staff role (admin/editor) is reported
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]
        try:
            from app.core.security import decode_token
            payload = decode_token(token, expected_type="access")
            verified_role = payload.get("role")
            if verified_role:
                role = verified_role
        except Exception:
            pass
    elif role in ("admin", "editor"):
        token_param = request.query_params.get("token")
        if token_param:
            try:
                from app.core.security import decode_token
                payload = decode_token(token_param, expected_type="access")
                role = payload.get("role", "guest")
            except Exception:
                role = "guest"
        else:
            role = "guest"

    _active_users[identifier] = {
        "last_seen": time.time(),
        "role": role,
        "username": username,
        "name": name,
    }

    # Prevent unbounded memory growth
    if len(_active_users) > MAX_TRACKED_USERS:
        sorted_users = sorted(
            _active_users.items(),
            key=lambda x: x[1]["last_seen"] if isinstance(x[1], dict) else x[1]
        )
        for k, _ in sorted_users[:1000]:
            _active_users.pop(k, None)

_metrics = {
    "total_requests": 0,
    "error_count": 0,
    "total_latency_ms": 0.0,
    "last_successful_import": None,
    "active_jobs": 0
}

def record_request_metrics(duration_ms: float, is_error: bool):
    global _metrics
    _metrics["total_requests"] += 1
    _metrics["total_latency_ms"] += duration_ms
    if is_error:
        _metrics["error_count"] += 1

def record_successful_import():
    global _metrics
    _metrics["last_successful_import"] = time.time()

def set_active_jobs(count: int):
    global _metrics
    _metrics["active_jobs"] = count

def get_system_metrics() -> dict:
    now = time.time()

    # Expire inactive sessions
    expired = [
        k for k, v in _active_users.items()
        if (now - (v["last_seen"] if isinstance(v, dict) else v)) > ACTIVE_WINDOW
    ]
    for k in expired:
        _active_users.pop(k, None)

    # Group tabs by client_id to count distinct people/devices
    clients: dict[str, dict] = {}
    for k, v in _active_users.items():
        sid = k.removeprefix("sid:")
        client_id = sid.split("_")[0] if "_" in sid else sid

        if not isinstance(v, dict):
            entry = {"role": "guest", "username": "", "name": ""}
        else:
            entry = v

        if client_id not in clients:
            clients[client_id] = entry
        else:
            # Upgrade role if any active tab has elevated privileges
            cur_role = clients[client_id].get("role", "guest")
            new_role = entry.get("role", "guest")
            if new_role == "admin" or (new_role == "editor" and cur_role != "admin"):
                clients[client_id] = entry

    total = len(clients)
    guests = 0
    admins = 0
    editors = 0
    staff: list[dict] = []

    for c in clients.values():
        role = c.get("role", "guest")
        if role == "admin":
            admins += 1
            staff.append({
                "role": "admin",
                "username": c.get("username", ""),
                "name": c.get("name", "") or c.get("username", "Адміністратор"),
            })
        elif role == "editor":
            editors += 1
            staff.append({
                "role": "editor",
                "username": c.get("username", ""),
                "name": c.get("name", "") or c.get("username", "Редактор"),
            })
        else:
            guests += 1

    total_req = _metrics["total_requests"]
    err_rate = (_metrics["error_count"] / total_req) if total_req > 0 else 0
    avg_latency = (_metrics["total_latency_ms"] / total_req) if total_req > 0 else 0

    return {
        "online": total,
        "online_details": {
            "total": total,
            "guests": guests,
            "admins": admins,
            "editors": editors,
            "staff": staff,
        },
        "error_rate": err_rate,
        "avg_latency_ms": avg_latency,
        "last_successful_import": _metrics["last_successful_import"],
        "active_jobs": _metrics["active_jobs"],
    }

def get_online_count() -> int:
    return get_system_metrics()["online"]
