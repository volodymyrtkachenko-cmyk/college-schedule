import time
import hashlib
from fastapi import Request

# Simple in-memory tracker
# Maps user identifiers (IP + User-Agent hash) to their last seen unix timestamp
_active_users = {}
# Defines how long (in seconds) a user is considered "Online" after their last page load
ACTIVE_WINDOW = 300

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

    ip = get_client_ip(request)
    ua = request.headers.get("user-agent", "unknown")
    
    # Use a hash of IP + User-Agent to differentiate multiple users behind the same NAT (e.g. college Wi-Fi)
    identifier = hashlib.md5(f"{ip}-{ua}".encode()).hexdigest()

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
