#!/usr/bin/env bash
# The stamps of a step: the one place that decides when a stamp is read and when it is written. A step that ran green on
# exactly the same tracked content is not run again; its proof is a one-line file $STAMPS/<step>/<key>, the key being
# tools/check/key.sh's hash of every file the step may read (tools/check/reads.txt).
#
# Two ways in, the same code:
#   source tools/check/stamps.sh        tools/check.sh: the functions below, and its own stamps_collect
#   bash tools/check/stamps.sh COMMAND  e2e/run.mjs: the state of a run is kept in a folder DIR that the caller makes
#     start DIR WHO STEP...       0 and the state saved when this run may read and write stamps for the steps; 1 and a
#                                 line "WHO: ..." (or nothing) when it may not
#     hit DIR STEP                0 and "HH:MM SECONDS PASSED SKIPPED" when STEP has a whole stamp, else 1
#     write DIR STEP SECS PASSED SKIPPED   STEP ran whole and green: writes its stamp unless something changed under the run
# A stamp is READ only when node_modules was installed from this pnpm-lock.yaml, the tree is clean (no change, no untracked
# file, no assume-unchanged flag) and CHECK_FRESH is empty, and WRITTEN only when, besides, the whole step ran green
# without a rerun of a failed job and with no skipped test, the tree is still clean when all the steps have ended, the key
# is still the one computed before them and no tracked file was touched since the run began (a file changed and changed back
# is clean and has the same key, but its ctime is another). --changed and CI use none.
# The callers' words in a message are STAMP_WHO (default check).

STAMPS="" STAMP_ON=0 FRESH=0 IDS=() MARK=
STAMP_WHO=${STAMP_WHO:-check}
[[ -z ${CHECK_FRESH:-} ]] || FRESH=1
declare -A KEY=()

clean_tree() {
  local st lv
  st=$(git status --porcelain --untracked-files=all 2>/dev/null) || return 1
  [[ -z $st ]] || return 1
  lv=$(git ls-files -v 2>/dev/null) || return 1
  ! grep -q -v '^H' <<<"$lv" # a file marked assume-unchanged or skip-worktree hides its changes from status
}

