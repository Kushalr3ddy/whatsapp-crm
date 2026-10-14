#!/usr/bin/env bash
# Supervisor for the alpha monolith container: migrate, then run the API, the gateway and the
# web UI as three processes, and take the whole container down if any one of them dies so the
# restart policy brings back a consistent set. (A half-alive container, say a web UI with no
# gateway, is worse than a restart: nothing would send and nothing would say why.)
#
#   api      :3000   HTTP API
#   gateway  ----    owns the WhatsApp sockets; nothing sends or receives without it
#   web      :3001   the UI
set -euo pipefail

cd /app
TSX=/app/node_modules/.bin/tsx
NEXT=/app/node_modules/next/dist/bin/next

PIDS=()

# On SIGTERM (docker stop) or when a child exits: stop everything, politely first. The gateway
# gets a moment to close its sockets so `channel_session.connection_state` is not left `open`.
shutdown() {
  trap - TERM INT
  for pid in "${PIDS[@]:-}"; do kill -TERM "$pid" 2>/dev/null || true; done
  sleep 3
  for pid in "${PIDS[@]:-}"; do kill -KILL "$pid" 2>/dev/null || true; done
}
trap 'shutdown; exit 143' TERM INT

# Migrations run before anything listens, and a failure stops the container (M5, M6). The
# database may still be starting, so retry for a while before giving up.
echo "entrypoint: applying migrations"
for attempt in $(seq 1 30); do
  if "$TSX" packages/db/src/migrate.ts; then break; fi
  if [ "$attempt" = 30 ]; then echo "entrypoint: migrations failed, giving up" >&2; exit 1; fi
  echo "entrypoint: database not ready (attempt $attempt), retrying in 2s"; sleep 2
done

echo "entrypoint: starting api"
"$TSX" apps/api/src/server.ts & PIDS+=($!)

# The gateway checks the schema itself, but waiting for the API first keeps the logs readable
# and means a config error shows once rather than three times.
for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then break; fi
  sleep 1
done

echo "entrypoint: starting gateway"
"$TSX" apps/gateway/src/main.ts & PIDS+=($!)

echo "entrypoint: starting web"
node "$NEXT" start apps/web --port 3001 & PIDS+=($!)

# Returns as soon as ANY child exits; its status becomes ours, so docker sees the failure.
set +e
wait -n
code=$?
echo "entrypoint: a process exited (status $code), stopping the container" >&2
shutdown
exit "$code"
