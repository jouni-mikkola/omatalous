#!/usr/bin/env bash
# Tests for tools/ci/local-proof.sh, and for the port and the project name of tools/ci/upgrade-run.sh. No Docker is
# needed. The proof runs in a stand-in repository whose legs (smoke-image.sh, check-migrations.sh, compose-compat.sh,
# upgrade-run.sh, drills.sh, verify-release.sh) are stubs that write how they were started into one file, with stubs of
# docker, id, setpriv, chown and getent first in PATH. A file in the folder `play` changes what a stub does. Nothing
# waits on the clock: where two processes must meet, they meet on a FIFO or on a lock.
# The rehearsal itself (upgrade-run.sh) runs for real up to its first Docker call, where a stub docker fails.
#
#   tools/test/local-proof.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
has() { if [[ $2 == *"$3"* ]]; then pass "$1"; else fail "$1" "$2"; fi; }
lacks() { if [[ $2 != *"$3"* ]]; then pass "$1"; else fail "$1" "$2"; fi; }

. "$HERE/local-proof-world.sh" || exit 1
# the tests below that read several failures at once ask for every leg to finish; the section "one red leg" says what the default does
export PROOF_KEEP_GOING=1

# ── a proof that passes: the short list, as the user that started it ──
reset
echo 'echo DIRTY >>"$PROOF_CALLS"' >>"$R/tools/ci/upgrade-run.sh"
out=$(UPGRADE_PORT=9999 UPGRADE_PROJECT=mine UPGRADE_KEEP_UP=1 UPGRADE_WORK=/nowhere proof baselines.txt); rc=$?
git -C "$R" checkout -q -- tools/ci/upgrade-run.sh
check "a proof whose legs pass exits 0" test $rc -eq 0
has "the first line says how many baselines, why, and where the logs are" "$out" "local proof of $(short): 5 baselines (nothing an update runs through changed since b7), 3 at a time. Logs: $TMP/work/local-proof."
for l in "the image builds" "smoke test of the image" "signature of the newest release" "upgrade from b0" "upgrade from b3" "upgrade from b5" "upgrade from b6" "upgrade from b7" "install for drills 1, 2, 5, 6, 9, 10" "drills 3, 4, 7, 8" "drills 1, 2, 5, 6, 9, 10"; do
  has "one line for the leg: $l" "$out" "ok      $l ("