# read_keys ARRAY: the key of every id in IDS into the associative ARRAY; 1 when key.sh gives none or not all
read_keys() {
  local -n out=$1
  local id k n=0
  if ((${#IDS[@]} == 1)); then
    k=$(bash "$ROOT/tools/check/key.sh" "${IDS[0]}" 2>/dev/null) || return 1
    out[${IDS[0]}]=$k
    return 0
  fi
  # shellcheck disable=SC2034 # out is a nameref: the caller's array
  while IFS=$'\t' read -r id k; do out[$id]=$k; n=$((n + 1)); done < <(bash "$ROOT/tools/check/key.sh" "${IDS[@]}" 2>/dev/null)
  ((n == ${#IDS[@]}))
}

# stamps_collect: the caller fills IDS with the ids of the steps it stamps (after the tree is known to be clean); the default
# leaves IDS as it was
stamps_collect() { :; }

# ctimes: one line per tracked file, its name and the nanosecond ctime, sorted. Two lists are compared, never a ctime with the
# clock: a loaded WSL machine steps its clock back, and a file written a moment ago then has a ctime later than "now".
ctimes() { git ls-files -z | xargs -0 -r stat --printf '%n %z\n' 2>/dev/null | LC_ALL=C sort; }

# stamps_start: decides whether this run reads and writes stamps, and takes the keys before any step runs
stamps_start() {
  local top
  [[ -z ${CI:-} ]] && ((${CHANGED:-0} == 0)) && [[ -f $ROOT/tools/check/key.sh ]] || return 0
  top=$(git rev-parse --show-toplevel 2>/dev/null) && [[ $(cd "$top" && pwd -P) == "$(cd "$ROOT" && pwd -P)" ]] || return 0
  STAMPS=${CHECK_STAMPS_DIR:-$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/check-stamps}
  [[ $STAMPS != /check-stamps ]] || return 0
  # what is installed must be what the lockfile says, or a stamp would name packages the run did not use
  cmp -s "$ROOT/pnpm-lock.yaml" "$ROOT/node_modules/.pnpm/lock.yaml" || { echo "$STAMP_WHO: node_modules is not the install of this pnpm-lock.yaml, so no stamp is read or written"; return 0; }
  MARK=$CHECK_LOG/stamp-mark
  ctimes >"$MARK" || return 0
  clean_tree || { echo "$STAMP_WHO: the tree is not clean, so no stamp is read or written"; return 0; }
  stamps_collect
  ((${#IDS[@]})) && read_keys KEY || { IDS=(); KEY=(); return 0; }
  STAMP_ON=1
}

# stamp_hit ID: 0, and H_AT (HH:MM), H_SECS, H_PASSED and H_SKIPPED, when this run reads stamps and the stamp of ID's key is
# there and whole: one line, the fields in order, the key in it the key of its name. Anything else is a miss.
STAMP_RE='^key=([0-9a-f]{64}) date=([0-9T:+-]+) commit=([0-9a-f]{7,40}) worktree=([^ ]+) seconds=([0-9]+) passed=([0-9]+) skipped=([0-9]+)$'
stamp_hit() {
  ((STAMP_ON && !FRESH)) || return 1
  local f=$STAMPS/${1//\//%}/${KEY[$1]:-none} line extra=""
  [[ -f $f ]] || return 1
  { IFS= read -r line || return 1; IFS= read -r extra; } <"$f"
  [[ -z $extra && $line =~ $STAMP_RE && ${BASH_REMATCH[1]} == "${KEY[$1]}" ]] || return 1
  H_AT=${BASH_REMATCH[2]:11:5} H_SECS=${BASH_REMATCH[5]} H_PASSED=${BASH_REMATCH[6]} H_SKIPPED=${BASH_REMATCH[7]}
}

# stamp_cand ID SECONDS PASSED SKIPPED: this step ran whole and green; stamps_write decides at the end. A step with a
# skipped test is no candidate: what did not run is not proven.
stamp_cand() {
  ((STAMP_ON)) || return 0
  [[ $4 == 0 ]] || return 0
  echo "$1 $2 $3 $4" >"$CHECK_LOG/cand-${1//\//%}"
}

# stamps_write: after every step, write the stamps of the candidates if nothing changed under the run
stamps_write() {
  ((STAMP_ON)) || return 0
  local cands=("$CHECK_LOG"/cand-*) c id s p q dir tmp commit wt now touched n=0
  [[ -e ${cands[0]} ]] || return 0
  declare -A NOW=()
  if ! clean_tree || ! read_keys NOW; then echo "$STAMP_WHO: no stamp written, the tree changed while the steps ran"; return 0; fi
  touched=$(comm -13 "$MARK" <(ctimes) | head -n 1)
  if [[ -n $touched ]]; then echo "$STAMP_WHO: no stamp written, ${touched%% *} was touched while the steps ran"; return 0; fi
  commit=$(git rev-parse --short=12 HEAD 2>/dev/null) || return 0
  wt=$(basename "$ROOT" | tr -c 'A-Za-z0-9._\n-' '_')
  now=$(date +%Y-%m-%dT%H:%M:%S%z)
  for c in "${cands[@]}"; do
    read -r id s p q <"$c" || continue
    [[ -n ${KEY[$id]:-} && ${NOW[$id]:-} == "${KEY[$id]}" ]] || continue
    dir=$STAMPS/${id//\//%}
    mkdir -p "$dir" 2>/dev/null && tmp=$(mktemp "$dir/.tmp.XXXXXX" 2>/dev/null) || continue
    if printf 'key=%s date=%s commit=%s worktree=%s seconds=%s passed=%s skipped=%s\n' "${KEY[$id]}" "$now" "$commit" "$wt" "$s" "$p" "$q" >"$tmp" && mv -f "$tmp" "$dir/${KEY[$id]}"; then n=$((n + 1)); else rm -f "$tmp"; fi
  done
}

# the command line: only when run, not when sourced. The state between two calls is a file in DIR (`declare -p` of the globals).
stamps_cli() {
  local cmd=${1:-} dir=${2:-}
  [[ -d $dir ]] || { echo "usage: stamps.sh start DIR WHO STEP... | hit DIR STEP | write DIR STEP SECS PASSED SKIPPED" >&2; return 2; }
  CHECK_LOG=$dir
  case $cmd in
    start)
      STAMP_WHO=${3:?who}
      shift 3
      IDS=("$@")
      stamps_start
      ((STAMP_ON)) || return 1
      declare -p STAMPS STAMP_ON FRESH IDS MARK STAMP_WHO KEY >"$dir/state"
      ;;
    hit | write)
      # shellcheck disable=SC1091 # written by `start` above
      source "$dir/state" 2>/dev/null || return 1
      if [[ $cmd == hit ]]; then
        stamp_hit "${3:?step}" || return 1
        echo "$H_AT $H_SECS $H_PASSED $H_SKIPPED"
      else
        stamp_cand "${3:?step}" "${4:?secs}" "${5:?passed}" "${6:?skipped}"
        stamps_write
      fi
      ;;
    *) echo "stamps.sh: unknown command: $cmd" >&2; return 2 ;;
  esac
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  set -uo pipefail
  ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
  cd "$ROOT" || exit 1
  stamps_cli "$@"
  exit
fi
