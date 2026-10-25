#!/usr/bin/env bash
# More tests for tools/ci/local-proof.sh, in the stand-in world of tools/test/local-proof-world.sh (see local-proof.test.sh): the
# files only one leg runs, the niceness of the legs, the verdicts of rehearsals that passed, and the red leg that stops
# the proof. A file in the folder `play` changes what a stub does; where two processes must meet, they meet on a FIFO.
#
#   tools/test/local-proof-legs.test.sh
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
export PROOF_KEEP_GOING=1 # the section "one red leg" asks for the default itself

tried() { # tried FILE...: what the rule says of a commit that changes FILE...
  local f
  for f in "$@"; do mkdir -p "$R/$(dirname "$f")"; echo change >>"$R/$f"; done
  commit "$R" "a change"
  proof --proved baselines.txt
  git -C "$R" reset -q --hard HEAD~1
}

# ── the signature leg's own file: a change of it alone is no reason for the whole list (0.63.0 ran 25 baselines for it) ──
reset
LEG_ONLY=$(sed -n 's/^LEG_ONLY=(\(.*\))$/\1/p' "$REPO/tools/ci/local-proof.sh")
check "the script names the files only the signature leg runs" test -n "$LEG_ONLY"
for f in $LEG_ONLY; do
  has "a change of $f alone: the short list" "$(tried "$f")" "5 baselines (nothing an update runs through changed since b7)"
  has "a change of $f and of a script an update runs: the whole list" "$(tried "$f" scripts/update.sh)" "8 baselines (scripts/update.sh changed since b7;"
  has "the same name in another folder counts" "$(tried "tools/ci/sub/${f##*/}")" "8 baselines (tools/ci/sub/${f##*/} changed since b7;"
  hits=$(cd "$REPO" && grep -rlF "${f##*/}" scripts Dockerfile docker-compose*.yml tools/ci/proof-drills.sh tools/ci/upgrade-run.sh tools/ci/drills.sh tools/ci/smoke-image.sh tools/ci/check-migrations.sh tools/ci/compose-compat.sh 2>/dev/null | tr '\n' ' ')
  check "$f is read by no install and no rehearsal (else take it off LEG_ONLY)" test -z "$hits"
  [[ -z $hits ]] || echo "       read by: $hits"
  legs=$(cd "$REPO" && grep -F "${f##*/}" tools/ci/local-proof.sh | grep -v '^ *#' | grep -vF LEG_ONLY)
  case ${f##*/} in image-checks.sh) leg=container ;; *) leg=signature ;; esac
  check "the proof starts $f in the $leg leg and nowhere else" test "$(wc -l <<<"$legs")" -eq 1 -a "$legs" != "${legs/leg $leg /}"
done

# ── the layers and the niceness ──
reset
out=$(proof baselines.txt)
lacks "the image build uses the layer cache" "$(calls)" "--no-cache"
want=$(($(nice) + 10)); ((want <= 19)) || want=19
check "every rehearsal runs at nice 10 more than the proof" test "$(called "^nice rehearsal .* $want\$")" -eq 5
check "so does the drills' install" test "$(called "^nice drill-install .* $want\$")" -eq 1
reset
out=$(PROOF_NICE=3 proof baselines.txt)
want=$(($(nice) + 3))
check "PROOF_NICE sets it" test "$(called "^nice rehearsal .* $want\$")" -eq 5

# ── verdicts: a rehearsal that passed is not run again for the same tree and the same baseline ──
reset
out=$(proof baselines.txt); rc=$?
check "the first proof runs the five rehearsals" test $rc -eq 0 -a "$(called '^rehearsal ')" -eq 5
check "and notes four verdicts: the newest rehearsal leaves its install for the drills, so it is none" test "$(wc -l <"$R/.git/local-proof-verdicts")" -eq 4
lacks "the first proof has no cached rehearsal" "$out" ", cached"
rm "$R/.git/local-proof"; : >"$CALLS"
out=$(proof baselines.txt); rc=$?
check "the same tree again (no stamp): exit 0" test $rc -eq 0
check "only the newest rehearsal runs again" test "$(called '^rehearsal ')" -eq 1 -a "$(called '^rehearsal b7 ')" -eq 1
for b in b0 b3 b5 b6; do has "$b is taken from the verdict" "$out" "ok      upgrade from $b ("; done
check "four lines say cached" test "$(grep -c ', cached$' <<<"$out")" -eq 4
check "the check of migrations did not run for a cached one" test "$(called '^check-migrations ')" -eq 1
check "the drills ran as always, the stamp is made" test "$(called '^drills ')" -eq 2 -a -n "$(stamp)"
rm "$R/.git/local-proof"; : >"$CALLS"
out=$(PROOF_FRESH=1 proof baselines.txt)
check "PROOF_FRESH=1 runs every rehearsal again" test "$(called '^rehearsal ')" -eq 5
lacks "and says no cached" "$out" ", cached"
# any changed byte of the tree is another key: the doc is outside what an update runs through, so the list stays short
echo changed >>"$R/docs/notes.md"; commit "$R" "a doc"
: >"$CALLS"
out=$(proof baselines.txt)
check "a changed tree: every rehearsal runs again" test "$(called '^rehearsal ')" -eq 5
lacks "and none is cached" "$out" ", cached"
# a changed release script is a changed tree
mkdir -p "$R/tools/release"; echo 'echo cut' >"$R/tools/release/release.sh"; commit "$R" "a release script"
out=$(proof baselines.txt)
: >"$CALLS"
echo 'echo cut again' >"$R/tools/release/release.sh"; commit "$R" "a changed release script"
out=$(proof baselines.txt)
check "a changed release.sh: every rehearsal runs again" test "$(called '^rehearsal ')" -eq 5
# a red rehearsal leaves no verdict; the green ones stay
reset
touch "$PLAY/fail-b6"
out=$(proof baselines.txt); rc=$?
check "a red rehearsal: exit 1" test $rc -eq 1
check "its verdict is not noted, the green ones are" test "$(wc -l <"$R/.git/local-proof-verdicts")" -eq 3
rm "$PLAY/fail-b6"; : >"$CALLS"
out=$(proof baselines.txt); rc=$?
check "after the fix only b6 and the newest run again" test $rc -eq 0 -a "$(called '^rehearsal ')" -eq 2 -a "$(called '^rehearsal b6 ')" -eq 1
has "b6 ran in full" "$out" "ok      upgrade from b6 ("
# another baseline commit is another key
git -C "$R" tag b3-moved b2
printf '%s\n' b0 '# the first public release' b3-moved b5 b6 b7 >"$R/moved.txt"; commit "$R" "a list with another commit in the place of b3"
reset
out=$(proof baselines.txt)
: >"$CALLS"
out=$(proof moved.txt)
check "a baseline of another commit runs again" test "$(called '^rehearsal b3-moved ')" -eq 1
git -C "$R" tag -d b3-moved >/dev/null

# ── one red leg stops the proof ──
reset
touch "$PLAY/hold-b5" "$PLAY/fail-late-b3"
mkfifo "$PLAY/started" "$PLAY/never" "$PLAY/late.fifo"
exec 9<>"$PLAY/started" 7<>"$PLAY/late.fifo"
(cd "$TMP" && TMPDIR=$TMP/work PATH=$BIN:$PATH PROOF_KEEP_GOING=0 exec "$R/tools/ci/local-proof.sh" baselines.txt >"$TMP/out" 2>&1) &
pid=$!
(read -r _ <&9) &
reader=$!
wait -n "$pid" "$reader" # b5 holds inside, or the proof ended without it
echo go >&7              # now b3 fails
wait "$pid"; rc=$?
kill "$reader" 2>/dev/null; wait "$reader" 2>/dev/null
exec 9>&- 7>&-
out=$(<"$TMP/out")
check "one red rehearsal while another runs: exit 1" test $rc -eq 1
has "the red one is a failed leg" "$out" "FAILED  upgrade from b3 ("
has "the one that ran beside it is cut, and is a stopped leg" "$out" "stopped upgrade from b5 ("
check "and got the stop" test "$(called '^stopped b5')" -eq 1
lacks "b6, which came after b3 in its lane, did not start" "$(calls)" "rehearsal b6 "
lacks "and no drills ran" "$(calls)" "drills work="
has "the end says one leg failed and that the others were stopped" "$out" "1 of 12 legs. The legs still running were stopped, and the drills did not run. Nothing is stamped."
check "nothing is stamped and no clone is left" test -z "$(stamp)" -a ! -e "$(dirname "$(logs)")/src"
reset
touch "$PLAY/fail-b0"
out=$(PROOF_KEEP_GOING=0 proof --jobs 1 baselines.txt); rc=$?
has "one job, a red first rehearsal" "$out" "FAILED  upgrade from b0 ("
check "no other rehearsal started, no drills ran, exit 1, no stamp" test $rc -eq 1 -a "$(called '^rehearsal ')" -eq 1 -a "$(called '^drill')" -eq 0 -a -z "$(stamp)"
has "the end says so" "$out" "The legs still running were stopped, and the drills did not run."
reset
touch "$PLAY/fail-signature"
out=$(PROOF_KEEP_GOING=0 proof baselines.txt); rc=$?
has "a red signature fails the proof too" "$out" "FAILED  signature of the newest release ("
check "exit 1, no stamp" test $rc -eq 1 -a -z "$(stamp)"
reset
touch "$PLAY/fail-b0" "$PLAY/fail-signature"
out=$(proof --jobs 1 baselines.txt)
has "PROOF_KEEP_GOING=1 lets the others finish: the rehearsals after the red one ran" "$out" "ok      upgrade from b7 ("
has "and a second red is shown" "$out" "FAILED  signature of the newest release ("

# ── PROOF_BUILD_CA: every leg's docker trusts the CA in its build stage (tools/ci/build-ca.sh); unset, docker is docker ──
reset
proof two.txt >/dev/null
lacks "unset: the image leg's build is docker's own" "$(calls)" "--build-context"
echo 'the proxy CA' >"$TMP/ca.crt"
reset
out=$(PROOF_BUILD_CA=$TMP/ca.crt proof two.txt); rc=$?
check "a baseline whose Dockerfile has no build stage is refused before anything runs (exit 2)" test $rc -eq 2
has "the refusal names its commit" "$out" "has no 'FROM ... AS build' stage, so PROOF_BUILD_CA cannot reach its build."
lacks "no leg ran" "$(calls)" "image-end"
reset
out=$(PROOF_BUILD_CA=$TMP/nowhere proof two.txt); rc=$?
check "a CA that is no file is refused (exit 2)" test $rc -eq 2
has "and named" "$out" "PROOF_BUILD_CA names no file that can be read: $TMP/nowhere"
BEFORE=$(git -C "$R" rev-parse HEAD)
printf '%s\n' 'FROM scratch AS build' 'FROM scratch' >"$R/Dockerfile"
echo 'said "docker of the rehearsal $1: $(command -v docker) curl=$CURL_CA_BUNDLE"' >>"$R/tools/ci/upgrade-run.sh"
commit "$R" "a build stage"; git -C "$R" tag s1
printf '%s\n' s1 >"$R/ca.txt"; commit "$R" "the list of a build stage"
for v in PROOF_BUILD_CA AUDIT_BUILD_CA; do
  reset
  out=$(export "$v=$TMP/ca.crt" CURL_CA_BUNDLE=$TMP/ca.crt; proof ca.txt); rc=$?
  check "$v: the proof passes" test $rc -eq 0
  has "$v: the image leg reads its Dockerfile from stdin with the CA as the context ca" "$(calls)" "docker build -t banking-app:ci -f - --build-context ca=$TMP/work/"
  has "$v: a rehearsal's docker is the one of the CA" "$(calls)" "docker of the rehearsal s1: $TMP/work/local-proof."
  has "$v: from the proof's own folder" "$(grep 'docker of the rehearsal' "$CALLS")" "/build-ca/docker curl="
  has "$v: a variable that named the CA names the copy the legs' users can read" "$(grep 'docker of the rehearsal' "$CALLS")" "/build-ca/build-ca.crt"
done
reset
out=$(unset PROOF_BUILD_CA AUDIT_BUILD_CA; proof ca.txt); rc=$?
check "no CA: the proof passes" test $rc -eq 0
has "no CA: a rehearsal's docker is the proof's all the same, which builds no image with its tests" "$(grep 'docker of the rehearsal' "$CALLS")" "/build-ca/docker curl="
lacks "no CA: the image leg's build is docker's own" "$(calls)" "--build-context"
git -C "$R" reset -q --hard "$BEFORE"; git -C "$R" tag -d s1 >/dev/null

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
