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

# ── first-run secrets ────────────────────────────────────────────────────────────────────
# A fresh install should need no hand-made .env. Any secret not supplied by the environment is
# generated ONCE and kept in the state volume, then reused on every later start.
#
# Rule that must never be broken: a value that already exists is never regenerated. A new
# ENCRYPTION_KEY over a used database silently orphans every stored message and every linked
# number (docs/21-deferred.md, D-9). Supplying a different key than the one on file is refused
# for the same reason.
STATE_DIR=${STATE_DIR:-/app/state}
SECRETS_FILE="$STATE_DIR/secrets.env"
mkdir -p "$STATE_DIR"
touch "$SECRETS_FILE"; chmod 600 "$SECRETS_FILE"

for name in APP_SECRET API_KEY ENCRYPTION_KEY ENCRYPTION_INDEX_KEY; do
  on_file=$(sed -n "s/^${name}=//p" "$SECRETS_FILE" | head -n1)
  supplied=${!name:-}
  if [ -n "$supplied" ] && [ -n "$on_file" ] && [ "$supplied" != "$on_file" ]; then
    echo "entrypoint: $name differs from the one this install was created with ($SECRETS_FILE)." >&2
    echo "entrypoint: refusing to start: a different key would make stored data unreadable." >&2
    exit 1
  fi
  if [ -n "$supplied" ]; then value=$supplied
  elif [ -n "$on_file" ]; then value=$on_file
  else value=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
       echo "entrypoint: generated $name (stored in the state volume)"; fi
  [ -n "$on_file" ] || echo "${name}=${value}" >> "$SECRETS_FILE"
  export "$name=$value"
done

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

# ── first-run admin ──────────────────────────────────────────────────────────────────────
# Creates one organisation and its admin the first time only, so there is something to sign in
# to. The password is generated, printed once here, and kept in the state volume (mode 600).
if [ ! -f "$STATE_DIR/bootstrapped" ]; then
  ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
  if out=$("$TSX" scripts/admin.ts org --name "${ORG_NAME:-My Organisation}" \
        --slug "${ORG_SLUG:-my-org}" --email "$ADMIN_EMAIL" 2>&1); then
    echo "$out" | tee "$STATE_DIR/first-admin.txt"
    chmod 600 "$STATE_DIR/first-admin.txt"
    echo "entrypoint: sign in at the web UI as $ADMIN_EMAIL (password above, also in $STATE_DIR/first-admin.txt)"
  else
    echo "entrypoint: first-run admin was not created (an organisation may already exist):" >&2
    echo "$out" | tail -3 >&2
  fi
  touch "$STATE_DIR/bootstrapped"
fi

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
