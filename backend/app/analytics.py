import time
from fastapi import Request

# Simple in-memory tracker
# Maps IP address strings to their last seen unix timestamp
_active_users = {}
# Defines how long (in seconds) a user is considered "Online" after their last page load
ACTIVE_WINDOW = 300

def track_request(request: Request):
    # Cloudflare passes the real client IP here. Fallback to normal request.client.host
    ip = request.headers.get("cf-connecting-ip") or request.client.host
    if ip:
        _active_users[ip] = time.time()
        
def get_online_count() -> int:
    now = time.time()
    # Cleanup old entries and count
    expired = [ip for ip, last_seen in _active_users.items() if now - last_seen > ACTIVE_WINDOW]
    for ip in expired:
        del _active_users[ip]
    return len(_active_users)
