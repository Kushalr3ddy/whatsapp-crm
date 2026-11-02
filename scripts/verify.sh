#!/usr/bin/env bash
# One command to prove the project works: static checks, unit + integration tests,
# a scripted no-real-send flow, and the browser suite against a throwaway fake-channel stack.
#
#   npm run verify              everything (about 10 minutes)
#   npm run verify -- --fast    typecheck, lint and vitest only (about 90 seconds)
#   npm run verify -- --no-e2e  skip the browser suite and the scripted flow
#
# Footprint: while it runs, memory used, load and inotify instances are sampled every 5 s. One summary line
# per run (with the peak of each stage) is appended to ./verify-footprint.log (git-ignored).
#
# Safety: the browser stage starts its OWN stack with GATEWAY_CHANNEL=fake, so nothing can reach
# WhatsApp. It refuses to run if something already listens on :3000 or :3001 (that could be a real
# gateway), so stop `npm run dev:all` first.
set -uo pipefail
cd "$(dirname "$0")/.."

FAST=0; E2E=1
for a in "$@"; do
  case "$a" in
    --fast) FAST=1; E2E=0 ;;
    --no-e2e) E2E=0 ;;
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    *) echo "unknown option: $a"; exit 2 ;;
  esac
done

LOG_DIR="${TMPDIR:-/tmp}/crm-verify-$(date +%H%M%S)"; mkdir -p "$LOG_DIR"
declare -a NAMES STATUS TIMES
STACK_PID=""

now() { date +%s; }

