#!/usr/bin/env bash
# Runs the alpha compose file with whichever Compose is installed: the `docker compose` plugin
# (v2) or the older standalone `docker-compose` (v1). Both are given the same project name so
# volumes and containers are found again whichever one started them.
#
# Usage: compose.sh up -d --build | down | logs -f app | exec app ...
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if docker compose version >/dev/null 2>&1; then
  exec docker compose -p whatsapp-crm -f infra/compose/compose.yaml "$@"
elif command -v docker-compose >/dev/null 2>&1; then
  exec docker-compose -p whatsapp-crm -f infra/compose/compose.yaml "$@"
fi
echo "neither 'docker compose' nor 'docker-compose' is installed" >&2
exit 1
