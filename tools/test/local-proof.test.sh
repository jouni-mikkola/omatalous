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

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
R=$TMP/repo
BIN=$TMP/bin
PLAY=$TMP/play
CALLS=$TMP/calls
export PROOF_CALLS=$CALLS PROOF_PLAY=$PLAY
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
stub() { cat >"$1"; chmod +x "$1"; }
commit() { git -C "$1" add -A && git -C "$1" commit -q -m "$2"; }

# ── the stand-in repository ──
mkdir -p "$R/tools/ci" "$R/scripts" "$R/apps/server/migrations" "$R/docs" "$BIN"
git init -q "$R"
cp "$REPO/tools/ci/local-proof.sh" "$R/tools/ci/"
cat >"$R/tools/ci/play.sh" <<'PLAY_SH'
# shellcheck shell=bash
# what the stand-in legs share
said() { echo "$*" >>"$PROOF_CALLS"; }
# broken NAME: with the file fail-NAME in the play folder, a line for the log and exit 1
broken() { [[ ! -e $PROOF_PLAY/fail-$1 ]] || { echo "the $1 leg broke"; exit 1; }; }
# hold NAME: with the file hold-NAME, say so on the FIFO `started` and stay until TERM comes
hold() {
  [[ -e $PROOF_PLAY/hold-$1 ]] || return 0
  trap 'kill $! 2>/dev/null; said "stopped '"$1"'"; exit 143' TERM
  echo started >"$PROOF_PLAY/started"
  cat "$PROOF_PLAY/never" &
  wait $!
}
PLAY_SH
stub "$R/tools/ci/smoke-image.sh" <<'LEG'
#!/usr/bin/env bash
. "$(dirname "$0")/play.sh"
said "smoke $* cwd=$PWD"
broken smoke
LEG
stub "$R/tools/ci/check-migrations.sh" <<'LEG'
#!/usr/bin/env bash
. "$(dirname "$0")/play.sh"
said "check-migrations $1"
LEG
stub "$R/tools/ci/compose-compat.sh" <<'LEG'
#!/usr/bin/env bash
. "$(dirname "$0")/play.sh"
said "compose-compat $1"
broken "compat-$1"
LEG
stub "$R/tools/ci/verify-release.sh" <<'LEG'
#!/usr/bin/env bash
. "$(dirname "$0")/play.sh"
said "signature cwd=$PWD"
broken signature
LEG
stub "$R/tools/ci/drills.sh" <<'LEG'
#!/usr/bin/env bash
. "$(dirname "$0")/play.sh"
said "drills work=${UPGRADE_WORK##*/} install=$([[ -d $UPGRADE_WORK/talous ]] && echo up || echo missing) cwd=$PWD"
hold drills
broken drills
rm -rf "$UPGRADE_WORK"
LEG
stub "$R/tools/ci/upgrade-run.sh" <<'LEG'
#!/usr/bin/env bash
. "$(dirname "$0")/play.sh"
ref=$1
port=${UPGRADE_PORT:-8080}
project=${UPGRADE_PROJECT:-default}
said "rehearsal $ref port=${UPGRADE_PORT:-} project=${UPGRADE_PROJECT:-} keep=${UPGRADE_KEEP_UP:-} work=${UPGRADE_WORK##*/} home=${HOME##*/} cwd=$PWD"
# two rehearsals inside at once on one port or in one project
mkdir "$PROOF_PLAY/port-$port" 2>/dev/null || said "CLASH port $port ($ref)"
mkdir "$PROOF_PLAY/project-$project" 2>/dev/null || said "CLASH project $project ($ref)"
if [[ -e $PROOF_PLAY/gate ]]; then
  # the first rehearsals stay inside until as many as the file says are inside together
  exec 8>>"$PROOF_PLAY/gate.lock"
  flock 8
  echo "$ref" >>"$PROOF_PLAY/inside"
  n=$(wc -l <"$PROOF_PLAY/inside")
  flock -u 8
  need=$(<"$PROOF_PLAY/gate")
  if ((n < need)); then
    read -r _ <"$PROOF_PLAY/gate.fifo"
  elif ((n == need)); then
    for ((i = 1; i < need; i++)); do echo; done >"$PROOF_PLAY/gate.fifo"
  fi
