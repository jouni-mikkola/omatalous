#!/usr/bin/env bash
# The key of a check step: what a stamp of that step is named by (tools/check.sh writes and reads the stamps).
#   tools/check/key.sh STEP           prints the key, 64 hex digits
#   tools/check/key.sh STEP STEP ...  prints one line "STEP<TAB>KEY" for each
# The key is a sha256 over the step's name, K0 and the lines of `git ls-files -s -- <the step's paths>` (mode, blob, path: the
# content of every tracked file the step may read, not a commit). K0 is the word v3, the local day (a stamp is good for its own
# day: a test may depend on today), the blobs of pnpm-lock.yaml, the root
# package.json, .npmrc, pnpm-workspace.yaml, tools/check.sh and tools/check/, `node -v`, $BASH_VERSION, each environment variable of
# the `env:` line of reads.txt with its value (a variable that is set and empty is not an unset one) and, for lint, `shellcheck --version`, for e2e the names of the
# installed Chromium folders. The paths come from
# tools/check/reads.txt: a line `step: pathspec pathspec ...`. A step is looked
# up by its whole name, then by the word before its first colon (sh:alpha.test.sh finds sh), and a step with no line gets
# the whole tree.
# Only tracked content is in a key: a changed or an untracked file is no part of it, so check.sh reads no stamp while
# `git status` shows one. Exit code 1 when there is no git tree or no reads file: no key, no stamp.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
cd "$ROOT" || exit 1
READS=$HERE/reads.txt
(($#)) || { echo "usage: key.sh STEP..." >&2; exit 2; }
[[ -f $READS ]] || { echo "key.sh: no $READS" >&2; exit 1; }

all=$(git ls-files -s) || exit 1

declare -A SET=()
ENVS=()
while IFS= read -r line; do
  [[ -z $line || $line == \#* ]] && continue
  [[ $line == *": "* ]] || { echo "key.sh: a line of reads.txt without 'step: paths': $line" >&2; exit 1; }
  if [[ ${line%%: *} == env ]]; then read -ra ENVS <<<"${line#*: }"; else SET[${line%%: *}]=${line#*: }; fi
done <"$READS"
for name in ${ENVS[@]+"${ENVS[@]}"}; do
  [[ $name =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "key.sh: not a variable name in the env line of reads.txt: $name" >&2; exit 1; }
done

k0=$(
  echo v3
  date +%F # a test may depend on today: a stamp is a hit on its own day only
  git ls-files -s -- pnpm-lock.yaml package.json .npmrc pnpm-workspace.yaml tools/check.sh tools/check
  node -v 2>/dev/null || echo no-node
  echo "$BASH_VERSION"
  for name in ${ENVS[@]+"${ENVS[@]}"}; do if [[ -v $name ]]; then printf 'env %s set %s\n' "$name" "${!name}"; else printf 'env %s unset\n' "$name"; fi; done
) || exit 1
sc=""

# The hash input of every step is written to a file of its own, the step's name its first line (so that no two steps share a
# key), and all of them are hashed by one sha256sum: a fork a key would be most of the time of a run of a few dozen steps.
T=$(mktemp -d "${TMPDIR:-/tmp}/key.XXXXXX") || exit 1
trap 'rm -rf "$T"' EXIT
declare -A BASE=() OF=()
nitem=0
prep() { # prep STEP: the input file of the step's key is OF[STEP]
  local step=$1 fam=${1%%:*} spec="" extra="" base
  [[ -z ${OF[$step]+x} ]] || return 0
  if [[ -n ${SET[$step]+x} ]]; then spec=${SET[$step]}; elif [[ -n ${SET[$fam]+x} ]]; then spec=${SET[$fam]}; else spec="<tree>"; fi
  [[ $fam == lint ]] && { [[ -n $sc ]] || sc=$(shellcheck --version 2>/dev/null | sed -n 's/^version: //p'); extra=${sc:-no-shellcheck}; }
  [[ $fam == e2e ]] && extra=$(find "${PLAYWRIGHT_BROWSERS_PATH:-${XDG_CACHE_HOME:-$HOME/.cache}/ms-playwright}" -maxdepth 1 -name 'chromium*' -printf '%f\n' 2>/dev/null | sort | paste -sd ' ')
  if [[ $spec == "<tree>" ]]; then
    base=$all
  else
    if [[ -z ${BASE[$spec]+x} ]]; then
      local -a words
      read -ra words <<<"$spec"
      BASE[$spec]=""
      # no pathspec at all would list the whole tree, which is the opposite of an empty set
      if ((${#words[@]})); then BASE[$spec]=$(git ls-files -s -- "${words[@]}") || return 1; fi
    fi
    base=${BASE[$spec]}
  fi
  nitem=$((nitem + 1))
  printf '%s\n' "$step" "$k0" "$extra" "$base" >"$T/$nitem" || return 1
  OF[$step]=$T/$nitem
}

for step in "$@"; do prep "$step" || exit 1; done
declare -A SUM=()
while read -r h f; do SUM[$f]=$h; done < <(sha256sum "$T"/*)
for step in "$@"; do
  key=${SUM[${OF[$step]}]:-}
  [[ ${#key} == 64 ]] || exit 1
  if (($# == 1)); then echo "$key"; else printf '%s\t%s\n' "$step" "$key"; fi
done