done
for b in b1 b2 b4; do lacks "$b is outside the short list" "$out" "upgrade from $b "; done
has "the last line says what passed" "$out" "local proof passed for $(short) in"
has "and counts the baselines" "$out" "the image, the smoke test, the signature, 5 baselines and the drills. Logs: $(logs)"
check "the stamp names the commit and its baselines" test "$(stamp)" = "$(git -C "$R" rev-parse HEAD)"$'\n'"b0 b3 b5 b6 b7"
check "every leg ran in the clone of the commit" test "$(called "cwd=$TMP/work/local-proof\..*/src\$")" -eq 11
lacks "no leg ran in the checkout" "$(calls)" "cwd=$R"
lacks "what is not committed does not run" "$(calls)" "DIRTY"
has "the image is built from the clone" "$(calls)" "docker build -t banking-app:ci . cwd=$TMP/work/local-proof."
has "the smoke test gets the image" "$(calls)" "smoke banking-app:ci unknown unknown"
check "migrations and compose file are checked for each baseline" test "$(called '^check-migrations ')" -eq 5 -a "$(called '^compose-compat ')" -eq 5
has "the first baseline runs on the defaults" "$(calls)" "rehearsal b0 port= project= keep= work=upgrade-b0 "
has "the newest baseline runs on the defaults, and leaves its install up" "$(calls)" "rehearsal b7 port= project= keep=1 work=upgrade-b7 "
lacks "a port, a project or a work folder of the caller does not reach a leg" "$(calls)" "9999"
check "no other rehearsal leaves its install up" test "$(grep '^rehearsal ' "$CALLS" | grep -c 'keep=1')" -eq 1
check "the newest baseline is the last rehearsal of lane 0" test "$(grep -n '^rehearsal b0 ' "$CALLS" | cut -d: -f1)" -lt "$(grep -n '^rehearsal b7 ' "$CALLS" | cut -d: -f1)"
has "the drills' own install: the oldest baseline that can move, a port and a project of its own, up to its update" "$(calls)" "drill-install b3 port=8280 project=drills keep=1 work=own until=update "
check "there is one such install" test "$(called '^drill-install ')" -eq 1
lacks "no rehearsal has the port or the project of the drills' install" "$(grep '^rehearsal ' "$CALLS")" "drills"
has "the helper's drills are on the install of the newest rehearsal, with the default names and port" "$(calls)" "drills work=upgrade-b7 install=up only=3 4 port= project= "
has "the other drills are on the install of their own" "$(calls)" "drills work=own install=up only=1 2 5 6 9 10 port=8280 project=drills "
check "with no user for the drills they come after every other leg, one at a time, the others last" test "$(tail -1 "$CALLS" | cut -c1-23)" = "drills work=own install"
check "the drills' install is made after the helper's drills" test "$(grep -n '^drills work=upgrade-b7' "$CALLS" | cut -d: -f1)" -lt "$(grep -n '^drill-install ' "$CALLS" | cut -d: -f1)"
check "no setpriv and no chown for a user that is not root" test "$(called '^setpriv\|^chown')" -eq 0
check "only the logs stay in the work folder" test "$(ls "$TMP"/work/local-proof.*)" = logs
check "a log for each leg" test "$(ls "$(logs)" | LC_ALL=C sort -u | tr '\n' ' ')" = "clone.log drills-default.log drills-install.log drills-own.log image.log signature.log smoke.log upgrade-b0.log upgrade-b3.log upgrade-b5.log upgrade-b6.log upgrade-b7.log "
# the closing list: one line a leg with its seconds, the longest first, then the lanes and the drills
has "the list opens" "$out" "where the time went, the longest first:"
for l in "the image builds" "smoke test of the image" "signature of the newest release" "upgrade from b0 \(lane 0\)" "upgrade from b7 \(lane 0\)" "upgrade from b3 \(lane 1\)" "install for drills 1, 2, 5, 6, 9, 10" "drills 1, 2, 5, 6, 9, 10" "drills 3, 4, 7, 8"; do
  check "a line a part: $l" grep -qE "^ +[0-9]+ s  $l\$" <<<"$out"
done
check "a line for the drills' install and its drills as a whole" grep -qE "^ +[0-9]+ s  the drills' own install and its drills\$" <<<"$out"
check "a line for lane 0, with all its rehearsals" grep -qE '^ +[0-9]+ s  lane 0, all its rehearsals$' <<<"$out"
check "the list comes before the verdict, which stays the last line" test "$(grep -n 'where the time went' <<<"$out" | cut -d: -f1)" -lt "$(grep -n '^local proof passed' <<<"$out" | cut -d: -f1)" -a "$(tail -1 <<<"$out" | cut -c1-17)" = "local proof passe"
check "the seconds are in order, the longest first" test "$(sed -n '/where the time went/,/^local proof passed/p' <<<"$out" | grep -oE '^ +[0-9]+ s' | tr -d ' s')" = "$(sed -n '/where the time went/,/^local proof passed/p' <<<"$out" | grep -oE '^ +[0-9]+ s' | tr -d ' s' | sort -nr)"

# ── the kept baseline images: only a green proof removes the ones the list no longer names ──
# $PLAY/kept is what `docker image ls proof-baseline` prints, one tag a line; $PLAY/images is what was asked of Docker about them
h0=$(git -C "$R" rev-parse b0); h1=$(git -C "$R" rev-parse b1); stranger=$(printf 'd%.0s' {1..40})
reset
printf '%s\n' "$stranger" >"$PLAY/kept"
out=$(proof ghost.txt)
has "a ref that names no commit here leaves every image alone, and says so" "$out" "baseline images: nope names no commit here, so none is removed"
lacks "and nothing is removed" "$(cat "$PLAY/images" 2>/dev/null)" "docker rmi"
reset
printf '%s\n' "$stranger" >"$PLAY/kept"
touch "$PLAY/fail-b3"
out=$(proof baselines.txt); rc=$?
check "a proof with a red rehearsal exits 1" test $rc -eq 1
lacks "a red proof removes no image and does not count them" "$out$(cat "$PLAY/images" 2>/dev/null)" "baseline images"
reset
printf '%s\n' "$h0" "$h1" "$stranger" latest >"$PLAY/kept"
out=$(proof baselines.txt)
has "a green proof says how many images are kept and how many it removed" "$out" "baseline images kept for the next proof: 2 (1 removed, no longer in baselines.txt)"
has "an image that no ref names is removed, by its full hash" "$(cat "$PLAY/images")" "docker rmi proof-baseline:$stranger"
lacks "an image of a baseline the list names is kept, though this proof did not rehearse it" "$(cat "$PLAY/images")" "docker rmi proof-baseline:$h1"
lacks "so is the one that was rehearsed" "$(cat "$PLAY/images")" "docker rmi proof-baseline:$h0"
lacks "a tag that is no commit hash is not ours to remove" "$(cat "$PLAY/images")" "docker rmi proof-baseline:latest"