fi
hold "$ref"
rmdir "$PROOF_PLAY/port-$port" "$PROOF_PLAY/project-$project" 2>/dev/null
broken "$ref"
[[ ${UPGRADE_KEEP_UP:-} != 1 ]] || mkdir -p "$UPGRADE_WORK/talous"
said "rehearsal-end $ref"
LEG
FIXED='services:
  banking:
    image: banking-app:latest
    container_name: banking-app
    ports: ["127.0.0.1:8080:8080"]'
# shellcheck disable=SC2016 # the keys are for Compose, not for this shell
KEYS='services:
  banking:
    image: ${INSTANCE_NAME:-banking-app}:latest
    container_name: ${INSTANCE_NAME:-banking-app}
    ports: ["127.0.0.1:${HOST_PORT:-8080}:8080"]'
echo "$FIXED" >"$R/docker-compose.yml"
echo 'echo install' >"$R/scripts/install.sh"
echo 'FROM scratch' >"$R/Dockerfile"
echo 'CREATE TABLE t (id TEXT);' >"$R/apps/server/migrations/0001_first.sql"
commit "$R" "the first version"; git -C "$R" tag b0
echo 1 >"$R/docs/notes.md"; commit "$R" "b1"; git -C "$R" tag b1
echo "$KEYS" >"$R/docker-compose.yml"; commit "$R" "an install with a port and a name of its own"; git -C "$R" tag b2
for i in 3 4 5 6 7; do echo "$i" >"$R/docs/notes.md"; commit "$R" "b$i"; git -C "$R" tag "b$i"; done
printf '%s\n' '# the oldest supported' b0 b1 '' '# 0.3.0' '  b2  ' '# 0.4.0, the first public release' b3 b4 b5 b5 b6 '# the last release' b7 >"$R/baselines.txt"
printf '%s\n' '# no ref yet' '' >"$R/empty.txt"
printf '%s\n' b0 nope >"$R/ghost.txt"
commit "$R" "the lists"

stub "$BIN/docker" <<'STUB'
#!/usr/bin/env bash
if [[ ${1:-} == build ]]; then echo "docker $* cwd=$PWD" >>"$PROOF_CALLS"; else echo "docker $*" >>"$PROOF_CALLS"; fi
case ${1:-} in
  info) [[ ! -e $PROOF_PLAY/no-docker ]] || exit 1 ;;
  build) [[ ! -e $PROOF_PLAY/fail-image ]] || { echo "the image leg broke"; exit 1; } ;;
esac
exit 0
STUB
stub "$BIN/id" <<'STUB'
#!/usr/bin/env bash
# the user the proof thinks it is: root with the file `root` in the play folder
[[ ${1:-} == -u ]] || exit 1
if [[ -e $PROOF_PLAY/root ]]; then echo 0; else echo 1000; fi
STUB
stub "$BIN/setpriv" <<'STUB'
#!/usr/bin/env bash
# says who it was asked to be and what to start, then starts it as the user of the test
echo "setpriv $1 $2 $3 $4 ${5%%=*}=${5##*/} -> $6" >>"$PROOF_CALLS"
[[ $6 != test || ! -e $PROOF_PLAY/cannot-read ]] || exit 1
shift 3
exec "$@"
STUB
stub "$BIN/chown" <<'STUB'
#!/usr/bin/env bash
echo "chown $*" >>"$PROOF_CALLS"
STUB
stub "$BIN/getent" <<'STUB'
#!/usr/bin/env bash
[[ ! -e $PROOF_PLAY/no-group ]] || exit 2
echo "docker:x:999:"
STUB
# a PATH with only what the proof needs before it refuses, to take one program away
only() { local d=$TMP/$1 c; shift; mkdir -p "$d"; for c in "$@"; do ln -s "$(command -v "$c")" "$d/$c"; done; }
only path-bare bash git dirname
only path-no-setsid bash git dirname; cp "$BIN/docker" "$TMP/path-no-setsid/"
only path-no-setpriv bash git dirname setsid; cp "$BIN/docker" "$BIN/id" "$TMP/path-no-setpriv/"

