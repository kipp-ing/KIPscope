#!/bin/sh
# Keeps the SSH tunnel to carserver's ClickHouse up (D-042): reconnects after drops,
# e.g. carserver's scheduled reboot at 23:00 local time.
#   scripts/tunnel.sh start    start the keeper in the background (log: $TMPDIR/letsview-tunnel.log)
#   scripts/tunnel.sh stop     stop the keeper and its ssh
#   scripts/tunnel.sh status   show whether the keeper runs and ClickHouse answers
#   scripts/tunnel.sh run      run the keeper in the foreground
# Host and ports: LETSVIEW_TUNNEL_HOST (default jan@192.168.42.207), local port 18123 -> remote 8123.
set -eu
HOST="${LETSVIEW_TUNNEL_HOST:-jan@192.168.42.207}"
LOCAL=18123
REMOTE=8123
RETRY_S=5
DIR="${TMPDIR:-/tmp}"
PIDFILE="$DIR/letsview-tunnel.pid"
LOG="$DIR/letsview-tunnel.log"

# Prints the keeper's PID. A PID file whose process is gone or is not the keeper
# (the PID was reused after a reboot) is stale: removed, so stop never signals a stranger.
keeper_pid() {
  [ -f "$PIDFILE" ] || return 1
  pid=$(cat "$PIDFILE")
  case "$pid" in '' | *[!0-9]*) rm -f "$PIDFILE"; return 1 ;; esac
  case "$(ps -o command= -p "$pid" 2>/dev/null)" in
    *"tunnel.sh run"*) echo "$pid" ;;
    *) rm -f "$PIDFILE"; return 1 ;;
  esac
}

run() {
  while :; do
    echo "$(date '+%F %T') connecting $HOST"
    # Alive checks drop a dead connection within ~45 s; ExitOnForwardFailure exits if the port is taken.
    ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ConnectTimeout=10 \
      -L "$LOCAL:localhost:$REMOTE" "$HOST" || true
    echo "$(date '+%F %T') tunnel down, retrying in ${RETRY_S} s"
    sleep "$RETRY_S"
  done
}

case "${1:-status}" in
  run) run ;;
  start)
    if pid=$(keeper_pid); then echo "already running (pid $pid)"; exit 0; fi
    if lsof -nP -tiTCP:$LOCAL -sTCP:LISTEN >/dev/null 2>&1; then
      echo "port $LOCAL is already taken (another tunnel?); not starting:" >&2
      lsof -nP -iTCP:$LOCAL -sTCP:LISTEN >&2
      exit 1
    fi
    nohup "$0" run >>"$LOG" 2>&1 &
    echo $! >"$PIDFILE"
    echo "started (pid $!), log $LOG"
    ;;
  stop)
    if pid=$(keeper_pid); then
      pkill -P "$pid" ssh 2>/dev/null || true
      kill "$pid"
      rm -f "$PIDFILE"
      echo "stopped"
    else
      echo "not running"
    fi
    ;;
  status)
    if pid=$(keeper_pid); then echo "keeper running (pid $pid)"; else echo "keeper not running"; fi
    if curl -s -m 3 -o /dev/null "http://localhost:$LOCAL/ping"; then echo "ClickHouse answers on $LOCAL"; else echo "ClickHouse not reachable on $LOCAL"; fi
    ;;
  *) echo "usage: $0 start|stop|status|run" >&2; exit 2 ;;
esac
