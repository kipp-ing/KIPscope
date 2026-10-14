#!/bin/sh
# Restarts the letsview dev server on port 7310.
# Stops only a node process running src/main.ts; anything else on the port aborts (Docker Desktop owns forwarded ports).
set -eu
cd "$(dirname "$0")/.."
PORT=7310
LOG="${TMPDIR:-/tmp}/letsview-server.log"

for pid in $(lsof -nP -tiTCP:$PORT -sTCP:LISTEN || true); do
  cmd=$(ps -o command= -p "$pid")
  case "$cmd" in
    *node*src/main.ts*) kill "$pid" ;;
    *) echo "port $PORT is held by something else, not touching it: $cmd" >&2; exit 1 ;;
  esac
done

i=0
while lsof -nP -tiTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 50 ] && { echo "port $PORT still busy after 5 s" >&2; exit 1; }
  sleep 0.1
done

cd apps/server
nohup node --env-file-if-exists=../../.env --watch src/main.ts >"$LOG" 2>&1 &
echo "server started, pid $!, log $LOG"

i=0
until curl -sf "http://localhost:$PORT/api/workspace" >/dev/null; do
  i=$((i + 1))
  [ "$i" -gt 100 ] && { echo "server not answering after 10 s, see $LOG" >&2; exit 1; }
  sleep 0.1
done
echo "server answers on $PORT"