# proof ARGS: the proof of the stand-in repository, started from another folder
proof() { (cd "$TMP" && TMPDIR=$TMP/work PATH=$BIN:$PATH "$R/tools/ci/local-proof.sh" "$@" 2>&1); }
reset() { rm -rf "$PLAY" "$TMP/work" "$R/.git/local-proof"; mkdir -p "$PLAY" "$TMP/work"; : >"$CALLS"; }
called() { grep -c -- "$1" "$CALLS"; }
calls() { cat "$CALLS"; }
logs() { echo "$TMP"/work/local-proof.*/logs; }
short() { git -C "$R" rev-parse --short=7 HEAD; }
stamp() { cat "$R/.git/local-proof" 2>/dev/null; }

# ── a proof that passes: the short list, as the user that started it ──
reset
echo 'echo DIRTY >>"$PROOF_CALLS"' >>"$R/tools/ci/upgrade-run.sh"
out=$(UPGRADE_PORT=9999 UPGRADE_PROJECT=mine UPGRADE_KEEP_UP=1 UPGRADE_WORK=/nowhere proof baselines.txt); rc=$?
git -C "$R" checkout -q -- tools/ci/upgrade-run.sh
check "a proof whose legs pass exits 0" test $rc -eq 0
has "the first line says how many baselines, why, and where the logs are" "$out" "local proof of $(short): 5 baselines (nothing an update runs through changed since b7), 4 at a time. Logs: $TMP/work/local-proof."
for l in "the image builds" "smoke test of the image" "signature of the newest release" "upgrade from b0" "upgrade from b3" "upgrade from b5" "upgrade from b6" "upgrade from b7" "drills"; do
  has "one line for the leg: $l" "$out" "ok      $l ("
done
for b in b1 b2 b4; do lacks "$b is outside the short list" "$out" "upgrade from $b "; done
has "the last line says what passed" "$out" "local proof passed for $(short) in"
has "and counts the baselines" "$out" "the image, the smoke test, the signature, 5 baselines and the drills. Logs: $(logs)"
check "the stamp names the commit and its baselines" test "$(stamp)" = "$(git -C "$R" rev-parse HEAD)"$'\n'"b0 b3 b5 b6 b7"
check "every leg ran in the clone of the commit" test "$(called "cwd=$TMP/work/local-proof\..*/src\$")" -eq 9
lacks "no leg ran in the checkout" "$(calls)" "cwd=$R"
lacks "what is not committed does not run" "$(calls)" "DIRTY"
has "the image is built from the clone" "$(calls)" "docker build -t banking-app:ci . cwd=$TMP/work/local-proof."
has "the smoke test gets the image" "$(calls)" "smoke banking-app:ci unknown unknown"
check "migrations and compose file are checked for each baseline" test "$(called '^check-migrations ')" -eq 5 -a "$(called '^compose-compat ')" -eq 5
has "the first baseline keeps its install up, on the defaults" "$(calls)" "rehearsal b0 port= project= keep=1 work=upgrade-b0 "
has "the newest baseline runs on the defaults" "$(calls)" "rehearsal b7 port= project= keep= work=upgrade-b7 "
lacks "a port, a project or a work folder of the caller does not reach a leg" "$(calls)" "9999"
check "the first baseline is the last rehearsal" test "$(grep '^rehearsal ' "$CALLS" | tail -1 | cut -d' ' -f2)" = b0
has "the drills are the last leg, on that install" "$(tail -1 "$CALLS")" "drills work=upgrade-b0 install=up "
check "no setpriv and no chown for a user that is not root" test "$(called '^setpriv\|^chown')" -eq 0
check "only the logs stay in the work folder" test "$(ls "$TMP"/work/local-proof.*)" = logs
check "a log for each leg" test "$(ls "$(logs)" | tr '\n' ' ')" = "clone.log drills.log image.log signature.log smoke.log upgrade-b0.log upgrade-b3.log upgrade-b5.log upgrade-b6.log upgrade-b7.log "

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
has "--proved --all counts the whole list" "$out" "is not proved from its 8 baselines (--all)"
echo more >"$R/docs/more.md"; commit "$R" "words"
out=$(proof --proved baselines.txt); rc=$?
check "the stamp of another commit proves nothing" test $rc -eq 1 -a ! -s "$CALLS"

