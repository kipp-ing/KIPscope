#!/usr/bin/env bash
# Runs KIPscope on the demo recording (README "Demo"): server on 7320 and UI on 5183, so a dev
# server on 7310/5173 keeps running. Needs `docker compose up -d` and `pnpm --filter @kipscope/server
# seed:demo` once. Workspace and views of the demo live in .kipscope-demo/. Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PORT="${DEMO_SERVER_PORT:-7320}"
UI_PORT="${DEMO_UI_PORT:-5183}"

export KIPSCOPE_SOURCE=clickhouse
export KIPSCOPE_PORT="$SERVER_PORT"
export CLICKHOUSE_URL="${DEMO_CLICKHOUSE_URL:-http://localhost:8124}"
export CLICKHOUSE_USER="${DEMO_CLICKHOUSE_USER:-kipscope}"
export CLICKHOUSE_PASSWORD="${DEMO_CLICKHOUSE_PASSWORD:-kipscope}"
export CLICKHOUSE_DATABASE=demo
export KIPSCOPE_DBC_FILES=demo/smart-ed.dbc
export KIPSCOPE_DIAG_CATALOGS=, # none
export KIPSCOPE_PROJECT_FILE=demo/kipscope.yaml
export KIPSCOPE_STATE_DIR=.kipscope-demo

trap 'kill 0' EXIT
(cd "$ROOT/apps/server" && node src/main.ts) &
(cd "$ROOT/apps/web" && KIPSCOPE_SERVER_URL="http://127.0.0.1:$SERVER_PORT" \
  node node_modules/vite/bin/vite.js --port "$UI_PORT" --strictPort) &
echo "KIPscope demo: http://localhost:$UI_PORT/ (server http://127.0.0.1:$SERVER_PORT)"
wait
