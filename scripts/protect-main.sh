#!/usr/bin/env bash
# Protects `main`: a pull request cannot merge until the required checks pass, and force-pushes / deletion are refused. Also allows auto-merge
# (for PRs labelled `automerge`). This changes REPOSITORY SETTINGS on GitHub, so it needs admin rights and is run once, by hand, on purpose.
#   bash scripts/protect-main.sh          shows what it would do and asks
#   bash scripts/protect-main.sh --yes    does it
# Undo: gh api -X DELETE repos/OWNER/REPO/branches/main/protection
set -euo pipefail
REPO=${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
CHECKS='["check","e2e","secrets-scan","regress-smoke","bug-gate"]'
echo "Repository: $REPO"
echo "Required checks before merging into main: $CHECKS"
echo "Also: branches must be up to date is OFF (so stacked PRs merge in order); admins are NOT exempt; force-push and deletion refused; auto-merge allowed."
if [ "${1:-}" != "--yes" ]; then read -r -p "Apply? type yes: " a; [ "$a" = yes ] || { echo cancelled; exit 1; }; fi
gh api -X PATCH "repos/$REPO" -f allow_auto_merge=true -f delete_branch_on_merge=true >/dev/null
gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<JSON
{
  "required_status_checks": { "strict": false, "contexts": $CHECKS },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
echo "done: main is protected."