# ── which baselines ──
has "a change outside what an update runs through: the short list" "$out" "5 baselines (nothing an update runs through changed since b7)"
tried() { # tried FILE: what the rule says of a commit that changes FILE
  mkdir -p "$R/$(dirname "$1")"; echo change >>"$R/$1"; commit "$R" "a change"
  proof --proved baselines.txt
  git -C "$R" reset -q --hard HEAD~1
}
for f in apps/server/migrations/0002_more.sql scripts/update.sh docker-compose.yml docker-compose.override.yml Dockerfile tools/ci/new.sh; do
  has "a change of $f: the whole list" "$(tried "$f")" "8 baselines ($f changed since b7)"
done
for f in apps/server/src/app.ts tools/test/some.test.sh scripts.md; do
  has "a change of $f: the short list" "$(tried "$f")" "5 baselines (nothing"
done
has "a last ref that is no commit: the whole list" "$(proof --proved ghost.txt)" "2 baselines (no diff from nope, the last of the list, could be read)"

# ── the whole list, two at a time ──
reset
out=$(proof --jobs 2 --all baselines.txt); rc=$?
check "--all exits 0" test $rc -eq 0
has "--all takes the whole list" "$out" "8 baselines (--all), 2 at a time."
check "--all stamps the whole list" test "$(stamp | tail -1)" = "b0 b1 b2 b3 b4 b5 b6 b7"
has "two lanes: a movable baseline in the second" "$(calls)" "rehearsal b2 port=8081 project=proof-1 "
has "two lanes: a movable baseline in the first, on the defaults" "$(calls)" "rehearsal b4 port= project= "
lacks "two lanes: no third" "$(calls)" "port=8082"
out=$(proof --proved baselines.txt); rc=$?
check "the stamp of the whole list proves the short list too" test $rc -eq 0

# ── a change of a host script: every baseline, four at a time, no port and no project shared ──
echo 'echo more' >>"$R/scripts/install.sh"; commit "$R" "a host script"
reset
echo 4 >"$PLAY/gate"
mkfifo "$PLAY/gate.fifo"
exec 9<>"$PLAY/gate.fifo" # held open, so that no end of it waits for the other
out=$(proof baselines.txt); rc=$?
exec 9>&-
check "the proof of the whole list exits 0" test $rc -eq 0
has "the first line names the file that changed" "$out" "8 baselines (scripts/install.sh changed since b7), 4 at a time."
check "four rehearsals were inside at once" test "$(head -4 "$PLAY/inside" | sort | tr '\n' ' ')" = "b1 b2 b3 b4 "
lacks "no two rehearsals inside at once had one port or one project" "$(calls)" "CLASH"
has "a baseline with fixed names runs on the defaults" "$(calls)" "rehearsal b1 port= project= keep= work=upgrade-b1 "
has "lane 1 has a port and a project of its own" "$(calls)" "rehearsal b2 port=8081 project=proof-1 keep= work=upgrade-b2 "
has "lane 2 too" "$(calls)" "rehearsal b3 port=8082 project=proof-2 keep= work=upgrade-b3 "
has "lane 3 too" "$(calls)" "rehearsal b4 port=8083 project=proof-3 keep= work=upgrade-b4 "
has "the next baseline goes to the lane with the fewest" "$(calls)" "rehearsal b5 port=8081 project=proof-1 "
has "the newest baseline runs on the defaults, though it could move" "$(calls)" "rehearsal b7 port= project= keep= "
check "the first baseline is the last rehearsal, with its install kept" test "$(grep '^rehearsal ' "$CALLS" | tail -1 | cut -d' ' -f2,5)" = "b0 keep=1"
check "every rehearsal has a work folder of its own" test "$(grep '^rehearsal ' "$CALLS" | sed 's/.* work=\([^ ]*\) .*/\1/' | sort -u | wc -l)" -eq 8
has "the drills run when every other leg has ended" "$(tail -1 "$CALLS")" "drills work=upgrade-b0 install=up "
check "the stamp has every baseline" test "$(stamp | tail -1)" = "b0 b1 b2 b3 b4 b5 b6 b7"

