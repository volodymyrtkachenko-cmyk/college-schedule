#!/bin/sh
set -e

if [ "$1" = 'release' ]; then
    echo "Running migrations (release)..."
    alembic upgrade head
    echo "Importing educational process schedule (release)..."
    python scripts/import_eps.py
    exit 0
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "Running migrations..."
    alembic upgrade head
    echo "Importing educational process schedule..."
    python scripts/import_eps.py
fi

if [ $# -gt 0 ]; then
    exec "$@"
else
    echo "Starting server..."
    exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
fi