# ── the stamp ──
: >"$CALLS"
out=$(proof baselines.txt); rc=$?
check "a second run for the same commit exits 0" test $rc -eq 0
has "and says it is proved already" "$out" "$(short) is proved already from b0 b3 b5 b6 b7 (the stamp is .git/local-proof). Nothing ran."
check "and starts nothing, not even Docker" test ! -s "$CALLS"
out=$(proof --proved baselines.txt); rc=$?
check "--proved exits 0 for a proved commit" test $rc -eq 0 -a ! -s "$CALLS"
has "--proved says from how many" "$out" "$(short) is proved from 5 baselines"
out=$(proof --proved --all baselines.txt); rc=$?
check "the stamp of the short list does not prove the whole list" test $rc -eq 1
has "--proved --all counts the whole list" "$out" "is not proved from its 8 baselines (--all: every baseline of the list runs, none is left out)"
echo more >"$R/docs/more.md"; commit "$R" "words"
out=$(proof --proved baselines.txt); rc=$?
check "the stamp of another commit proves nothing" test $rc -eq 1 -a ! -s "$CALLS"

# ── which baselines ──
has "a change outside what an update runs through: the short list" "$out" "5 baselines (nothing an update runs through changed since b7)"
tried() { # tried FILE...: what the rule says of a commit that changes FILE...
  local f
  for f in "$@"; do mkdir -p "$R/$(dirname "$f")"; echo change >>"$R/$f"; done
  commit "$R" "a change"
  proof --proved baselines.txt
  git -C "$R" reset -q --hard HEAD~1
}
for f in apps/server/migrations/0002_more.sql scripts/update.sh docker-compose.yml docker-compose.override.yml Dockerfile tools/ci/new.sh; do
  has "a change of $f: the whole list" "$(tried "$f")" "8 baselines ($f changed since b7;"
done
for f in apps/server/src/app.ts tools/test/some.test.sh scripts.md; do
  has "a change of $f: the short list" "$(tried "$f")" "5 baselines (nothing"
