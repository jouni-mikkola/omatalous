#!/usr/bin/env bash
# Tests for the move to a release on a new history (scripts/lib/release.sh: lineage_of, crosses_from, continues), by
# update.sh run by hand, by the helper's Päivitä button, by --rollback and by --check-crossing. The public repository may
# start its history again on a new root that names, in release/lineage, the release it continues; an install on exactly
# that release moves to it, any other refuses with nothing changed. Against the stub world of tools/test/ops-world.sh:
# nothing here touches GitHub, a real container or a real registry (the dist drill does that part).
#
#   tools/test/crossing.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by ops-world.sh
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged crossing.test.sh "$@"
world() { new_world; }

by_hand() {
  : >"$S/calls.log"
  OUT=$(cd "$CL" && env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/update.sh --yes </dev/null 2>&1); RC=$?
}
rolled_back() {
  : >"$S/calls.log"
  OUT=$(cd "$CL" && env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/update.sh --rollback --yes </dev/null 2>&1); RC=$?
}
checked() {
  OUT=$(cd "$CL" && env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/update.sh --check-crossing </dev/null 2>&1); RC=$?
}
at() { test "$(git -C "$CL" rev-parse HEAD)" = "$(git -C "$W/seed" rev-parse "v$1^{commit}")" -a "$(cat "$S/cver")" = "$1"; }
pulled() { test "$(grep -c "^docker pull .*:$1\$" "$S/calls.log")" -gt 0; }
# new_root VERSION LINEAGE: the seed's main starts again on an orphan commit with the same files and release/lineage
# holding LINEAGE (a whole line; "" for none), tagged vVERSION and pushed over main, with its image and API answer
new_root() {
  local lineage=$2
  git -C "$W/seed" checkout -q --orphan fresh
  mkdir -p "$W/seed/release"
  if [[ -n $lineage ]]; then printf '%s\n' "$lineage" >"$W/seed/release/lineage"; else rm -f "$W/seed/release/lineage"; fi
  echo "export const APP_VERSION = \"$1\";" >"$W/seed/apps/server/src/version.ts"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "$1 on a new root"
  git -C "$W/seed" branch -q -M fresh main; git -C "$W/seed" tag "v$1"
  git -C "$W/seed" push -q -f origin main "v$1" 2>/dev/null
  echo "$1|$(git -C "$W/seed" rev-parse HEAD)|1" >"$S/registry/$1"
  printf '{\n  "tag_name": "v%s",\n  "body": "Notes for %s"\n}\n' "$1" "$1" >"$S/release.json"
}
continues_line() { printf 'continues v%s %s' "$1" "$(git -C "$W/seed" rev-parse "v$1^{commit}")"; }

