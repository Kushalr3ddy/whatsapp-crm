#!/usr/bin/env bash
# The regression run.   npm run regress        everything, on a PRODUCTION build of the web app (your machine)
#                       npm run regress:ci     the CI version: registry check + the @smoke browser tests + the speed probe, production build
# Needs the API and gateway already running (npm run dev:all --no-web, or the CI job's own start-up). Starts only the web app itself, as a
# production build on port 3101 (so it does not touch a dev server on 3001), and stops it again. Writes regression-report.md.
# Settings: REGRESS_STRICT_BUDGETS=1 makes a slow screen fail instead of warn.
set -uo pipefail
cd "$(dirname "$0")/.."
MODE=${1:-local}
OUT=test-results/regress; rm -rf "$OUT"; mkdir -p "$OUT"
FAIL=0
step() { echo; echo "== $1"; }

step "registry: every guarded bug has a test, every tagged test has a bug"
node tests/regression/check-registry.mjs || FAIL=1

if [ "$MODE" = local ]; then
  step "typecheck";      npm run -s typecheck && npm run -s typecheck:web || FAIL=1
  step "lint";           npm run -s lint || FAIL=1
  step "unit + integration tests"; npx vitest run --reporter=default --reporter=json --outputFile="$OUT/vitest.json" || FAIL=1
fi

step "API reachable?"
curl -sf http://localhost:3000/ready >/dev/null || curl -s -o /dev/null http://localhost:3000/api/v1/health || { echo "The API is not answering on :3000. Start it first: npm run dev:all -- --no-web"; exit 3; }

step "build the web app for production (NODE_ENV=production is forced: a .env that says development breaks the build)"
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 node --env-file-if-exists=.env node_modules/next/dist/bin/next build apps/web > "$OUT/web-build.log" 2>&1 || { tail -20 "$OUT/web-build.log"; exit 4; }
PORT=${REGRESS_WEB_PORT:-3101}
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 node --env-file-if-exists=.env node_modules/next/dist/bin/next start apps/web --port "$PORT" > "$OUT/web.log" 2>&1 &
WEB=$!
trap 'kill $WEB 2>/dev/null' EXIT
timeout 90 bash -c "until curl -sf http://localhost:$PORT/login >/dev/null; do sleep 1; done" || { echo "the production web server did not start"; tail -20 "$OUT/web.log"; exit 5; }

if [ "$MODE" = local ]; then GREP=(); else GREP=(--grep "@smoke|speed probe"); fi
step "browser tests on the production build ($([ "$MODE" = local ] && echo 'the whole suite' || echo 'smoke set + speed probe'))"
REGRESS=1 E2E_BASE_URL="http://localhost:$PORT" PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT/playwright.json" \
  npx playwright test --reporter=list,json "${GREP[@]}" || FAIL=1

step "report"
node tests/regression/report.mjs || FAIL=1
echo; echo "report: regression-report.md   ($([ $FAIL = 0 ] && echo PASSED || echo FAILED))"
exit $FAIL
