# shellcheck shell=bash
# shellcheck disable=SC2034 # FARM_LEGS, FARM_WHY and FARM_HOST are read by the scripts that source this file
# The farm: the legs of a release's gate and proof run on other sandboxes of the same kind and report back as records in
# origin. Sourced by the script that runs a leg there and writes its record, by the release's gate and by local-proof.sh
# --farm, which read them. It defines functions and runs nothing.
#
# A record is a commit on refs/heads/farm/<commit>/<slug of the leg> whose tree is one file, `record`:
#   farm-record: 1
#   leg: gate:check
#   commit: <the full hash of the commit the leg ran on>
#   command: <farm_cmd of the leg>
#   exit: 0
#   seconds: 812
#   host: <hostname>
#   finished: 2026-10-19T14:02:11Z
#   public-tree: <tree hash>          (gate:public-tree only: the tree of the public export that was tested; the audit of its
#                                      build reads the household's private terms, so the gate runs that part itself)
#   log:
#   <the last FARM_TAIL (80) lines of the leg's log>
# A later run of the same leg is a commit on top of the one before, so the branch only moves forward and is never
# force-pushed; its tip is the record that counts. A reader takes a leg as passed only when that tip names this leg, this
# very commit, the command this checkout would run for it and exit 0 (farm_check). A stamp is never written from here:
# the gate and local-proof.sh write their own, once every leg passed here or by record.

FARM_LIST=${FARM_LIST:-} # the list of baselines the proof's legs name: the caller sets it
FARM_BUILD=${FARM_BUILD:-build} # the build the e2e leg runs first: the caller names it
FARM_REMOTE=${FARM_REMOTE:-origin}
FARM_WHY=''
FARM_HOST=''

# farm_slug LEG: the leg as a part of a ref name (no colon, no slash): proof:lane:2/4 is proof-lane-2-of-4
farm_slug() { local s=${1//\//-of-}; printf '%s' "${s//:/-}"; }

# farm_valid LEG: 0 for a leg name the farm knows
farm_valid() {
  case $1 in
    gate:check | gate:e2e | gate:public-tree | proof:image+smoke | proof:signature | proof:drills) return 0 ;;
    proof:lane:*) [[ ${1#proof:lane:} =~ ^([1-9][0-9]?)/([1-9][0-9]?)$ ]] && ((BASH_REMATCH[1] <= BASH_REMATCH[2])) ;;
    *) return 1 ;;
  esac
}
FARM_LEGS="gate:check gate:e2e gate:public-tree proof:image+smoke proof:signature proof:drills proof:lane:K/N"

# farm_cmd LEG: the one command the leg runs, as the gate and the proof run it (with FARM_LIST and FARM_BUILD). The gate's own
# run adds only shares of the cores (CHECK_JOBS, VITEST_MAX_WORKERS and the like), which change no result.
farm_cmd() {
  case $1 in
    gate:check) echo "env CI=true CHECK_FRESH=1 pnpm check" ;;
    gate:e2e) echo "pnpm $FARM_BUILD && pnpm e2e --reporter=list" ;;
    gate:public-tree) echo "public_tree DIR" ;;
    proof:image+smoke | proof:signature | proof:drills) echo "tools/ci/local-proof.sh --part ${1#proof:} $FARM_LIST" ;;
    proof:lane:*) echo "tools/ci/local-proof.sh --lane ${1#proof:lane:} $FARM_LIST" ;;
    *) return 1 ;;
  esac
}