reset
out=$(proof --jobs 1 baselines.txt); rc=$?
has "--jobs 1 says so" "$out" "1 at a time."
check "--jobs 1: every rehearsal on the defaults" test $rc -eq 0 -a "$(called '^rehearsal .* port= project= ')" -eq 8
lacks "--jobs 1: one at a time" "$(calls)" "CLASH"

# ── a leg that fails ──
reset
touch "$PLAY/fail-b6" "$PLAY/fail-compat-b5"
out=$(proof baselines.txt); rc=$?
check "a failed leg: exit 1" test $rc -eq 1
has "the line of the failed leg names its log" "$out" "FAILED  upgrade from b6 ("
has "the log is the one of that leg" "$out" " s): $(logs)/upgrade-b6.log"
check "and the log holds what the leg said" grep -q "the b6 leg broke" "$(logs)/upgrade-b6.log"
has "the end says how many failed and that nothing is stamped" "$out" "local proof FAILED for $(short): 2 of 12 legs. Nothing is stamped."
has "the end names each failed leg with its log" "$out" "  upgrade-b5: $(logs)/upgrade-b5.log"
has "and shows the end of the log" "$out" "    the b6 leg broke"
has "a baseline that fails a check before the rehearsal is a failed leg" "$out" "FAILED  upgrade from b5 ("
lacks "and its rehearsal does not run" "$(calls)" "rehearsal b5 "
has "the other rehearsals still ran" "$out" "ok      upgrade from b7 ("
has "and the drills" "$out" "ok      drills ("
check "no stamp after a failure" test -z "$(stamp)"
rm "$PLAY"/fail-*; : >"$CALLS"
out=$(proof baselines.txt); rc=$?
check "after the fix the same command proves the commit" test $rc -eq 0 -a -n "$(stamp)" -a "$(called '^rehearsal ')" -eq 8

reset
touch "$PLAY/fail-b0"
out=$(proof baselines.txt); rc=$?
has "the first baseline failed: the drills are a failed leg" "$out" "FAILED  drills: not run, the rehearsal from b0 that they stand on failed"
check "and do not run" test $rc -eq 1 -a "$(called '^drills')" -eq 0
has "two legs failed" "$out" "2 of 12 legs."

reset
touch "$PLAY/fail-signature" "$PLAY/fail-drills"
out=$(proof baselines.txt); rc=$?
has "a failed signature is a failed leg" "$out" "FAILED  signature of the newest release ("
has "failed drills are a failed leg" "$out" "FAILED  drills ("
check "and the exit is 1 with no stamp" test $rc -eq 1 -a -z "$(stamp)"

reset
touch "$PLAY/fail-image"
out=$(proof baselines.txt); rc=$?
has "an image that does not build" "$out" "FAILED  the image builds ("
has "stops the proof" "$out" "1 of 12 legs. The other legs did not run. Nothing is stamped."
check "before any other leg" test $rc -eq 1 -a "$(called '^smoke\|^rehearsal\|^signature\|^drills')" -eq 0 -a -z "$(stamp)"
reset
touch "$PLAY/fail-smoke"
out=$(proof baselines.txt); rc=$?
has "a failed smoke test" "$out" "FAILED  smoke test of the image ("
check "stops the proof too" test $rc -eq 1 -a "$(called '^rehearsal\|^signature\|^drills')" -eq 0 -a -z "$(stamp)"

