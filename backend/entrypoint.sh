#!/bin/sh
set -e

# If the command is 'release' (from Fly.io release_command)
if [ "$1" = 'release' ]; then
    echo "Running migrations (release)..."
    alembic upgrade head
    echo "Importing educational process schedule (release)..."
    python scripts/import_eps.py
    exit 0
fi

# If we are on Fly.io, we skip migrations in the main app machine
# because they are handled by the release_command above.
if [ -n "$FLY_REGION" ]; then
    echo "Running on Fly.io (Region: $FLY_REGION). Skipping migrations in main process."
    RUN_MIGRATIONS="false"
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "Running migrations (local)..."
    alembic upgrade head
    echo "Importing educational process schedule (local)..."
    python scripts/import_eps.py
fi

if [ $# -gt 0 ]; then
    exec "$@"
else
    echo "Starting server..."
    exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
fi
