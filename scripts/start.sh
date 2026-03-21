#!/bin/sh
set -e

echo "[Start] Running database migrations..."
node dist/db/migrate.js

echo "[Start] Starting 1ClickSync server..."
exec node dist/server.js