# ── started as root ──
reset
touch "$PLAY/root"
out=$(proof baselines.txt); rc=$?
check "root may start it" test $rc -eq 0 -a -n "$(stamp)"
has "the work folder goes to user 1" "$(calls)" "chown -R 1:1 $TMP/work/local-proof."
has "the image is built as user 1 in the group docker, with a home of its own" "$(calls)" "setpriv --reuid=1 --regid=1 --groups=999 env HOME=home -> docker"
has "the smoke test too" "$(calls)" "setpriv --reuid=1 --regid=1 --groups=999 env HOME=home -> tools/ci/smoke-image.sh"
has "the signature too" "$(calls)" "setpriv --reuid=1 --regid=1 --groups=999 env HOME=home -> tools/ci/verify-release.sh"
check "every leg, and the look whether that user can read the clone" test "$(called '^setpriv ')" -eq 13
check "every rehearsal has that home" test "$(called '^rehearsal .* home=home ')" -eq 8
reset
touch "$PLAY/root" "$PLAY/hold-drills"
mkfifo "$PLAY/started" "$PLAY/never"

# stopped ARGS: the proof with a leg that holds (hold-NAME in the play folder), stopped with TERM when that leg is inside
stopped() {
  exec 9<>"$PLAY/started"
  (cd "$TMP" && TMPDIR=$TMP/work PATH=$BIN:$PATH exec "$R/tools/ci/local-proof.sh" "$@" >"$TMP/out" 2>&1) &
  local pid=$! reader
  (read -r _ <&9) &
  reader=$!
  # the leg is inside, or the proof ended without it
  wait -n "$pid" "$reader"
  if kill -0 "$pid" 2>/dev/null; then kill -TERM "$pid"; else kill "$reader" 2>/dev/null; fi
  wait "$pid"; rc=$?
  wait "$reader" 2>/dev/null
  exec 9>&-
  out=$(<"$TMP/out")
}
stopped baselines.txt
check "TERM during the drills: exit 143" test "$rc" -eq 143
has "it says that nothing is proved" "$out" "local proof: stopped, so $(short) is not proved. Logs: $(logs)"
has "the leg got the stop" "$(calls)" "stopped drills"
has "the install the drills stood on is taken down, as user 1" "$(calls)" "setpriv --reuid=1 --regid=1 --groups=999 env HOME=home -> docker"$'\n'"docker compose down -v"
check "a stopped proof stamps nothing and leaves no clone" test -z "$(stamp)" -a ! -e "$(dirname "$(logs)")/src"

reset
touch "$PLAY/hold-b6"
mkfifo "$PLAY/started" "$PLAY/never"
stopped baselines.txt
check "TERM during a rehearsal: exit 143" test "$rc" -eq 143
has "the rehearsal got the stop" "$(calls)" "stopped b6"
lacks "no leg starts after the stop" "$(calls)" "drills"
check "and nothing is stamped" test -z "$(stamp)" -a ! -e "$(dirname "$(logs)")/src"

