#!/usr/bin/env bash
# Syntax check (bash -n) and shellcheck for every shell script in the repo. CI and `pnpm check` both run it.
#   tools/ci/shell-lint.sh
# Without shellcheck the syntax check still runs and the script says so. With CI set, a missing shellcheck is an error,
# so a runner image that loses it cannot turn the lint into a silent pass.
set -euo pipefail
cd "$(dirname "$0")/../.."

# nullglob: the public snapshot has no tools/*.sh from the private repo and no .claude/, and an unexpanded glob
# would fail shellcheck
shopt -s nullglob
files=(scripts/*.sh scripts/lib/*.sh tools/*.sh tools/test/*.sh tools/ci/*.sh tools/release/*.sh .claude/hooks/*.sh)

for f in "${files[@]}"; do bash -n "$f"; done

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -S warning "${files[@]}"
  echo "${#files[@]} files, bash -n and shellcheck $(shellcheck --version | sed -n 's/^version: //p')"
elif [[ -n ${CI:-} ]]; then
  echo "shellcheck is missing and CI is set." >&2
  exit 1
else
  echo "${#files[@]} files, bash -n only (shellcheck is not installed)"
fi
