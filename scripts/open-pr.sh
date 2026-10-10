#!/usr/bin/env bash
# Opens a pull request for the current branch against main, using the git credential already stored on
# this machine (the `gh` CLI is not installed). The token is read from `git credential fill` and never
# printed. Never pushes to main.
#
#   scripts/open-pr.sh "short title" path/to/body.md [base-branch]   (base defaults to main; use the
#   previous branch to stack a PR on one that is not merged yet)
set -euo pipefail

TITLE="${1:?usage: open-pr.sh \"title\" body-file}"
BODY_FILE="${2:?usage: open-pr.sh \"title\" body-file}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BASE="${3:-main}"
[ "$BRANCH" = "main" ] && { echo "refusing: you are on main — make a branch first" >&2; exit 1; }

REPO="$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
TOKEN="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')"
[ -n "$TOKEN" ] || { echo "no stored GitHub credential found" >&2; exit 1; }

git push -u origin "$BRANCH"

PAYLOAD="$(python3 - "$TITLE" "$BRANCH" "$BODY_FILE" "$BASE" <<'PY'
import json, sys
title, branch, body_file, base = sys.argv[1:5]
print(json.dumps({"title": title, "head": branch, "base": base, "body": open(body_file).read()}))
PY
)"
RESPONSE="$(curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/pulls" -d "$PAYLOAD")"
echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('html_url') or d)"