# ── footprint sampler ─────────────────────────────────────────────────────────────────────
# Samples every 5 s: "<stage>,<used MB>,<load1>,<inotify instances>". "Used" is total minus available,
# so page cache does not count. The inotify count covers this user's processes only (the system limit
# is fs.inotify.max_user_instances, which has run out on this machine before).
FP_CSV="$LOG_DIR/footprint.csv"; FP_STAGE="$LOG_DIR/.stage"; FP_PID=""
echo "setup" >"$FP_STAGE"
footprint_sampler() {
  while :; do
    local used load ino
    used=$(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{printf "%d",(t-a)/1024}' /proc/meminfo)
    load=$(cut -d' ' -f1 /proc/loadavg)
    ino=$(find /proc/[0-9]*/fd -lname 'anon_inode:inotify' 2>/dev/null | wc -l)
    echo "$(cat "$FP_STAGE" 2>/dev/null),$used,$load,$ino" >>"$FP_CSV"
    sleep 5
  done
}
footprint_sampler & FP_PID=$!

# Runs one stage, records pass/fail and how long it took; output goes to a per-stage log.
stage() {
  local name="$1"; shift
  local log="$LOG_DIR/$(echo "$name" | tr ' /' '__').log"
  printf '▶ %-34s' "$name"
  echo "$name" >"$FP_STAGE"
  local t0; t0=$(now)
  if "$@" >"$log" 2>&1; then
    local dt=$(( $(now) - t0 )); NAMES+=("$name"); STATUS+=("PASS"); TIMES+=("$dt")
    printf 'PASS  (%ss)\n' "$dt"
    return 0
  fi
  local dt=$(( $(now) - t0 )); NAMES+=("$name"); STATUS+=("FAIL"); TIMES+=("$dt")
  printf 'FAIL  (%ss)  → %s\n' "$dt" "$log"
  tail -n 15 "$log" | sed 's/^/      /'
  return 1
}

skip() { NAMES+=("$1"); STATUS+=("skip"); TIMES+=("-"); printf '▷ %-34sskipped\n' "$1"; }

stop_stack() {
  # dev-up.sh traps the interrupt and shuts the API, gateway and web down in order. Match it by
  # name rather than by pid: `setsid` may fork, so the pid we hold is not always the script's.
  [ -n "$STACK_PID" ] || return 0
  pkill -INT -f "infra/scripts/dev-up.sh" 2>/dev/null || true
  sleep 8
  pkill -TERM -f "tsx watch.*apps/(api|gateway)/src" 2>/dev/null || true
  pkill -TERM -f "next dev apps/web" 2>/dev/null || true
  STACK_PID=""
}
trap 'stop_stack; [ -n "$FP_PID" ] && kill "$FP_PID" 2>/dev/null' EXIT

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

wait_up() {
  local i; for i in $(seq 1 90); do
    curl -sf localhost:3000/ready >/dev/null 2>&1 && curl -sf localhost:3001/login >/dev/null 2>&1 && return 0
    sleep 2
  done; return 1
}

echo "crm verify — logs in $LOG_DIR"
echo

# ── 1 · static + unit + integration ────────────────────────────────────────────────────────
stage "database migrations (twice)" bash -c 'npm run db:migrate:all && npm run db:migrate:all'
stage "typecheck + lint + vitest" npm run check
stage "web typecheck" npm run typecheck:web

# ── 3 · the stack: scripted flow, then the browser suite ──────────────────────────────────
if [ "$E2E" = 1 ]; then
  if port_busy 3000 || port_busy 3001; then
    echo "✗ something is already listening on :3000 or :3001 (possibly a real gateway)."
    echo "  Stop it (Ctrl-C the dev:all terminal) and run again; not starting a second stack."
    NAMES+=("browser suite"); STATUS+=("FAIL"); TIMES+=("-")
  else
    stage "scripted flow (no real send)" npm run local:flow
    echo "  starting a throwaway fake-channel stack…"
    GATEWAY_CHANNEL=fake GATEWAY_SWEEP_SECONDS=3 \
      SEND_TYPING_SIMULATION=false SIGNUP_ENABLED=true \
      setsid npm run dev:all >"$LOG_DIR/stack.log" 2>&1 &
    STACK_PID=$!
    if wait_up; then
      stage "seed test org" npm run local:seed
      stage "browser suite (playwright)" npm run test:e2e
    else
      NAMES+=("browser suite"); STATUS+=("FAIL"); TIMES+=("-")
      echo "✗ the stack did not come up; see $LOG_DIR/stack.log"
    fi
    stop_stack
  fi
else
  skip "scripted flow (no real send)"; skip "browser suite (playwright)"
fi

# ── summary ───────────────────────────────────────────────────────────────────────────────
echo
echo "┌──────────────────────────────────────────────────────────────┐"
FAILED=0
for i in "${!NAMES[@]}"; do
  mark="✓"; [ "${STATUS[$i]}" = "FAIL" ] && { mark="✗"; FAILED=1; }; [ "${STATUS[$i]}" = "skip" ] && mark="·"
  printf '│ %s %-36s %-5s %8s │\n' "$mark" "${NAMES[$i]}" "${STATUS[$i]}" "${TIMES[$i]}s"
done
echo "└──────────────────────────────────────────────────────────────┘"
if [ "$FAILED" = 0 ]; then echo "ALL GOOD"; else echo "FAILED — logs: $LOG_DIR"; fi

# ── footprint report ──────────────────────────────────────────────────────────────────────
kill "$FP_PID" 2>/dev/null; FP_PID=""
if [ -s "$FP_CSV" ]; then
  FP_LOG="verify-footprint.log"
  read -r FP_N FP_PEAK FP_AVG FP_LOAD FP_INO < <(awk -F, '
    {n++; s+=$2; if($2>m)m=$2; if($3>l)l=$3; if($4>i)i=$4}
    END{printf "%d %d %d %.2f %d\n", n, m, s/n, l, i}' "$FP_CSV")
  FP_STAGES=$(awk -F, '{if($2>m[$1])m[$1]=$2} END{for(k in m)printf "%s=%dMB; ",k,m[k]}' "$FP_CSV")
  TOTAL_MB=$(awk '/MemTotal/{printf "%d",$2/1024}' /proc/meminfo)
  LINE="$(date '+%F %T') | $(git rev-parse --abbrev-ref HEAD) | $([ "$FAILED" = 0 ] && echo PASS || echo FAIL) | args: ${*:-none} | $FP_N samples | mem used peak ${FP_PEAK}/${TOTAL_MB} MB, avg ${FP_AVG} MB | load1 peak ${FP_LOAD} (${CORES:-$(nproc)} cores) | inotify peak ${FP_INO}/$(cat /proc/sys/fs/inotify/max_user_instances) | per stage peak: ${FP_STAGES}"
  echo "$LINE" >>"$FP_LOG"
  echo "footprint: mem peak ${FP_PEAK}/${TOTAL_MB} MB · load peak ${FP_LOAD} · inotify peak ${FP_INO} → $FP_LOG"
fi
exit "$FAILED"
