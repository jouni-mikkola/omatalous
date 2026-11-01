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
# a baseline from after the helper's split keeps the policy in scripts/lib/ops-git.sh, an older one in the helper itself
git show "$base:scripts/lib/ops-git.sh" >>"$work/helper.sh" 2>/dev/null || true
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
# A helper that does not know the pin form of a helper image refuses it: the tunnel pin before 0.8.7, the Caddy pin in
# every release before the one that taught the helper. Those installs update once by hand (docs/TROUBLESHOOTING.md,
# Updates). The check expects exactly those refusals from such a baseline when this commit pins the image, and fails when
# the answer is anything else: a pass means the helper changed under us, another refusal means this commit broke more.
expected=""
add_expected() { # add_expected SERVICE IMAGE-PREFIX PIN-RULE-IN-THE-POLICY
  local image
  image=$(git show HEAD:docker-compose.yml | sed -n "s|^ *image: *\($2:.*\)\$|\1|p" | head -1)
  if [[ $image == *@sha256:* ]] && ! grep -qF "$3" "$work/policy.sh"; then expected+="${expected:+;}$1: image $image"; fi
}
add_expected caddy caddy '^caddy:2[.]'
add_expected tunnel cloudflare/cloudflared 'cloudflare/cloudflared:[0-9]'
if compose_policy_ok HEAD; then
  if [[ -n $expected ]]; then
    echo "The maintenance helper of $base accepts the pinned helper images, but it was expected to refuse them ($expected)." >&2
    echo "The known refusal changed: update the expectation here and the update note in docs/TROUBLESHOOTING.md." >&2
    exit 1
  fi
  echo "The compose file passes the compose policy of $base's maintenance helper."
elif [[ -n $expected && $POLICY_MSG == "$expected" ]]; then
  echo "The maintenance helper of $base refuses the pinned helper images, as expected: installs on $base update once by hand."
else
  echo "The maintenance helper of $base refuses this docker-compose.yml: $POLICY_MSG" >&2
  echo "Installs on $base could not update from the browser. Keep the change for a later release." >&2
  exit 1
fi
