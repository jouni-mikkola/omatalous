#!/usr/bin/env bash
# tools/ci/light-scope.sh: what the light tier of ci.yml runs, as one line `args=...` for $GITHUB_OUTPUT.
# EVENT is the workflow event, BASE_REF the branch of a pull request, BEFORE the commit a push replaced. A pull request
# and a push are checked against what they changed (`--changed BASE`, the scope tools/check.sh and tools/check/scope.mjs
# decide). A hand-started run and a new branch are checked against main. Only a base the clone does not hold runs
# every lint, type check and test the tier has (never the page tests, the image or the build: those run on the release
# machine). The clone must hold the history (fetch-depth: 0).
set -euo pipefail

EVENT=${EVENT:-}
BASE=
case $EVENT in
  pull_request) [[ -z ${BASE_REF:-} ]] || BASE=origin/$BASE_REF ;;
  push) if [[ ${BEFORE:-} =~ ^0*$ ]]; then BASE=origin/main; else BASE=$BEFORE; fi ;;
  workflow_dispatch) BASE=origin/main ;;
esac
if [[ -n $BASE ]] && git rev-parse --verify -q "$BASE^{commit}" >/dev/null 2>&1; then
  echo "args=--changed $BASE"
else
  echo "args="
fi
