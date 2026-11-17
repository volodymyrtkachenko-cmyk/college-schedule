"""Shared rate-limiting configuration and proxy-safe client IP resolution."""
import os
from fastapi import Request
from slowapi import Limiter


def get_real_client_ip(request: Request) -> str:
    """
    Resolve client IP safely without trusting spoofed X-Forwarded-For headers from arbitrary clients.
    When running behind Heroku router (DYNO set) or explicitly trusted proxy ips, takes the
    rightmost (proxy-appended) address from X-Forwarded-For; otherwise uses the socket peer address.
    """
    peer_ip = request.client.host if request.client and request.client.host else "127.0.0.1"
    allowed_raw = os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1").strip()
    trust_proxy = (
        allowed_raw == "*"
        or bool(os.environ.get("DYNO"))
        or peer_ip in {ip.strip() for ip in allowed_raw.split(",") if ip.strip()}
    )
    if trust_proxy:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            if parts:
                return parts[-1]
    return peer_ip


limiter = Limiter(key_func=get_real_client_ip)
