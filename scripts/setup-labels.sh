#!/usr/bin/env bash
# Creates (or updates) the labels the bug workflow uses. Safe to run again.   bash scripts/setup-labels.sh
set -uo pipefail
mk() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null 2>&1 && echo "  $1" || echo "  ! $1 (could not set)"; }
echo "severity"
mk S1 B60205 "Wrong message sent, data loss, or risk of a ban: fix now"
mk S2 D93F0B "A feature is broken"
mk S3 FBCA04 "Confusing, slow or awkward, but it works"
mk S4 C2E0C6 "Polish"
echo "area"
for a in contacts campaigns inbox import ai numbers gateway team security web-ui; do mk "area:$a" 1D76DB "Where it happens: $a"; done
echo "workflow"
mk needs-triage EDEDED "Reported, not yet given a severity or an R-number"
mk needs-repro F9D0C4 "Cannot reproduce yet: ask the reporter for more"
mk needs-verify BFD4F2 "Fixed and merged: waiting for the reporter to confirm on their copy"
mk verified 0E8A16 "The reporter confirmed it is fixed"
mk flaky 5319E7 "A test that fails at random; moved out of the blocking set until fixed"
mk regression-test 0052CC "Adds or changes a regression test"
