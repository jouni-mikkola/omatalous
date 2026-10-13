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
files=(scripts/*.sh scripts/lib/*.sh tools/*.sh tools/*/*.sh .claude/hooks/*.sh)

# The files go to xargs in groups of six, one group per child, as many children as CPUs. A red child makes xargs exit 123.
lint() { printf '%s\n' "${files[@]}" | xargs -d '\n' -n 6 -P "$(nproc)" "$@"; }
lint bash -c 'for f; do bash -n "$f" || exit 1; done' _

if command -v shellcheck >/dev/null 2>&1; then
  # A script that sources a library uses its variables, and a library uses the variables of the script that sources it:
  # the checker only knows that when both are in the same run, so every group carries the libraries. A library is a file
  # under scripts/lib, one named *lib.sh, or any file another script names after `.` or `source`; the set is a function
  # of the files and not of how they fall into groups.
  sourced=$(grep -hE '(^|[;&|(])[[:space:]]*(\.|source)[[:space:]]+[^[:space:]]' "${files[@]}" | sed 's/$/ /' || true)
  libs=()
  for f in "${files[@]}"; do
    [[ $f == scripts/lib/* || $f == *lib.sh || $sourced == *[/\"\ ]"${f##*/}"[\"\ \;]* ]] && libs+=("$f")
  done
  LIBS="${libs[*]}" lint bash -c 'shellcheck -S warning "$@" $LIBS' _
  echo "${#files[@]} files, bash -n and shellcheck $(shellcheck --version | sed -n 's/^version: //p')"
elif [[ -n ${CI:-} ]]; then
  echo "shellcheck is missing and CI is set." >&2
  exit 1
else
  echo "${#files[@]} files, bash -n only (shellcheck is not installed)"
fi
