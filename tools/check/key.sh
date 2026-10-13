#!/usr/bin/env bash
# The key of a check step: what a stamp of that step is named by (tools/check.sh writes and reads the stamps).
#   tools/check/key.sh STEP           prints the key, 64 hex digits
#   tools/check/key.sh STEP STEP ...  prints one line "STEP<TAB>KEY" for each
# The key is a sha256 over the step's name, K0 and the lines of `git ls-files -s -- <the step's paths>` (mode, blob, path: the
# content of every tracked file the step may read, not a commit). K0 is the word v2, the blobs of pnpm-lock.yaml, the root
# package.json, pnpm-workspace.yaml, tools/check.sh and tools/check/, `node -v`, $BASH_VERSION, each environment variable of
# the `env:` line of reads.txt with its value (unset as empty) and, for lint, `shellcheck --version`, for e2e the names of the
# installed Chromium folders. The paths come from
# tools/check/reads.txt: a line `step: pathspec pathspec ...`. A step is looked
# up by its whole name, then by the word before its first colon (sh:alpha.test.sh finds sh), and a step with no line gets
# the whole tree. `{self}` stands for the part after that colon; the pathspecs that hold it are added to the others
# and are not cut by their excludes, so a family can read every file of a folder except the other suites' own.
# Only tracked content is in a key: a changed or an untracked file is no part of it, so check.sh reads no stamp while
# `git status` shows one. Exit code 1 when there is no git tree or no reads file: no key, no stamp.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
cd "$ROOT" || exit 1
READS=$HERE/reads.txt
(($#)) || { echo "usage: key.sh STEP..." >&2; exit 2; }
[[ -f $READS ]] || { echo "key.sh: no $READS" >&2; exit 1; }

# every tracked file once: path -> "mode blob stage", for the lookups of {self}
declare -A BLOB=()
all=$(git ls-files -s) || exit 1
while IFS=$'\t' read -r meta path; do BLOB[$path]=$meta; done <<<"$all"

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
  echo v2
  git ls-files -s -- pnpm-lock.yaml package.json pnpm-workspace.yaml tools/check.sh tools/check
  node -v 2>/dev/null || echo no-node
  echo "$BASH_VERSION"
  for name in ${ENVS[@]+"${ENVS[@]}"}; do printf 'env %s=%s
' "$name" "${!name:-}"; done
) || exit 1
sc=""

# The hash input of every step is written to a file of its own, the step's name its first line (so that no two steps share a
# key), and all of them are hashed by one sha256sum: a fork a key would be most of the time of a run of a few dozen steps.
T=$(mktemp -d "${TMPDIR:-/tmp}/key.XXXXXX") || exit 1
trap 'rm -rf "$T"' EXIT
declare -A BASE=() OF=()
nitem=0
prep() { # prep STEP: the input file of the step's key is OF[STEP]
  local step=$1 fam=${1%%:*} self="" spec="" tok plain=() own=() extra="" base
  [[ -z ${OF[$step]+x} ]] || return 0
  [[ $step == *:* ]] && self=${step#*:}
  if [[ -n ${SET[$step]+x} ]]; then spec=${SET[$step]}; elif [[ -n ${SET[$fam]+x} ]]; then spec=${SET[$fam]}; else spec="<tree>"; fi
  [[ $fam == lint ]] && { [[ -n $sc ]] || sc=$(shellcheck --version 2>/dev/null | sed -n 's/^version: //p'); extra=${sc:-no-shellcheck}; }
  [[ $fam == e2e ]] && extra=$(find "${PLAYWRIGHT_BROWSERS_PATH:-${XDG_CACHE_HOME:-$HOME/.cache}/ms-playwright}" -maxdepth 1 -name 'chromium*' -printf '%f\n' 2>/dev/null | sort | paste -sd ' ')
  if [[ $spec == "<tree>" ]]; then
    base=$all
  else
    local -a words
    read -ra words <<<"$spec"
    for tok in "${words[@]}"; do
      if [[ $tok == *"{self}"* ]]; then own+=("${tok//\{self\}/$self}"); else plain+=("$tok"); fi
    done
    if [[ -z ${BASE[${plain[*]:-}]+x} ]]; then
      BASE[${plain[*]:-}]=""
      # no pathspec at all would list the whole tree, which is the opposite of an empty set
      if ((${#plain[@]})); then BASE[${plain[*]}]=$(git ls-files -s -- "${plain[@]}") || return 1; fi
    fi
    base=${BASE[${plain[*]:-}]}
  fi
  nitem=$((nitem + 1))
  # the lines of {self} come after the others, in the order of the tokens: no sort needed, the order is fixed by the line
  { printf '%s
' "$step" "$k0" "$extra" "$base"
    for tok in ${own[@]+"${own[@]}"}; do
      if [[ -n ${BLOB[$tok]+x} ]]; then printf '%s	%s
' "${BLOB[$tok]}" "$tok"; else git ls-files -s -- "$tok" || return 1; fi
    done; } >"$T/$nitem" || return 1
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