# farm_fetch SHA: the records of SHA from the remote into refs/farm/SHA/ (pruned, so a record gone there is gone here). 1
# when the remote does not answer; the records fetched before stay.
farm_fetch() {
  git fetch -q --no-tags --prune "$FARM_REMOTE" "+refs/heads/farm/$1/*:refs/farm/$1/*" </dev/null 2>/dev/null
}
# farm_record SHA LEG: the text of the fetched record, 1 when there is none
farm_record() { git cat-file -p "refs/farm/$1/$(farm_slug "$2"):record" 2>/dev/null; }
# farm_field TEXT KEY: the value of the first "KEY: " line above the log
farm_field() { sed -n "/^log:\$/q; s/^$2: //p" <<<"$1" | head -n 1; }
# farm_legs SHA: the legs that have a record fetched, one a line
farm_legs() {
  local r
  git for-each-ref --format='%(refname)' "refs/farm/$1/" | while IFS= read -r r; do
    farm_field "$(git cat-file -p "$r:record" 2>/dev/null)" leg
  done
}

# farm_check SHA LEG: 0 when the fetched record of LEG passed on exactly SHA with the command this checkout runs. Else 1,
# and FARM_WHY says why in a few words. FARM_HOST is the record's host either way.
farm_check() {
  local rec want
  FARM_WHY='' FARM_HOST=''
  rec=$(farm_record "$1" "$2") || { FARM_WHY="no record"; return 1; }
  FARM_HOST=$(farm_field "$rec" host)
  want=$(farm_cmd "$2")
  if [[ $(farm_field "$rec" farm-record) != 1 ]]; then FARM_WHY="a record of another format"
  elif [[ $(farm_field "$rec" leg) != "$2" ]]; then FARM_WHY="the record is of the leg $(farm_field "$rec" leg)"
  elif [[ $(farm_field "$rec" commit) != "$1" ]]; then FARM_WHY="the record is of the commit $(farm_field "$rec" commit | cut -c1-7)"
  elif [[ $(farm_field "$rec" command) != "$want" ]]; then FARM_WHY="the record ran \"$(farm_field "$rec" command)\", this checkout runs \"$want\""
  elif [[ $(farm_field "$rec" exit) != 0 ]]; then FARM_WHY="it exited $(farm_field "$rec" exit) on ${FARM_HOST:-a host it does not name}"
  else return 0; fi
  return 1
}

# farm_write SHA LEG EXIT SECONDS LOG [EXTRA...]: the record, pushed to its branch on top of the one there. EXTRA are more
# "key: value" lines. Tries twice: a record of the same leg pushed between the fetch and the push is the parent of the second.
farm_write() {
  local sha=$1 leg=$2 rc=$3 secs=$4 log=$5 slug ref file blob tree parent=() c try
  shift 5
  slug=$(farm_slug "$leg"); ref=refs/heads/farm/$sha/$slug
  file=$(mktemp) || return 1
  {
    printf 'farm-record: 1\nleg: %s\ncommit: %s\ncommand: %s\nexit: %s\nseconds: %s\nhost: %s\nfinished: %s\n' \
      "$leg" "$sha" "$(farm_cmd "$leg")" "$rc" "$secs" "$(hostname 2>/dev/null || echo unknown)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    (($# == 0)) || printf '%s\n' "$@"
    echo "log:"
    [[ ! -f $log ]] || tail -n "${FARM_TAIL:-80}" "$log" | cut -c1-300
  } >"$file"
  blob=$(git hash-object -w "$file") && tree=$(printf '100644 blob %s\trecord\n' "$blob" | git mktree) || { rm -f "$file"; return 1; }
  rm -f "$file"
  for try in 1 2; do
    parent=()
    if git fetch -q --no-tags "$FARM_REMOTE" "+$ref:refs/farm/$sha/$slug" </dev/null 2>/dev/null; then parent=(-p "refs/farm/$sha/$slug"); fi
    c=$(git commit-tree "${parent[@]}" -m "farm: $leg on ${sha:0:7}, exit $rc" "$tree") || return 1
    git push -q "$FARM_REMOTE" "$c:$ref" </dev/null && { git update-ref "refs/farm/$sha/$slug" "$c"; return 0; }
    ((try == 2)) || echo "farm: the push of the record of $leg was refused, trying once more on top of the newer one" >&2
  done
  return 1
}
