#!/usr/bin/env bash
# Everything needed to poke at this locally, in one terminal.
#
# Starts the database, verifies the schema, then runs the three processes together and
# streams their logs prefixed by which one spoke. Ctrl-C stops all of them.
#
#   api      :3000   HTTP API
#   gateway  ----    owns the WhatsApp sockets. NOTHING SENDS OR RECEIVES WITHOUT THIS
#   web      :3001   the UI
#
# They are separate processes on purpose: restarting the API must never drop a WhatsApp
# socket, and `npm run dev` reloads on every file save (docs/04-architecture.md). This script
# only removes the need for three terminals — it does not merge them.
#
# Usage: dev-up.sh [--no-web] [--no-gateway]
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

WITH_WEB=1
WITH_GATEWAY=1
for arg in "$@"; do
  case "$arg" in
    --no-web)     WITH_WEB=0 ;;
    --no-gateway) WITH_GATEWAY=0 ;;
    *) echo "unknown option: $arg"; echo "usage: dev-up.sh [--no-web] [--no-gateway]"; exit 2 ;;
  esac
done

LOGS=".dev-logs"
mkdir -p "$LOGS"

# PIDs of everything we start, so shutdown kills exactly what this script launched and
# nothing else. Deliberately NOT `pkill -f`: the pattern matches the shell running it and
# kills this script mid-cleanup (exit 144). That has already cost time once.
PIDS=()

# ── shutdown ─────────────────────────────────────────────────────────────────────────────
# Runs on Ctrl-C, on error, and on normal exit. Each child is killed by PID, then given a
# moment to close its sockets — the gateway logs out of nothing, but an abrupt kill leaves
# `channel_session.connection_state` saying `open` when it is not, which this project has
# got wrong three times (HANDOFF.md).
cleanup() {
  local code=$?
  trap - INT TERM EXIT
  echo
  echo "stopping…"
  for pid in "${PIDS[@]:-}"; do
    [ -n "${pid:-}" ] && kill -TERM "-$pid" 2>/dev/null || true
  done
  sleep 2
  for pid in "${PIDS[@]:-}"; do
    [ -n "${pid:-}" ] && kill -KILL "-$pid" 2>/dev/null || true
  done
  echo "stopped. postgres is left running — 'npm run db:dev:down' if you want it down too."
  exit $code
}
trap cleanup INT TERM EXIT

# ── preflight ────────────────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "no .env — copy it and fill the five secrets:"
  echo "    cp .env.example .env"
  # Never 'cp' over an existing .env automatically: it destroys ENCRYPTION_KEY, and with it
  # every linked number and every stored message, permanently.
  exit 1
fi

for port in 3000 3001; do
  if ss -ltn 2>/dev/null | grep -q ":${port}\b"; then
    echo "port ${port} is already in use — something is still running from a previous session."
    echo "find it with:  ss -ltnp | grep ${port}"
    exit 1
  fi
done

bash infra/scripts/dev-db.sh up

echo "applying migrations…"
npm run db:migrate --silent

# ── start ────────────────────────────────────────────────────────────────────────────────
# setsid so each child leads its own process group and cleanup can signal the whole group;
# a bare kill would leave tsx's grandchild node process orphaned and holding the port.
start() {
  local name="$1"; shift
  setsid "$@" > "$LOGS/$name.log" 2>&1 &
  PIDS+=("$!")
  echo "  $name started (pid $!, log $LOGS/$name.log)"
}

echo
start api npm run dev

printf '  waiting for the api'
for _ in $(seq 1 60); do
  if curl -sf http://localhost:3000/health >/dev/null 2>&1; then echo ' — ready'; break; fi
  sleep 1
done

[ "$WITH_GATEWAY" = 1 ] && start gateway npm run gateway
[ "$WITH_WEB" = 1 ] && start web npm run web

if [ "$WITH_WEB" = 1 ]; then
  printf '  waiting for the web ui'
  for _ in $(seq 1 90); do
    if curl -sf http://localhost:3001/login >/dev/null 2>&1; then echo ' — ready'; break; fi
    sleep 1
  done
fi

# What the startup log said about row-level security. Worth surfacing rather than burying:
# if the connecting role bypasses RLS and no restricted role was available to drop to, the
# policies are enforcing nothing and only this line says so (docs/09-security.md).
echo
grep -h -m1 -E "tenant requests will run as a restricted role|row-level security is NOT enforced" \
  "$LOGS/api.log" 2>/dev/null \
  | sed -E 's/\x1b\[[0-9;]*m//g; s/^\[[^]]*\] [A-Z]+: //' \
  | sed 's/^/  rls: /' || true

cat <<BANNER

  api      http://localhost:3000/health
  web      http://localhost:3001/login
  logs     $LOGS/{api,gateway,web}.log

  Testing it by hand: docs/24-local-testing.md
  Ctrl-C stops everything this script started.

BANNER

# Stream all three logs, prefixed. `wait` alone would sit silently; this is the part that
# makes one terminal usable instead of merely possible.
tail -n 0 -F "$LOGS"/*.log 2>/dev/null | sed -u \
  -e "s|^==> $LOGS/\(.*\)\.log <==|--- \1 ---|" &
PIDS+=("$!")

wait