# ── refusals: exit 2 before anything runs ──
refused() { # refused NAME WORDS ARGS: exit 2 with WORDS, and no leg and no work folder
  local name=$1 words=$2 o r
  shift 2
  o=$("$@"); r=$?
  if [[ $r -eq 2 && $o == *"$words"* && -z $(ls "$TMP/work") ]] && ! grep -q '^docker build\|^smoke\|^rehearsal' "$CALLS"; then pass "$name"; else fail "$name" "exit $r: $o"; fi
}
reset
refused "no list" "Which list of baselines?" proof
refused "two lists" "Give one list of baselines" proof baselines.txt ghost.txt
refused "a list that is not in the commit" "missing.txt is not a file of the commit" proof missing.txt
cp "$R/baselines.txt" "$R/loose.txt"
refused "a list that is only in the working tree" "loose.txt is not a file of the commit" proof loose.txt
rm "$R/loose.txt"
refused "a list with no ref" "empty.txt names no baseline" proof empty.txt
refused "an unknown option" "Unknown option: --fast" proof --fast baselines.txt
refused "--jobs 0" "--jobs needs a number from 1 to 99" proof --jobs 0 baselines.txt
refused "--jobs with a word" "--jobs needs a number from 1 to 99" proof --jobs many baselines.txt
refused "--jobs with nothing" "--jobs needs a number from 1 to 99" proof baselines.txt --jobs
touch "$PLAY/no-docker"
refused "a Docker that does not answer" "Docker does not answer (docker info)" proof baselines.txt
reset
touch "$PLAY/no-group"
out=$(proof baselines.txt); rc=$?
check "a machine with no group docker is fine for a user that is not root" test $rc -eq 0
reset
touch "$PLAY/no-group" "$PLAY/root"
proof_as() { local u=$1; shift; PROOF_USER=$u proof "$@"; }
refused "root on a machine with no group docker" "has no group docker, so user 1234 could not reach Docker" proof_as 1234 baselines.txt
reset
touch "$PLAY/cannot-read" "$PLAY/root"
refused "a work folder the user of the legs cannot read" "User 1 cannot read $TMP/work/local-proof." proof baselines.txt
bare() { (cd "$TMP" && TMPDIR=$TMP/work PATH=$TMP/$1 "$R/tools/ci/local-proof.sh" baselines.txt 2>&1); }
reset
refused "no docker" "docker is not installed." bare path-bare
refused "no setsid" "setsid is not installed." bare path-no-setsid
touch "$PLAY/root"
refused "root with no setpriv" "setpriv is not installed" bare path-no-setpriv
: >"$CALLS"
out=$(proof --help); rc=$?
has "--help prints the usage" "$out" "tools/ci/local-proof.sh [--all] [--jobs N] BASELINES"
check "--help exits 0 and runs nothing" test $rc -eq 0 -a ! -s "$CALLS"

# ── a linked worktree with a commit on no branch ──
reset
git -C "$R" worktree add -q --detach "$TMP/wt" HEAD
echo y >"$TMP/wt/docs/y.md"; commit "$TMP/wt" "on no branch"
out=$(cd "$TMP" && TMPDIR=$TMP/work PATH=$BIN:$PATH "$TMP/wt/tools/ci/local-proof.sh" baselines.txt 2>&1); rc=$?
check "a commit on no branch, in a linked worktree, is proved" test $rc -eq 0
has "its legs ran" "$out" "ok      drills ("
check "the stamp is the worktree's own" test "$(head -1 "$R/.git/worktrees/wt/local-proof" 2>/dev/null)" = "$(git -C "$TMP/wt" rev-parse HEAD)" -a -z "$(stamp)"

