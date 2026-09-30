import time
from fastapi import Request

# Simple in-memory tracker
# Maps IP address strings to their last seen unix timestamp
_active_users = {}
# Defines how long (in seconds) a user is considered "Online" after their last page load
ACTIVE_WINDOW = 300

MAX_TRACKED_USERS = 5000

def track_request(request: Request):
    ip = request.client.host if request.client else "unknown"
    if ip:
        _active_users[ip] = time.time()
        # Prevent unbounded memory growth from IP spoofing attacks
        if len(_active_users) > MAX_TRACKED_USERS:
            # Drop the oldest entries
            sorted_ips = sorted(_active_users.items(), key=lambda x: x[1])
            # Remove the oldest 1000
            for k, _ in sorted_ips[:1000]:
                _active_users.pop(k, None)
        
def get_online_count() -> int:
    now = time.time()
    # Cleanup old entries and count
    expired = [ip for ip, last_seen in _active_users.items() if now - last_seen > ACTIVE_WINDOW]
    for ip in expired:
        del _active_users[ip]
    return len(_active_users)
