#!/usr/bin/env bash
# Migrations since a base ref (the previous release tag) may only be added, never edited, renamed or removed.
#   tools/ci/check-migrations.sh v0.3.0
set -euo pipefail
base=${1:?usage: check-migrations.sh <base-ref>}
cd "$(dirname "$0")/../.."
git rev-parse --verify --quiet "$base^{commit}" >/dev/null || { echo "Unknown ref: $base" >&2; exit 1; }
bad=$(git diff --name-status "$base" HEAD -- apps/server/migrations | grep -v '^A' || true)
if [[ -n $bad ]]; then
  echo "Applied migrations must not be changed. Add a new file:" >&2
  echo "$bad" >&2
  exit 1
fi
echo "Migrations since $base are additions only."