done
# the files only the release workflow's jobs run (NOT_RUN): a change of them alone is no reason for the whole list
NOT_RUN=$(sed -n 's/^NOT_RUN=(\(.*\))$/\1/p' "$REPO/tools/ci/local-proof.sh")
check "the script names the files it leaves out" test -n "$NOT_RUN"
for f in $NOT_RUN; do
  has "a change of $f alone: the short list, for the old reason" "$(tried "$f")" "5 baselines (nothing an update runs through changed since b7)"
  has "a change of $f and of tools/ci/new.sh: the whole list, for the file that counts" "$(tried "$f" tools/ci/new.sh)" "8 baselines (tools/ci/new.sh changed since b7;"
  has "a change of $f and of a migration: the whole list" "$(tried "$f" apps/server/migrations/0002_more.sql)" "8 baselines (apps/server/migrations/0002_more.sql changed since b7;"
  has "the same name in another folder of tools/ci counts" "$(tried "tools/ci/sub/${f##*/}")" "8 baselines (tools/ci/sub/${f##*/} changed since b7;"
  has "a file that only starts with the name counts" "$(tried "$f.bak")" "8 baselines ($f.bak changed since b7;"
done
has "all the named files together: the short list" "$(tried $NOT_RUN)" "5 baselines (nothing an update runs through changed since b7)"
has "the other files of tools/ci still count: lib.sh" "$(tried tools/ci/lib.sh)" "8 baselines (tools/ci/lib.sh changed since b7;"
has "so does a script an update runs, with the named ones changed too" "$(tried tools/ci/upgrade-run.sh $NOT_RUN)" "8 baselines (tools/ci/upgrade-run.sh changed since b7;"
# the list stays honest: a name is no file that an install or a leg of the proof runs or mentions
for f in $NOT_RUN; do
  hits=$(cd "$REPO" && { grep -rlF "${f##*/}" scripts Dockerfile docker-compose*.yml tools/ci/proof-drills.sh tools/ci/upgrade-run.sh tools/ci/drills.sh tools/ci/smoke-image.sh tools/ci/verify-release.sh 2>/dev/null
    [[ $(grep -vF "NOT_RUN" tools/ci/local-proof.sh | grep -cF "${f##*/}") -eq 0 ]] || echo tools/ci/local-proof.sh; } | tr '\n' ' ')
  check "$f is read by nothing an update or the proof runs (else take the name off NOT_RUN in tools/ci/local-proof.sh)" test -z "$hits"
  [[ -z $hits ]] || echo "       read by: $hits"
done
has "a last ref that is no commit: the whole list" "$(proof --proved ghost.txt)" "2 baselines (no diff from nope, the last of the list, could be read;"

# ── the whole list, two at a time ──
reset
out=$(proof --jobs 2 --all baselines.txt); rc=$?
check "--all exits 0" test $rc -eq 0
has "--all takes the whole list" "$out" "8 baselines (--all: every baseline of the list runs, none is left out), 2 at a time."
check "--all stamps the whole list" test "$(stamp | tail -1)" = "b0 b1 b2 b3 b4 b5 b6 b7"
has "two lanes: a movable baseline in the second" "$(calls)" "rehearsal b2 port=8081 project=proof-1 "
has "two lanes: a movable baseline in the first, on the defaults" "$(calls)" "rehearsal b6 port= project= "
has "and the first baseline is in lane 0 like any other" "$(calls)" "rehearsal b0 port= project= "
lacks "two lanes: no third" "$(calls)" "port=8082"
out=$(proof --proved baselines.txt); rc=$?
check "the stamp of the whole list proves the short list too" test $rc -eq 0

# ── a change of a host script: every baseline, four at a time, no port and no project shared ──
echo 'echo more' >>"$R/scripts/install.sh"; commit "$R" "a host script"
reset
echo 4 >"$PLAY/gate"
mkfifo "$PLAY/gate.fifo"
exec 9<>"$PLAY/gate.fifo" # held open, so that no end of it waits for the other
out=$(proof --jobs 4 baselines.txt); rc=$?
exec 9>&-
check "the proof of the whole list exits 0" test $rc -eq 0
has "the first line names the file that changed" "$out" "8 baselines (scripts/install.sh changed since b7; the 8 baselines of the list are 8 update paths, and the newest of each runs), 4 at a time."
check "four rehearsals were inside at once" test "$(head -4 "$PLAY/inside" | sort | tr '\n' ' ')" = "b0 b2 b3 b4 "
lacks "no two rehearsals inside at once had one port or one project" "$(calls)" "CLASH"
has "a baseline with fixed names runs on the defaults" "$(calls)" "rehearsal b1 port= project= keep= work=upgrade-b1 "
has "lane 1 has a port and a project of its own" "$(calls)" "rehearsal b2 port=8081 project=proof-1 keep= work=upgrade-b2 "
has "lane 2 too" "$(calls)" "rehearsal b3 port=8082 project=proof-2 keep= work=upgrade-b3 "
has "lane 3 too" "$(calls)" "rehearsal b4 port=8083 project=proof-3 keep= work=upgrade-b4 "
has "the next baseline goes to the lane with the fewest" "$(calls)" "rehearsal b5 port=8081 project=proof-1 "
has "the newest baseline runs on the defaults, though it could move, and leaves its install up" "$(calls)" "rehearsal b7 port= project= keep=1 "
check "every rehearsal has a work folder of its own" test "$(grep '^rehearsal ' "$CALLS" | sed 's/.* work=\([^ ]*\) .*/\1/' | sort -u | wc -l)" -eq 8
check "the drills run when every other leg has ended (no user for them), the last of them on the install of their own" test "$(tail -1 "$CALLS" | cut -c1-23)" = "drills work=own install"
lacks "no drills install clashed with a lane in port or project" "$(calls)" "CLASH"
check "the stamp has every baseline" test "$(stamp | tail -1)" = "b0 b1 b2 b3 b4 b5 b6 b7"

reset
out=$(proof --jobs 1 baselines.txt); rc=$?
has "--jobs 1 says so" "$out" "1 at a time."
check "--jobs 1: every rehearsal on the defaults" test $rc -eq 0 -a "$(called '^rehearsal .* port= project= ')" -eq 8
lacks "--jobs 1: one at a time" "$(calls)" "CLASH"
check "--jobs 1: the image and the smoke test come before the first rehearsal" test "$(grep -n '^smoke ' "$CALLS" | cut -d: -f1)" -lt "$(grep -n '^rehearsal ' "$CALLS" | head -1 | cut -d: -f1)"

reset
out=$(PROOF_JOBS=1 proof baselines.txt); rc=$?
has "PROOF_JOBS=1 says so" "$out" "1 at a time."
check "PROOF_JOBS=1: every rehearsal on the defaults" test $rc -eq 0 -a "$(called '^rehearsal .* port= project= ')" -eq 8
reset
out=$(PROOF_JOBS=1 proof --jobs 2 baselines.txt)
has "the flag wins over PROOF_JOBS" "$out" "2 at a time."
reset
out=$(PROOF_JOBS='' proof baselines.txt)
has "an empty PROOF_JOBS is the default" "$out" "3 at a time."
# without a flag the lanes come from the CPUs: one for every 4, at least 4, at most the rehearsals
lanes() { local cpus=$1; shift; reset; echo "$cpus" >"$PLAY/cpus"; proof "$@" | sed -n 1p; }
has "28 CPUs: no more than 3 lanes side by side" "$(lanes 28 baselines.txt)" "8 baselines (scripts/install.sh changed since b7; the 8 baselines of the list are 8 update paths, and the newest of each runs), 3 at a time."
has "100 CPUs: still 3" "$(lanes 100 baselines.txt)" "8 baselines (scripts/install.sh changed since b7; the 8 baselines of the list are 8 update paths, and the newest of each runs), 3 at a time."
has "PROOF_MAX_LANES raises the cap" "$(PROOF_MAX_LANES=7 lanes 28 baselines.txt)" "7 at a time."
has "PROOF_MAX_LANES never gives more lanes than rehearsals" "$(PROOF_MAX_LANES=20 lanes 100 baselines.txt)" "8 at a time."
has "a small machine gets 3" "$(lanes 4 baselines.txt)" "3 at a time."
has "a list of two rehearsals gets two lanes" "$(lanes 28 two.txt)" "2 baselines (scripts/install.sh changed since b7; the 2 baselines of the list are 2 update paths, and the newest of each runs), 2 at a time."
has "a machine that cannot count its CPUs gets 3" "$(lanes none baselines.txt)" "3 at a time."
has "PROOF_JOBS from a cut on a big machine is capped as well" "$(PROOF_JOBS=7 lanes 28 baselines.txt)" "3 at a time."
has "the flag is not capped" "$(lanes 28 --jobs 5 baselines.txt)" "5 at a time."
reset
out=$(echo 28 >"$PLAY/cpus"; PROOF_JOBS=3 proof baselines.txt)
has "PROOF_JOBS wins over the CPUs" "$out" "3 at a time."

# ── a leg that fails ──
reset
touch "$PLAY/fail-b6" "$PLAY/fail-compat-b5"
out=$(proof baselines.txt); rc=$?
check "a failed leg: exit 1" test $rc -eq 1
has "the line of the failed leg names its log" "$out" "FAILED  upgrade from b6 ("
has "the log is the one of that leg" "$out" " s): $(logs)/upgrade-b6.log"
check "and the log holds what the leg said" grep -q "the b6 leg broke" "$(logs)/upgrade-b6.log"
has "the end says how many failed and that nothing is stamped" "$out" "local proof FAILED for $(short): 2 of 14 legs. Nothing is stamped."
has "the end names each failed leg with its log" "$out" "  upgrade-b5: $(logs)/upgrade-b5.log"
has "and shows the end of the log" "$out" "    the b6 leg broke"
has "a baseline that fails a check before the rehearsal is a failed leg" "$out" "FAILED  upgrade from b5 ("
lacks "and its rehearsal does not run" "$(calls)" "rehearsal b5 "
has "the other rehearsals still ran" "$out" "ok      upgrade from b7 ("
has "and the drills" "$out" "ok      drills 3, 4, 7, 8 ("
has "the list that closes the proof is there for a red proof too, before its verdict" "$out" "where the time went, the longest first:"
check "no stamp after a failure" test -z "$(stamp)"
rm "$PLAY"/fail-*; : >"$CALLS"
out=$(proof baselines.txt); rc=$?
check "after the fix the same command proves the commit" test $rc -eq 0 -a -n "$(stamp)"
check "and runs again only what had no verdict: b5, b6 and the newest, which leaves the install for the drills" test "$(called '^rehearsal ')" -eq 3
has "the others say cached" "$out" "ok      upgrade from b0 ("
has "with the word after the seconds" "$out" " s), cached"

reset
touch "$PLAY/fail-b0"
out=$(proof baselines.txt); rc=$?
has "the first baseline failed: a failed leg of its own" "$out" "FAILED  upgrade from b0 ("
has "and the drills, which stand on installs of their own, ran" "$out" "ok      drills 3, 4, 7, 8 ("
check "one leg failed, and the exit is 1" test $rc -eq 1 -a "$(called '^drills ')" -eq 2
has "one leg failed" "$out" "1 of 14 legs."

reset
touch "$PLAY/fail-b7"
out=$(proof baselines.txt); rc=$?
has "the newest rehearsal failed: a failed leg" "$out" "FAILED  upgrade from b7 ("
has "and the helper's drills, which stand on its install, are a failed leg that did not run" "$out" "FAILED  drills 3, 4, 7, 8: not run, the rehearsal from b7 that they stand on failed"
check "and did not run" test "$(called '^drills work=upgrade-b7')" -eq 0
has "the other drills ran on their own install" "$out" "ok      drills 1, 2, 5, 6, 9, 10 ("
has "two legs failed" "$out" "2 of 14 legs."
check "the log of the drills that did not run says why" grep -q "not run: the rehearsal from b7 that they stand on failed" "$(logs)/drills-default.log"

reset
touch "$PLAY/fail-install-drills"
out=$(proof baselines.txt); rc=$?
has "the install of the drills that fails is a failed leg" "$out" "FAILED  install for drills 1, 2, 5, 6, 9, 10 ("
has "its drills are a failed leg that did not run" "$out" "FAILED  drills 1, 2, 5, 6, 9, 10: not run, the install they stand on failed"
check "and did not run" test "$(called '^drills work=own')" -eq 0
has "the helper's drills ran on the default install" "$out" "ok      drills 3, 4, 7, 8 ("
check "exit 1, two legs, no stamp" test $rc -eq 1 -a -z "$(stamp)"
has "two legs failed" "$out" "2 of 14 legs."
check "the log of the drills that did not run says why" grep -q "not run: the install they stand on failed" "$(logs)/drills-own.log"

reset
touch "$PLAY/fail-signature" "$PLAY/fail-drills"
out=$(proof baselines.txt); rc=$?
has "a failed signature is a failed leg" "$out" "FAILED  signature of the newest release ("
has "failed drills are a failed leg" "$out" "FAILED  drills 3, 4, 7, 8 ("
has "of either install" "$out" "FAILED  drills 1, 2, 5, 6, 9, 10 ("
check "and the exit is 1 with no stamp" test $rc -eq 1 -a -z "$(stamp)"

reset
touch "$PLAY/cached-signature"
out=$(proof baselines.txt); rc=$?
check "a cached signature passes" test $rc -eq 0
has "the leg's line says cached" "$out" "ok      signature of the newest release ("
has "with the word after the seconds" "$out" " s), cached"
reset
out=$(proof baselines.txt)
lacks "a signature that ran in full does not say cached" "$out" ", cached"
reset
touch "$PLAY/fail-drills-own"
out=$(proof baselines.txt); rc=$?
has "drills that fail on their own install only: the helper's passed" "$out" "ok      drills 3, 4, 7, 8 ("
has "and the others are red" "$out" "FAILED  drills 1, 2, 5, 6, 9, 10 ("
check "with one leg failed" test $rc -eq 1 -a "$(grep -c '^FAILED' <<<"$out")" -eq 1

# no baseline of the proof can take a port and a name: the drills' own install cannot be made
printf '%s\n' b0 b1 >"$R/fixed.txt"; commit "$R" "a list of baselines that cannot move"
reset
out=$(proof fixed.txt); rc=$?
has "only baselines with fixed names: the drills of their own are a failed leg" "$out" "FAILED  drills 1, 2, 5, 6, 9, 10: not run, no baseline of this proof reads a port and a name"
check "no install was made, the rehearsals ran, the helper's drills ran on the default install, the exit is 1" test $rc -eq 1 -a "$(called '^drill-install ')" -eq 0 -a "$(called '^rehearsal ')" -eq 2 -a "$(called '^drills ')" -eq 1

reset
touch "$PLAY/fail-image"
out=$(proof --jobs 1 baselines.txt); rc=$?
has "one job, an image that does not build" "$out" "FAILED  the image builds ("
has "stops the proof" "$out" "1 of 14 legs. The other legs did not run. Nothing is stamped."
check "before any other leg" test $rc -eq 1 -a "$(called '^smoke\|^rehearsal\|^signature\|^drill')" -eq 0 -a -z "$(stamp)"
reset
touch "$PLAY/fail-smoke"
out=$(proof --jobs 1 baselines.txt); rc=$?
has "one job, a failed smoke test" "$out" "FAILED  smoke test of the image ("
check "stops the proof too" test $rc -eq 1 -a "$(called '^rehearsal\|^signature\|^drill')" -eq 0 -a -z "$(stamp)"

# The image is built while the rehearsals run. This image build stays until a rehearsal is inside; that rehearsal holds,
# and the image then fails, so the proof is red with a rehearsal in the middle of its work.
reset
touch "$PLAY/fail-image" "$PLAY/image-waits" "$PLAY/meet-image" "$PLAY/hold-meeting"
mkfifo "$PLAY/meet.fifo" "$PLAY/never"
out=$(proof baselines.txt); rc=$?
has "an image that fails beside the rehearsals" "$out" "FAILED  the image builds ("
check "a rehearsal was inside when it failed, and got the stop" test "$(called '^stopped meeting')" -eq 1
has "the cut rehearsal is a stopped leg" "$out" "stopped upgrade from "
lacks "and not a failed one" "$out" "FAILED  upgrade from"
has "the end says what was cut" "$out" "1 of 14 legs. The legs still running were stopped, and the drills did not run. Nothing is stamped."
check "the drills did not run, nor their installs, nothing is stamped, the exit is 1" test $rc -eq 1 -a "$(called '^drill')" -eq 0 -a -z "$(stamp)"
check "the image build ended after a rehearsal began" test "$(grep -n '^rehearsal ' "$CALLS" | head -1 | cut -d: -f1)" -lt "$(grep -n '^image-end' "$CALLS" | cut -d: -f1)"
check "no clone and no install is left" test ! -e "$(dirname "$(logs)")/src" -a -z "$(ls -d "$(dirname "$(logs)")"/upgrade-* 2>/dev/null)"

# The same meeting with a good image: the image build and a rehearsal are in at once, and the proof passes.
reset
touch "$PLAY/image-waits" "$PLAY/meet-image"
mkfifo "$PLAY/meet.fifo"
out=$(proof baselines.txt); rc=$?
check "an image built while a rehearsal runs: the proof passes" test $rc -eq 0 -a -n "$(stamp)"
check "the image build ended after a rehearsal began" test "$(grep -n '^rehearsal ' "$CALLS" | head -1 | cut -d: -f1)" -lt "$(grep -n '^image-end' "$CALLS" | cut -d: -f1)"
check "the drills still ran last" test "$(tail -1 "$CALLS" | cut -d" " -f1)" = drills
reset
touch "$PLAY/fail-smoke"
out=$(proof baselines.txt); rc=$?
has "a failed smoke test beside the rehearsals" "$out" "FAILED  smoke test of the image ("
check "is red, with no drills and no stamp" test $rc -eq 1 -a "$(called '^drill')" -eq 0 -a -z "$(stamp)"
lacks "and no rehearsal is called failed" "$out" "FAILED  upgrade from"

# ── a leg whose shell is lost leaves no line: the proof is not green ──
reset
touch "$PLAY/kill-ppid-drills-own"
out=$(proof baselines.txt); rc=$?
check "drills whose shell was killed: the proof is red, with the count" test $rc -eq 1 -a "$(grep -c '^local proof FAILED for .*: 13 of 14 legs reported ok, the others ended without a result. Nothing is stamped.$' <<<"$out")" -eq 1
check "and nothing is stamped" test -z "$(stamp)"
lacks "no 'passed' line" "$out" "local proof passed"
reset
touch "$PLAY/kill-ppid-b5"
out=$(proof baselines.txt); rc=$?
check "a rehearsal whose lane was killed: red too, nothing stamped" test $rc -eq 1 -a -z "$(stamp)" -a "$(grep -c 'legs reported ok, the others ended without a result' <<<"$out")" -eq 1
lacks "and no 'passed' line" "$out" "local proof passed"

# ── what a killed proof left of the drills' install is removed at the start, and nothing else ──
reset
printf '%s\n' c1 c2 >"$PLAY/left-ps"; printf '%s\n' v1 >"$PLAY/left-volumes"; printf '%s\n' c1 c2 v1 drill-disk drills:latest >"$PLAY/left"
mkdir -p "$TMP/work/local-proof.old/drills/own"
out=$(proof baselines.txt); rc=$?
has "the next proof says it" "$out" "removed 6 things that an earlier proof left of the drills' install"
has "the containers of the drills' project are removed" "$(calls)" "docker rm -f -v c1"
has "all of them" "$(calls)" "docker rm -f -v c2"
has "so is the volume" "$(calls)" "docker volume rm -f v1"
has "and drill 5's container" "$(calls)" "docker rm -f -v drill-disk"
has "and the image of the project" "$(cat "$PLAY/images")" "docker rmi -f drills:latest"
check "and the drills folder of the earlier work folder" test ! -e "$TMP/work/local-proof.old/drills"
has "the containers are asked for by the label of the project only" "$(calls)" "docker ps -aq --filter label=com.docker.compose.project=drills"
lacks "the default install and the lanes' are not looked at" "$(grep '^docker ' "$CALLS")" "proof-"
lacks "nor removed" "$(calls)" "docker rm -f -v banking-app"
check "the proof goes on and passes" test $rc -eq 0 -a -n "$(stamp)"
reset
out=$(proof baselines.txt)
lacks "a clean machine: nothing to remove, nothing said" "$out" "an earlier proof left"

# ── one proof at a time: a second one removes nothing ──
reset
mkdir -p "$TMP/work/local-proof.old/drills/own"
exec 7>"$TMP/work/local-proof-running.lock"
flock 7
out=$(proof baselines.txt); rc=$?
exec 7>&-
check "a proof beside a running one ends at once with exit 2" test $rc -eq 2
has "and names the lock and says a proof is running" "$out" "Another local proof is running on this machine ($TMP/work/local-proof-running.lock is held)"
check "it removed nothing: the other proof's drills folder is there, and Docker was not asked to remove" test -d "$TMP/work/local-proof.old/drills/own" -a "$(called '^docker rm\|^docker volume rm\|^docker ps')" -eq 0
check "it stamped nothing and started no leg" test -z "$(stamp)" -a "$(called '^smoke\|^rehearsal\|^drill')" -eq 0
reset
out=$(proof baselines.txt); rc=$?
check "the lock is let go when a proof ends: the next one runs" test $rc -eq 0 -a -n "$(stamp)"

# ── drills 3 and 4 wait for the drills' install, but not for ever ──
reset
touch "$PLAY/root" "$PLAY/orphan"
mkfifo "$PLAY/never"
out=$(PROOF_SETUP_WAIT=0.3 proof baselines.txt); rc=$?
[[ ! -s $PLAY/orphan.pid ]] || kill "$(<"$PLAY/orphan.pid")" 2>/dev/null
has "a lock still held after the wait: the helper's drills are a failed leg that names the lock" "$out" "FAILED  drills 3, 4, 7, 8: not run, the drills' install did not finish: "
has "with the time it waited" "$out" "setup.lock is still held after 0.3 s"
check "the proof is red, nothing is stamped, and the helper's drills never ran" test $rc -eq 1 -a -z "$(stamp)" -a "$(called '^drills work=upgrade-b7')" -eq 0
has "the other drills ran" "$out" "ok      drills 1, 2, 5, 6, 9, 10 ("
# a lane whose shell is lost after the newest rehearsal: its install is taken down by the end of the proof
reset
touch "$PLAY/root" "$PLAY/kill-ppid-drills-default"
out=$(proof baselines.txt); rc=$?
check "drills 3 and 4 cut off with their install up: red" test $rc -eq 1 -a -z "$(stamp)"
has "and the install they stood on is taken down at the end" "$(calls)" "setpriv --reuid=2 --regid=2 --groups=999 env HOME=home -> docker"$'\n'"docker compose down -v"

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
