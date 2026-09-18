#!/usr/bin/env bash
# Local development database.
#
# Uses a NAMED DOCKER VOLUME, so data survives `docker stop`, a reboot, and removing the
# container. Two databases live inside it:
#   whatsapp_crm_dev   — your data. Linked WhatsApp numbers and their credentials live here,
#                        so wiping it means re-linking every number.
#   whatsapp_crm_test  — for the test suite, which truncates tables freely.
#
# Usage: dev-db.sh up | down | reset | psql | status
set -euo pipefail

CONTAINER=whatsapp-crm-dev-db
VOLUME=whatsapp-crm-dev-data
PORT=5434                 # 5433 is left free for the sibling JobPortal repo
PGUSER=dev
PGPASS=dev

case "${1:-up}" in
  up)
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
      echo "already running on port ${PORT}"; exit 0
    fi
    docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
    docker volume create "${VOLUME}" >/dev/null
    docker run -d --name "${CONTAINER}" \
      -e POSTGRES_USER="${PGUSER}" -e POSTGRES_PASSWORD="${PGPASS}" \
      -e POSTGRES_DB=whatsapp_crm_dev \
      -v "${VOLUME}:/var/lib/postgresql/data" \
      -p "${PORT}:5432" \
      --restart unless-stopped \
      postgres:16-alpine >/dev/null

    printf 'waiting for postgres'
    for _ in $(seq 1 60); do
      if docker exec "${CONTAINER}" pg_isready -U "${PGUSER}" >/dev/null 2>&1; then
        echo " ready"
        # Separate database for tests, so `npm test` can never truncate your real data.
        docker exec "${CONTAINER}" psql -U "${PGUSER}" -d postgres -tc \
          "SELECT 1 FROM pg_database WHERE datname='whatsapp_crm_test'" | grep -q 1 || \
          docker exec "${CONTAINER}" createdb -U "${PGUSER}" whatsapp_crm_test
        echo
        echo "  dev   postgresql://${PGUSER}:${PGPASS}@localhost:${PORT}/whatsapp_crm_dev"
        echo "  test  postgresql://${PGUSER}:${PGPASS}@localhost:${PORT}/whatsapp_crm_test"
        echo
        echo "  data persists in docker volume '${VOLUME}'"
        exit 0
      fi
      printf '.'; sleep 1
    done
    echo " timed out"; docker logs --tail 20 "${CONTAINER}"; exit 1
    ;;

  down)
    docker stop "${CONTAINER}" >/dev/null 2>&1 && echo "stopped — data kept in volume '${VOLUME}'"
    ;;

  reset)
    # Destructive and irreversible: this deletes the WhatsApp session credentials too, so every
    # linked number must be linked again afterwards.
    echo "This DELETES all local data, including linked WhatsApp numbers."
    read -r -p "Type 'reset' to confirm: " confirm
    [ "${confirm}" = "reset" ] || { echo "cancelled"; exit 1; }
    docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
    docker volume rm "${VOLUME}" >/dev/null 2>&1 || true
    echo "volume removed — run 'npm run db:dev:up && npm run db:migrate'"
    ;;

  psql)
    # Interactive prompt. An optional second argument picks the database.
    docker exec -it "${CONTAINER}" psql -U "${PGUSER}" -d "${2:-whatsapp_crm_dev}"
    ;;

  sql)
    # Runs a SQL FILE FROM THIS MACHINE. Piped over stdin rather than passed as `psql -f`,
    # because psql runs inside the container and cannot see paths on the host.
    [ -n "${2:-}" ] || { echo "usage: dev-db.sh sql <file.sql> [database]"; exit 1; }
    [ -f "$2" ] || { echo "no such file: $2"; exit 1; }
    docker exec -i "${CONTAINER}" psql -U "${PGUSER}" -d "${3:-whatsapp_crm_dev}" -f - < "$2"
    ;;

  query)
    # One-off query, for scripting: dev-db.sh query "SELECT count(*) FROM contact;"
    [ -n "${2:-}" ] || { echo 'usage: dev-db.sh query "SELECT ..." [database]'; exit 1; }
    docker exec -i "${CONTAINER}" psql -U "${PGUSER}" -d "${3:-whatsapp_crm_dev}" -c "$2"
    ;;

  status)
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
      echo "running on ${PORT}"
      docker exec "${CONTAINER}" psql -U "${PGUSER}" -d whatsapp_crm_dev -tc \
        "SELECT '  senders: '||count(*) FROM sender_identity" 2>/dev/null || true
      docker exec "${CONTAINER}" psql -U "${PGUSER}" -d whatsapp_crm_dev -tc \
        "SELECT '  messages: '||count(*) FROM message" 2>/dev/null || true
      docker volume inspect "${VOLUME}" --format '  volume: {{.Name}} at {{.Mountpoint}}' 2>/dev/null || true
    else
      echo "not running — 'npm run db:dev:up'"
    fi
    ;;

  *) echo "usage: dev-db.sh up|down|reset|status|psql [db]|sql <file> [db]|query \"SQL\" [db]"; exit 1 ;;
esac
