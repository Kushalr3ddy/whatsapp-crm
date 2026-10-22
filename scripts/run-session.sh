#!/usr/bin/env bash
# Runs the timed, recorded session audit (tests/live/session-audit.live.ts) with a resource monitor beside it.
#
#   scripts/run-session.sh dry <csv>      against the e2e test organisation (e2e@test.local), whatever channel the running stack uses
#   scripts/run-session.sh real <csv>     against the hiring-studios organisation with the lowercase `email` / `password` lines of .env, sending as kushal_test
#
# Settings come from .env (never printed). Runs at normal priority, in a visible Chromium, recorded, with no slow-motion. Output: test-results/session-<mode>-<time>/
set -uo pipefail
cd "$(dirname "$0")/.."
MODE=${1:-dry}; CSV=${2:-}
[ -n "$CSV" ] || { echo "usage: $0 dry|real <csv file>"; exit 2; }
getenv() { sed -n "s/^$1=//p" .env | head -n1 | sed -e 's/^"//' -e 's/"$//'; }
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$PWD/test-results/session-$MODE-$STAMP"; mkdir -p "$OUT"

if [ "$MODE" = real ]; then
  export SESSION_EMAIL=$(getenv email) SESSION_PASSWORD=$(getenv password) SESSION_SENDER=kushal_test
else
  export SESSION_EMAIL=$(getenv TEST_EMAIL) SESSION_PASSWORD=$(getenv TEST_PASSWORD) SESSION_SENDER="Seed number"
fi
export SESSION_MODEL_KEY=$(getenv GROQ_API_KEY); [ -n "$SESSION_MODEL_KEY" ] || export SESSION_MODEL_KEY=$(getenv LLM_API_KEY)
export LIVE_SEND_TO=$(getenv LIVE_SEND_TO)
export SESSION_CSV="$CSV" SESSION_OUT="$OUT" SESSION_IMPORT_TAG="session-import-$MODE-$STAMP"
export LIVE_VIDEO=1 LIVE_SLOWMO=0

node tests/live/resmon.mjs "$OUT/resources.csv" & MON=$!
npx playwright test -c playwright.live.config.ts tests/live/session-audit.live.ts --output "$OUT/pw" 2>&1 | tee "$OUT/run.log"
kill -TERM $MON 2>/dev/null; wait $MON 2>/dev/null
V=$(find "$OUT/pw" -name 'video.webm' | head -n1); [ -n "$V" ] && cp "$V" "$OUT/session.webm"
[ -f "$OUT/steps.jsonl" ] && node tests/live/session-report.mjs "$OUT"
echo "OUT=$OUT"