# ── the rehearsal: a port and a project of its own ──
U=$TMP/up
W=$TMP/up-work
mkdir -p "$U/tools/ci" "$U/apps/server/src" "$TMP/ubin"
git init -q "$U"
echo "$FIXED" >"$U/docker-compose.yml"; commit "$U" "fixed names"; git -C "$U" tag fixed
# shellcheck disable=SC2016 # the key is for Compose
echo 'services: { banking: { ports: ["127.0.0.1:${HOST_PORT:-8080}:8080"], container_name: banking-app } }' >"$U/docker-compose.yml"
commit "$U" "a port of its own"; git -C "$U" tag half
echo "$KEYS" >"$U/docker-compose.yml"; commit "$U" "a name of its own"; git -C "$U" tag keys
cp "$REPO/tools/ci/upgrade-run.sh" "$REPO/tools/ci/lib.sh" "$U/tools/ci/"
printf 'export const APP_VERSION = "1.2.3";\n' >"$U/apps/server/src/version.ts"
commit "$U" "the version under test"
stub "$TMP/ubin/docker" <<'STUB'
#!/usr/bin/env bash
# no Docker here: `compose up` fails, and every call says which install it would have reached
echo "docker $* | HOST_PORT=${HOST_PORT:-} INSTANCE_NAME=${INSTANCE_NAME:-} COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-} cwd=${PWD##*/}" >>"$PROOF_CALLS"
[[ " $* " != *" up "* ]] || exit 1
STUB
# rehearse REF [NAME=VALUE...]: the real rehearsal from REF, which ends at its first `compose up`
rehearse() {
  local ref=$1
  shift
  rm -rf "$W"; : >"$CALLS"
  (cd "$TMP" && env -u UPGRADE_PORT -u UPGRADE_PROJECT -u UPGRADE_KEEP_UP -u UPGRADE_BUILD_SHIM -u HOST_PORT -u INSTANCE_NAME -u COMPOSE_PROJECT_NAME \
    "$@" UPGRADE_WORK="$W" PATH="$TMP/ubin:$PATH" bash "$U/tools/ci/upgrade-run.sh" "$ref" 2>&1)
}
BASE_ENV='SETUP_CODE=ci-setup-code-12345'$'\n''TALOUS_CHANNEL=source'
# a baseline is named by its commit, as the list names it: the install has no tag of the stand-in repository
fixed=$(git -C "$U" rev-parse --short fixed)
half=$(git -C "$U" rev-parse --short half)
keys=$(git -C "$U" rev-parse --short keys)
out=$(rehearse "$keys"); rc=$?
check "the rehearsal reaches Docker and stops there" test $rc -ne 0 -a "$(called '^docker compose up -d --build ')" -eq 1
check "with no setting the install has no key of a port or a name" test "$(cat "$W/talous/.env")" = "$BASE_ENV"
has "and Docker gets none" "$(calls)" "docker compose up -d --build | HOST_PORT= INSTANCE_NAME= COMPOSE_PROJECT_NAME= cwd=talous"
out=$(rehearse "$keys" UPGRADE_PORT=8082 UPGRADE_PROJECT=proof-2); rc=$?
check "a port and a project: the keys are in the .env of the install" test "$(cat "$W/talous/.env")" = "$BASE_ENV"$'\n''HOST_PORT=8082'$'\n''INSTANCE_NAME=proof-2'$'\n''COMPOSE_PROJECT_NAME=proof-2'
has "and in the environment of every Docker call" "$(calls)" "docker compose up -d --build | HOST_PORT=8082 INSTANCE_NAME=proof-2 COMPOSE_PROJECT_NAME=proof-2 cwd=talous"
has "the teardown of a failed run reaches that project, not the default one" "$(calls)" "docker compose down -v | HOST_PORT=8082 INSTANCE_NAME=proof-2 COMPOSE_PROJECT_NAME=proof-2 cwd=talous"
out=$(rehearse "$keys" UPGRADE_PORT=8090); rc=$?
check "a port alone: one key" test "$(cat "$W/talous/.env")" = "$BASE_ENV"$'\n''HOST_PORT=8090'
out=$(rehearse "$fixed" UPGRADE_PORT=8082 UPGRADE_PROJECT=proof-2); rc=$?
check "a baseline with fixed names refuses a port and a project" test $rc -eq 1
has "it says why" "$out" "FAIL: the docker-compose.yml of $fixed does not read HOST_PORT, so this baseline runs only on port 8080 with the default names"
check "before any Docker call and before the install folder exists" test ! -s "$CALLS" -a ! -e "$W/talous"
out=$(rehearse "$half" UPGRADE_PROJECT=proof-2); rc=$?
has "a baseline that can move its port but not its name refuses a project" "$out" "FAIL: the docker-compose.yml of $half does not read INSTANCE_NAME"
check "before any Docker call too" test $rc -eq 1 -a ! -s "$CALLS" -a ! -e "$W/talous"
out=$(rehearse "$fixed"); rc=$?
check "a baseline with fixed names runs on the defaults" test "$(called '^docker compose up -d --build ')" -eq 1 -a "$(cat "$W/talous/.env")" = "$BASE_ENV"

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