t_by_hand_crosses_and_comes_back() {
  world; release 0.2.0; by_hand
  check "the install is on the bridge release" at 0.2.0
  new_root 0.3.0 "$(continues_line 0.2.0)"
  by_hand
  check "update.sh moves to the release on the new root" bash -c "[[ $RC == 0 ]]" && check "and is on it" at 0.3.0
  check "it says it is a new history" grep -q 'starts a new history that continues v0.2.0' <<<"$OUT"
  check "the signature was checked for the new root's commit before the move" grep -q -- "--certificate-github-workflow-sha $(git -C "$W/seed" rev-parse v0.3.0)" "$S/calls.log"
  check "the state file names the commit it came from" grep -qx "CROSSED_FROM=$(git -C "$W/seed" rev-parse v0.2.0)" "$CL/backups/.last-update"
  check "the branch keeps its upstream" test "$(git -C "$CL" rev-parse '@{u}')" = "$(git -C "$CL" rev-parse HEAD)"
  rolled_back
  check "--rollback goes back across" bash -c "[[ $RC == 0 ]]" && check "to the bridge release" at 0.2.0
  by_hand
  check "and the next update crosses again" at 0.3.0
  release 0.3.1; by_hand
  check "a release after the root is an ordinary update" at 0.3.1
  check "with no crossing in its state file" bash -c "! grep -q CROSSED_FROM '$CL/backups/.last-update'"
}
t_helper_crosses() {
  world; release 0.2.0; by_hand
  new_root 0.3.0 "$(continues_line 0.2.0)"
  poll update; tick
  check "the Päivitä button moves to the new root" at 0.3.0
  check "and reports it done" reported ok
}
t_refused() {
  # an install below the release the root continues: stranded, nothing moves
  world; release 0.2.0; release 0.2.1; by_hand; release 0.2.2
  new_root 0.3.0 "$(continues_line 0.2.2)"
  by_hand
  check "an install not on the continued release does not move" at 0.2.1
  check "and its image is not pulled" bash -c "! grep -q '^docker pull .*:0.3.0' '$S/calls.log'"
  poll update; tick
  check "the helper refuses it too" at 0.2.1
  check "and says so" reported failed
  checked
  check "--check-crossing names the command that moves it by hand" bash -c "[[ $RC != 0 && \$1 == *'git checkout -B main origin/main'* ]]" x "$OUT"
  # a root with no lineage, or with a malformed one, or naming a commit whose tag says otherwise
  for bad in "" "continues v0.2.0" "continues 0.2.0 $(printf '%040d' 0)" "continues v0.2.0 $(printf 'a%.0s' {1..40})"; do
    world; release 0.2.0; by_hand
    new_root 0.3.0 "$bad"
    poll update; tick
    check "a root with lineage \"${bad:0:20}…\" is refused by the helper" at 0.2.0
  done
  # a lineage that names HEAD's commit under another tag
  world; release 0.2.0; by_hand; git -C "$W/seed" tag v0.1.9 v0.2.0~1; git -C "$W/seed" push -q origin v0.1.9 2>/dev/null
  new_root 0.3.0 "continues v0.1.9 $(git -C "$W/seed" rev-parse v0.2.0)"
  poll update; tick
  check "a lineage whose tag is not on that commit is refused" at 0.2.0
  # the signature fails: nothing moves
  world; release 0.2.0; by_hand
  new_root 0.3.0 "$(continues_line 0.2.0)"; touch "$S/cosignfail"
  by_hand
  check "a root whose image fails its signature is not taken" at 0.2.0
  check "and the clone stays on the old line" test "$(git -C "$CL" rev-parse HEAD)" = "$(git -C "$W/seed" rev-parse v0.2.0)"
}
t_untracked_in_the_way() {
  # a file of the household where the new root has one: found before the pull, not by reset --keep after the switch began
  world; release 0.2.0; by_hand
  new_root 0.3.0 "$(continues_line 0.2.0)"
  mkdir -p "$CL/release"; echo mine >"$CL/release/lineage"
  by_hand
  check "an untracked file in the way stops the move" bash -c "[[ $RC != 0 && \$1 == *'release/lineage'* ]]" x "$OUT"
  check "before the pull" bash -c "! grep -qE '^docker (pull|image tag)' '$S/calls.log'" && check "and the install stays" at 0.2.0
  check "the file is the household's still" test "$(cat "$CL/release/lineage")" = mine
  rm -f "$CL/release/lineage"; by_hand
  check "without it the move goes" at 0.3.0
}
t_check_crossing() {
  world; release 0.2.0; by_hand
  checked
  check "--check-crossing on the release: says so" bash -c "[[ $RC == 0 && \$1 == *'This folder is on v0.2.0'* ]]" x "$OUT"
  release 0.2.1; checked
  check "--check-crossing before an ordinary update" grep -q 'an ordinary update' <<<"$OUT"
  check "and it changed nothing" at 0.2.0
  world; release 0.2.0; by_hand; new_root 0.3.0 "$(continues_line 0.2.0)"; : >"$S/calls.log"; checked
  check "--check-crossing before a move" bash -c "[[ $RC == 0 && \$1 == *'starts a new history that continues v0.2.0'* ]]" x "$OUT"
  check "pulls nothing and moves nothing" bash -c "! grep -qE '^docker (pull|image tag|compose (up|build))' '$S/calls.log'" && check "stays" at 0.2.0
  setenv 'TALOUS_CHANNEL=source'; checked
  check "--check-crossing on the source channel says it never moves" grep -q 'never moves to a new history' <<<"$OUT"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
