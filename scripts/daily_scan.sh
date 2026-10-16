#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# daily_scan.sh — runs at 21:00 daily via launchd (see setup_wake.sh).
#
# 1. ensures the Homework Hub server is up (best effort),
# 2. runs the real Teams scanner (scan_teams.mjs) against the logged-in
#    browser session, which upserts assignments into data/assignments.json,
# 3. logs everything to data/logs/daily_scan.log.
#
# NOTE: requires the OpenClaw browser profile to be running with Teams logged
# in (CDP on :18800). If Teams is not open the scanner exits non-zero and the
# previous data is left untouched.
# ---------------------------------------------------------------------------
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
LOGS="$ROOT/data/logs"
mkdir -p "$LOGS"

LOG="$LOGS/daily_scan.log"
TS="$(date '+%Y-%m-%dT%H:%M:%S%z')"
API="${HOMEWORK_HUB_API:-http://127.0.0.1:8787}"

log() { printf '[%s] %s\n' "$TS" "$*" | tee -a "$LOG"; }

log "daily scan start"

# 1. Server up? (start if needed)
if ! curl -s --max-time 3 "$API/api/health" >/dev/null 2>&1; then
  log "server not responding — starting it"
  ( cd "$ROOT" && PORT=8787 nohup node server/server.js >>"$LOGS/server.log" 2>&1 & )
  sleep 2
fi
HEALTH="$(curl -s --max-time 3 "$API/api/health" || true)"
log "server health: ${HEALTH:-<unreachable>}"

# 2. Real Teams scan
if command -v node >/dev/null 2>&1; then
  SCAN_OUT="$(node "$HERE/scan_teams.mjs" 2>&1)"
  RC=$?
  printf '%s\n' "$SCAN_OUT" >> "$LOG"
  log "scan exit=${RC}"
else
  log "node not found — cannot scan"
fi

# 3. Summary counts
if [ -f "$ROOT/data/assignments.json" ]; then
  COUNTS="$(python3 - "$ROOT/data/assignments.json" <<'PY' 2>/dev/null || true
import json,sys,collections
d=json.load(open(sys.argv[1]))
c=collections.Counter(a.get('status') for a in d['assignments'])
print('total',len(d['assignments']),dict(c))
PY
)"
  log "counts: ${COUNTS:-<n/a>}"
fi

log "daily scan done"
exit 0
