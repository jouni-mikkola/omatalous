#!/usr/bin/env bash
# Syntax check (bash -n) and shellcheck for every shell script in the repo. CI and `pnpm check` both run it.
#   tools/ci/shell-lint.sh
# Without shellcheck the syntax check still runs and the script says so. With CI set, a missing shellcheck is an error,
# so a runner image that loses it cannot turn the lint into a silent pass.
set -euo pipefail
cd "$(dirname "$0")/../.."

# nullglob: the public snapshot has no tools/*.sh from the private repo, and an unexpanded glob
# would fail shellcheck
shopt -s nullglob
files=(scripts/*.sh scripts/lib/*.sh tools/*.sh tools/*/*.sh)

# The syntax check takes the files to xargs in groups of six, as many children as CPUs. A red child makes xargs exit 123.
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
  # Every run re-reads the libraries (about a quarter of all the lines), so few runs cost far less CPU than many: half as many
  # runs as CPUs, at least two, each with every K-th file so the big suites do not fall into one run. A red run fails the lint.
  k=$(($(nproc) / 2))
  ((k >= 2)) || k=2
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  pids=()
  for ((i = 0; i < k; i++)); do
    group=()
    for ((j = i; j < ${#files[@]}; j += k)); do group+=("${files[j]}"); done
    ((${#group[@]})) || continue
    shellcheck -S warning "${group[@]}" "${libs[@]}" >"$tmp/$i" 2>&1 &
    pids+=($!)
  done
  red=0
  for i in "${!pids[@]}"; do
    wait "${pids[i]}" || red=1
    cat "$tmp/$i"
  done
  ((red == 0)) || exit 1
  echo "${#files[@]} files, bash -n and shellcheck $(shellcheck --version | sed -n 's/^version: //p')"
elif [[ -n ${CI:-} ]]; then
  echo "shellcheck is missing and CI is set." >&2
  exit 1
else
  echo "${#files[@]} files, bash -n only (shellcheck is not installed)"
fi
