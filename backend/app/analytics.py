import time
import hashlib
from fastapi import Request

# Simple in-memory tracker
# Maps user identifiers (IP + User-Agent hash) to their last seen unix timestamp
_active_users = {}

# Since the frontend sends a ping every 30 seconds while visible,
# a window of 45 seconds is enough to consider them offline if they stop.
ACTIVE_WINDOW = 45

MAX_TRACKED_USERS = 5000

def get_client_ip(request: Request) -> str:
    # Uvicorn with --proxy-headers handles X-Forwarded-For, but just in case
    # it's misconfigured or behind multiple proxies:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def track_request(request: Request):
    # Ignore health checks, metrics, and static files if any
    path = request.url.path
    if path in ("/api/health", "/api/metrics") or not path.startswith("/api/"):
        return

    # Use explicitly provided session-id from heartbeat (sid)
    # If not present, fallback to IP+UA hash
    sid = request.query_params.get("sid")
    if sid:
        identifier = f"sid:{sid}"
    else:
        ip = get_client_ip(request)
        ua = request.headers.get("user-agent", "unknown")
        identifier = hashlib.md5(f"{ip}-{ua}".encode()).hexdigest()

    # If the user closes the tab/app, the frontend sends a leave beacon
    if request.query_params.get("leave") == "1":
        _active_users.pop(identifier, None)
        return

    _active_users[identifier] = time.time()
    
    # Prevent unbounded memory growth from attacks
    if len(_active_users) > MAX_TRACKED_USERS:
        # Drop the oldest entries
        sorted_ips = sorted(_active_users.items(), key=lambda x: x[1])
        # Remove the oldest 1000
        for k, _ in sorted_ips[:1000]:
            _active_users.pop(k, None)

def get_online_count() -> int:
    now = time.time()
    # Cleanup old entries and count
    expired = [key for key, last_seen in _active_users.items() if now - last_seen > ACTIVE_WINDOW]
    for key in expired:
        del _active_users[key]
    return len(_active_users)

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
    total = _metrics["total_requests"]
    err_rate = (_metrics["error_count"] / total) if total > 0 else 0
    avg_latency = (_metrics["total_latency_ms"] / total) if total > 0 else 0
    return {
        "online": get_online_count(),
        "error_rate": err_rate,
        "avg_latency_ms": avg_latency,
        "last_successful_import": _metrics["last_successful_import"],
        "active_jobs": _metrics["active_jobs"]
    }
