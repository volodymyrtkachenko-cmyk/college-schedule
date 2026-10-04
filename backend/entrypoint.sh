#!/bin/sh
set -e

echo "Running migrations..."
alembic upgrade head

echo "Importing educational process schedule..."
python scripts/import_eps.py

echo "Starting server..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
