#!/bin/sh
set -eu

if [ "${1:-}" = "release" ]; then
    echo "Running migrations (release)..."
    exec alembic upgrade head
fi

# Міграції виконує лише release-owner.
# EPS/import запускаються окремою явною адміністративною операцією.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

echo "Starting server..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"

