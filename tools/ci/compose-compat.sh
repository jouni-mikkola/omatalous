#!/usr/bin/env bash
# tools/ci/compose-compat.sh BASELINE
# An install updates from the browser through the maintenance helper it already runs, so the new
# docker-compose.yml has to pass the compose policy of the baseline's helper, not only of the new one.
# Runs that old policy check on this checkout's commit. A baseline without a helper has nothing to check.
set -euo pipefail
base=${1:?usage: compose-compat.sh BASELINE}
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
if ! git show "$base:scripts/ops-helper.sh" >"$work/helper.sh" 2>/dev/null; then
  echo "$base has no maintenance helper, nothing to check"
  exit 0
fi
# the policy and its check function, cut out of the old helper as they are
{
  awk "/^COMPOSE_JQ='/{f=1} f{print} f&&/^'\$/{exit}" "$work/helper.sh"
  awk '/^compose_policy_ok\(\)/{f=1} f{print} f&&/^}/{exit}' "$work/helper.sh"
} >"$work/policy.sh"
grep -q '^compose_policy_ok()' "$work/policy.sh" || { echo "$base: compose policy not found in its helper"; exit 1; }
OPS=$work/ops
mkdir -p "$OPS/run"
POLICY_MSG=""
# shellcheck source=/dev/null
. "$work/policy.sh"
if compose_policy_ok HEAD; then
  echo "The compose file passes the compose policy of $base's maintenance helper."
else
  echo "The maintenance helper of $base refuses this docker-compose.yml: $POLICY_MSG" >&2
  echo "Installs on $base could not update from the browser. Keep the change for a later release." >&2
  exit 1
fi
