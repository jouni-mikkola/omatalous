#!/usr/bin/env bash
# More tests for tools/ci/local-proof.sh, in the stand-in world of tools/test/local-proof-world.sh (see local-proof.test.sh): a
# proof started as root, the refusals, a linked worktree, the rehearsal's port and project, the kept image of a baseline and
# the baselines that update the same way. A suite of its own so the check runs it beside local-proof.test.sh.
#
#   tools/test/local-proof-runs.test.sh
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
# the tests below that read several failures at once ask for every leg to finish (local-proof.test.sh tests the default)
export PROOF_KEEP_GOING=1
# the commits the sections of local-proof.test.sh leave on the stand-in repository, which the tests below count on
echo more >"$R/docs/more.md"; commit "$R" "words"
echo 'echo more' >>"$R/scripts/install.sh"; commit "$R" "a host script"
printf '%s\n' b0 b1 >"$R/fixed.txt"; commit "$R" "a list of baselines that cannot move"

# ── started as root ──
reset
touch "$PLAY/root"
out=$(proof baselines.txt); rc=$?
check "root may start it" test $rc -eq 0 -a -n "$(stamp)"
has "the work folder goes to user 1" "$(calls)" "chown -R 1:1 $TMP/work/local-proof."
has "the image is built as user 1 in the group docker, with a home of its own" "$(calls)" "setpriv --reuid=1 --regid=1 --groups=999 env HOME=home -> docker"
has "the smoke test too" "$(calls)" "setpriv --reuid=1 --regid=1 --groups=999 env HOME=home -> tools/ci/smoke-image.sh"
has "the signature too" "$(calls)" "setpriv --reuid=1 --regid=1 --groups=999 env HOME=home -> tools/ci/verify-release.sh"
check "every leg, and the look whether each user can read its clone" test "$(called '^setpriv ')" -eq 16
check "user 1: the image, the smoke test, the signature, the five rehearsals of lanes 1 to 3, the look at its clone" test "$(called '^setpriv --reuid=1 ')" -eq 9
check "user 2: lane 0 (three rehearsals), the drills' install, both drills parts, the look at its clone" test "$(called '^setpriv --reuid=2 --regid=2 --groups=999 env HOME=home ')" -eq 7
check "every rehearsal has a home" test "$(called '^rehearsal .* home=home ')" -eq 8
has "lane 0 and the drills have a folder of their own, owned by user 2" "$(calls)" "chown -R 2:2 $TMP/work/local-proof."
check "lane 0 ran in the clone of user 2, the other lanes in the clone of user 1" test "$(called '^rehearsal .* cwd=.*/drills/src$')" -eq 3 -a "$(called '^rehearsal .* cwd=.*/local-proof\.[^/]*/src$')" -eq 5
check "the drills and the install run in the clone of user 2" test "$(called '^drills .* cwd=.*/drills/src$')" -eq 2 -a "$(called '^drill-install .* cwd=.*/drills/src$')" -eq 1
reset
touch "$PLAY/root" "$PLAY/meet-drills"
mkfifo "$PLAY/drills.fifo"
out=$(proof baselines.txt); rc=$?
check "root: the newest rehearsal waited for the drills of the own install, so they ran beside it" test $rc -eq 0 -a "$(grep -n '^drills work=own' "$CALLS" | cut -d: -f1)" -lt "$(grep -n '^rehearsal-end b7' "$CALLS" | cut -d: -f1)"
check "and the helper's drills ran in lane 0 after the newest rehearsal" test "$(grep -n '^rehearsal-end b7' "$CALLS" | cut -d: -f1)" -lt "$(grep -n '^drills work=upgrade-b7' "$CALLS" | cut -d: -f1)"
# the helper's drills wait for the install of the drills (its update.sh is the one their watchdog would count): that
# install stays until the newest rehearsal has ended, so lane 0 reaches its drills first
reset
touch "$PLAY/root" "$PLAY/install-after-b7"
mkfifo "$PLAY/b7.fifo"
out=$(proof baselines.txt); rc=$?
check "root: the helper's drills start only after the drills' install has been made" test $rc -eq 0 -a "$(grep -n '^drill-install-end' "$CALLS" | cut -d: -f1)" -lt "$(grep -n '^drills work=upgrade-b7' "$CALLS" | cut -d: -f1)"
# one job, started as root: the same user for all three parts, so one at a time and never beside each other
reset
touch "$PLAY/root"
out=$(proof --jobs 1 baselines.txt); rc=$?
check "root, one job: the helper's drills, then the drills' install, then its drills" test $rc -eq 0 -a "$(grep -n '^drills work=upgrade-b7' "$CALLS" | cut -d: -f1)" -lt "$(grep -n '^drill-install ' "$CALLS" | cut -d: -f1)" -a "$(grep -n '^drill-install-end' "$CALLS" | cut -d: -f1)" -lt "$(grep -n '^drills work=own' "$CALLS" | cut -d: -f1)"
check "every rehearsal ran as user 2, in its clone, so that the install of the newest can be drilled" test "$(called '^rehearsal .* cwd=.*/drills/src$')" -eq 8
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
has "the install the drills stood on is taken down, as user 2" "$(calls)" "setpriv --reuid=2 --regid=2 --groups=999 env HOME=home -> docker"$'\n'"docker compose down -v"
check "a stopped proof stamps nothing and leaves no clone" test -z "$(stamp)" -a ! -e "$(dirname "$(logs)")/src"

reset
touch "$PLAY/hold-b6"
mkfifo "$PLAY/started" "$PLAY/never"
stopped baselines.txt
check "TERM during a rehearsal: exit 143" test "$rc" -eq 143
has "the rehearsal got the stop" "$(calls)" "stopped b6"
check "no leg starts after the stop" test "$(called '^drills \|^drill-install')" -eq 0
check "and nothing is stamped" test -z "$(stamp)" -a ! -e "$(dirname "$(logs)")/src"

# ── refusals: exit 2 before anything runs ──
refused() { # refused NAME WORDS ARGS: exit 2 with WORDS, and no leg and no work folder
  local name=$1 words=$2 o r
  shift 2
  o=$("$@"); r=$?
  if [[ $r -eq 2 && $o == *"$words"* && -z "$(cd "$TMP/work" && for e in *; do [[ -e $e && $e != local-proof-running.lock ]] && echo "$e"; done)" ]] && ! grep -q '^docker build\|^smoke\|^rehearsal' "$CALLS"; then pass "$name"; else fail "$name" "exit $r: $o"; fi
}
reset
refused "no list" "Which list of baselines?" proof
refused "two lists" "Give one list of baselines" proof baselines.txt ghost.txt
refused "a list that is not in the commit" "missing.txt is not a file of the commit" proof missing.txt
cp "$R/baselines.txt" "$R/loose.txt"
refused "a list that is only in the working tree" "loose.txt is not a file of the commit" proof loose.txt
rm "$R/loose.txt"
refused "a list with no ref" "empty.txt names no baseline" proof empty.txt
refused "--commit with an empty value" "--commit needs a commit" proof --proved --commit "" baselines.txt
refused "--commit as the last word" "--commit needs a commit" proof --proved baselines.txt --commit
refused "--commit with a word that is no commit" "nonsense is not a commit of" proof --proved --commit nonsense baselines.txt
refused "an unknown option" "Unknown option: --fast" proof --fast baselines.txt
refused "--jobs 0" "--jobs needs a number from 1 to 99" proof --jobs 0 baselines.txt
proof_max() { local m=$1; shift; PROOF_MAX_LANES=$m proof "$@"; }
refused "PROOF_MAX_LANES 0" "PROOF_MAX_LANES needs a number from 1 to 99" proof_max 0 baselines.txt
refused "PROOF_MAX_LANES with a word" "PROOF_MAX_LANES needs a number from 1 to 99" proof_max some baselines.txt
refused "--jobs with a word" "--jobs needs a number from 1 to 99" proof --jobs many baselines.txt
refused "--jobs with nothing" "--jobs needs a number from 1 to 99" proof baselines.txt --jobs
proof_jobs() { local j=$1; shift; PROOF_JOBS=$j proof "$@"; }
refused "PROOF_JOBS 0" "PROOF_JOBS needs a number from 1 to 99" proof_jobs 0 baselines.txt
refused "PROOF_JOBS with a word" "PROOF_JOBS needs a number from 1 to 99" proof_jobs many baselines.txt
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
reset
touch "$PLAY/cannot-read-drills" "$PLAY/root"
refused "a clone the user of the drills cannot read" "User 2 cannot read $TMP/work/local-proof." proof baselines.txt
proof_drill() { local u=$1; shift; PROOF_DRILL_USER=$u proof "$@"; }
reset
touch "$PLAY/root"
refused "root, with the same user for the drills as for the legs" "PROOF_DRILL_USER and PROOF_USER are both 1" proof_drill 1 baselines.txt
reset
out=$(proof_drill 1 baselines.txt); rc=$?
check "not root there is one user in any case, and the drills' setting is not asked" test $rc -eq 0 -a -n "$(stamp)"
reset
touch "$PLAY/root"
out=$(proof_drill 3 baselines.txt); rc=$?
check "root, with another user for the drills: they run as that user" test $rc -eq 0 -a "$(called '^setpriv --reuid=3 --regid=3 ')" -eq 7
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
has "its legs ran" "$out" "ok      drills 3, 4, 7, 8 ("
check "the stamp is in the common git dir, where every worktree reads it" test "$(head -1 "$R/.git/local-proof" 2>/dev/null)" = "$(git -C "$TMP/wt" rev-parse HEAD)" -a ! -e "$R/.git/worktrees/wt/local-proof"

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
cp "$REPO/tools/ci/upgrade-run.sh" "$REPO/tools/ci/lib.sh" "$REPO/tools/ci/build-ca.sh" "$U/tools/ci/"
printf 'export const APP_VERSION = "1.2.3";\n' >"$U/apps/server/src/version.ts"
commit "$U" "the version under test"
stub "$TMP/ubin/docker" <<'STUB'
#!/usr/bin/env bash
# no Docker here: `compose up` fails, and every call says which install it would have reached
echo "docker $* | HOST_PORT=${HOST_PORT:-} INSTANCE_NAME=${INSTANCE_NAME:-} COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-} cwd=${PWD##*/}" >>"$PROOF_CALLS"
[[ " $* " != *" up "* ]] || exit 1
# the image the compose file names (one line a file `compose-images`) and the images that are here (one name a line, `have`)
[[ $* != "compose config --images" ]] || { cat "$PROOF_PLAY/compose-images" 2>/dev/null; exit 0; }
[[ $* != "image inspect "* ]] || { grep -qx -- "$3" "$PROOF_PLAY/have" 2>/dev/null; exit; }
STUB
# rehearse REF [NAME=VALUE...]: the real rehearsal from REF, which ends at its first `compose up`
rehearse() {
  local ref=$1
  shift
  rm -rf "$W"; : >"$CALLS"
  (cd "$TMP" && env -u UPGRADE_PORT -u UPGRADE_PROJECT -u UPGRADE_KEEP_UP -u UPGRADE_UNTIL -u UPGRADE_BUILD_SHIM -u HOST_PORT -u INSTANCE_NAME -u COMPOSE_PROJECT_NAME \
    "$@" UPGRADE_WORK="$W" PATH="$TMP/ubin:$PATH" bash "$U/tools/ci/upgrade-run.sh" "$ref" 2>&1)
}
BASE_ENV='SETUP_CODE=ci-setup-code-12345'$'\n''TALOUS_CHANNEL=source'
# a baseline is named by its commit, as the list names it: the install has no tag of the stand-in repository
fixed=$(git -C "$U" rev-parse --short fixed)
half=$(git -C "$U" rev-parse --short half)
keys=$(git -C "$U" rev-parse --short keys)
out=$(rehearse "$keys"); rc=$?
check "the rehearsal reaches Docker and stops there" test $rc -ne 0 -a "$(called '^docker compose build ')" -eq 1 -a "$(called '^docker compose up -d ')" -eq 1
check "with no setting the install has no key of a port or a name" test "$(cat "$W/talous/.env")" = "$BASE_ENV"
has "and Docker gets none" "$(calls)" "docker compose build | HOST_PORT= INSTANCE_NAME= COMPOSE_PROJECT_NAME= cwd=talous"
out=$(rehearse "$keys" UPGRADE_PORT=8082 UPGRADE_PROJECT=proof-2); rc=$?
check "a port and a project: the keys are in the .env of the install" test "$(cat "$W/talous/.env")" = "$BASE_ENV"$'\n''HOST_PORT=8082'$'\n''INSTANCE_NAME=proof-2'$'\n''COMPOSE_PROJECT_NAME=proof-2'
has "and in the environment of every Docker call" "$(calls)" "docker compose build | HOST_PORT=8082 INSTANCE_NAME=proof-2 COMPOSE_PROJECT_NAME=proof-2 cwd=talous"
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
out=$(rehearse "$keys" UPGRADE_UNTIL=never); rc=$?
check "an UPGRADE_UNTIL that is not 'update' is refused before any Docker call" test $rc -eq 1 -a ! -s "$CALLS" -a ! -e "$W/talous"
has "and says what it knows" "$out" "FAIL: UPGRADE_UNTIL knows only 'update' (it is 'never')"
out=$(rehearse "$keys" UPGRADE_UNTIL=update); rc=$?
check "UPGRADE_UNTIL=update goes on to Docker like any run (it ends after the update, which no stub can reach)" test "$(called '^docker compose build ')" -eq 1 -a "$(called '^docker compose up -d ')" -eq 1
out=$(rehearse "$fixed"); rc=$?
check "a baseline with fixed names runs on the defaults" test "$(called '^docker compose build ')" -eq 1 -a "$(called '^docker compose up -d ')" -eq 1 -a "$(cat "$W/talous/.env")" = "$BASE_ENV"

# ── the image of a baseline, kept by the full hash of its commit ──
# The rehearsal ends at its first `compose up`, so what is tested is which image it starts from and the phase line
full=$(git -C "$U" rev-parse "$keys")
other=$(git -C "$U" rev-parse "$half")
name=proof-baseline:$full
echo 'banking-app:latest' >"$PLAY/compose-images"
out=$(rehearse "$keys"); rc=$?
check "no kept image: the baseline is built, and no image is tagged" test "$(called '^docker compose build ')" -eq 1 -a "$(called '^docker tag ')" -eq 0
has "the phase line says built" "$out" "phase baseline image: "
has "and where the image came from" "$out" "s (built)"
echo "$name" >"$PLAY/have"
out=$(rehearse "$keys"); rc=$?
check "an image kept under the hash of the baseline: nothing is built" test "$(called '^docker compose build ')" -eq 0 -a "$(called '^docker compose up -d ')" -eq 1
has "it is the image the install runs" "$(calls)" "docker tag $name banking-app:latest"
has "the phase line says kept" "$out" "s (kept)"
check "a ref's own name is no claim: the clone's hash is what is asked" test "$(called "^docker image inspect $name ")" -eq 1 -a "$(called "^docker image inspect proof-baseline:$keys ")" -eq 0
echo 'proof-2:latest' >"$PLAY/compose-images"
out=$(rehearse "$keys" UPGRADE_PORT=8082 UPGRADE_PROJECT=proof-2)
has "in a lane of its own the kept image gets the lane's name" "$(calls)" "docker tag $name proof-2:latest"
echo 'banking-app:latest' >"$PLAY/compose-images"
echo "proof-baseline:$other" >"$PLAY/have"
out=$(rehearse "$keys")
check "an image kept for another commit is not used" test "$(called '^docker compose build ')" -eq 1 -a "$(called '^docker tag ')" -eq 0
echo 'banking-app:latest' >"$PLAY/compose-images"
printf '%s\n' "proof-baseline:${full:0:12}" "$keys" "proof-baseline:latest" >"$PLAY/have"
out=$(rehearse "$keys")
check "nor is one named by a short hash, a ref or a word" test "$(called '^docker compose build ')" -eq 1 -a "$(called '^docker tag ')" -eq 0
echo "$name" >"$PLAY/have"
out=$(rehearse "$keys" PROOF_FRESH=1)
check "PROOF_FRESH=1 builds though the image is kept" test "$(called '^docker compose build ')" -eq 1 -a "$(called '^docker tag ')" -eq 0
printf 'banking-app:latest\ncaddy:2\n' >"$PLAY/compose-images"
out=$(rehearse "$keys")
check "a compose file with more than one image builds as before and keeps nothing" test "$(called '^docker compose build ')" -eq 1 -a "$(called '^docker tag ')" -eq 0
: >"$PLAY/compose-images"
out=$(rehearse "$keys")
check "a compose file that names no image builds as before" test "$(called '^docker compose build ')" -eq 1 -a "$(called '^docker tag ')" -eq 0
rm -f "$PLAY/compose-images" "$PLAY/have"

# ── baselines that update the same way run once ──
# Side commits make twins of a baseline: d1 is b7 with another note (the same update path), d2 is b7 with one more migration,
# d3 is d2 with another note, d4 is b7 with another compose file that still takes a port and a name, f1 is b0 with another note.
br=$(git -C "$R" symbolic-ref --short HEAD)
side() { # side BASE TAG FILE TEXT: a commit on BASE that writes TEXT to FILE, tagged TAG
  git -C "$R" checkout -q --detach "$1" && mkdir -p "$R/$(dirname "$3")" && echo "$4" >>"$R/$3" && commit "$R" "side $2" && git -C "$R" tag "$2"
}
side b7 d1 docs/notes.md twin
side b7 d2 apps/server/migrations/0002_more.sql 'ALTER TABLE t ADD COLUMN n TEXT;'
side d2 d3 docs/notes.md twin
side b7 d4 docker-compose.yml '# another compose file'
side b0 f1 docs/notes.md twin
git -C "$R" checkout -q "$br"
printf '%s\n' b2 b7 d1 d2 >"$R/twins.txt"
printf '%s\n' b2 b7 d2 >"$R/migration.txt"
printf '%s\n' b2 b7 d4 >"$R/compose.txt"
printf '%s\n' b2 b7 d1 d3 d4 >"$R/paths.txt"
printf '%s\n' b0 f1 b2 d1 >"$R/fixed.txt"
printf '%s\n' b0 b7 d1 d2 >"$R/oldest-movable.txt"
commit "$R" "the lists of twins"
upgraded() { grep -oE 'upgrade from [a-z0-9]+ \(' <<<"$1" | sed 's/upgrade from //; s/ (//' | LC_ALL=C sort -u | tr '\n' ' '; }
reset
out=$(proof twins.txt)
has "two baselines of one update path: the first line counts the paths" "$out" "4 baselines of the list are 3 update paths, and the newest of each runs"
check "give one rehearsal: the newer of the twins" test "$(upgraded "$out")" = "b2 d1 d2 "
lacks "the older twin has no rehearsal" "$out" "upgrade from b7 "
check "and no check of its migrations and compose file" test "$(called '^check-migrations ')" -eq 3 -a "$(called '^compose-compat ')" -eq 3
has "the first line counts the baselines that run" "$out" "local proof of $(short): 3 baselines ("
check "the stamp names the baselines that ran" test "$(stamp)" = "$(git -C "$R" rev-parse HEAD)"$'\n'"b2 d1 d2"
out=$(proof --proved twins.txt); rc=$?
check "--proved takes the stamp of the collapsed set for the same commit and list" test $rc -eq 0
has "and counts the baselines that run" "$out" "is proved from 3 baselines"
out=$(proof --proved --all twins.txt); rc=$?
check "the stamp of the collapsed set does not prove --all" test $rc -eq 1
: >"$CALLS"
out=$(proof twins.txt)
has "a second proof of the same commit and list runs nothing" "$out" "is proved already from b2 d1 d2 (the stamp is .git/local-proof). Nothing ran."
check "and starts no leg" test ! -s "$CALLS"
reset
out=$(proof --all twins.txt)
check "--all runs every baseline, the twin too" test "$(upgraded "$out")" = "b2 b7 d1 d2 "
has "--all says so in the first line" "$out" "4 baselines (--all: every baseline of the list runs, none is left out)"
check "and stamps all four" test "$(stamp)" = "$(git -C "$R" rev-parse HEAD)"$'\n'"b2 b7 d1 d2"
reset
out=$(proof migration.txt)
check "a baseline whose migrations differ is kept with the one it is a twin of in all else" test "$(upgraded "$out")" = "b2 b7 d2 "
has "so there are three paths" "$out" "3 baselines of the list are 3 update paths"
reset
out=$(proof compose.txt)
check "a baseline whose compose file differs is kept too" test "$(upgraded "$out")" = "b2 b7 d4 "
reset
out=$(proof paths.txt)
check "the twins of one path and the others: the newest of each path, and b2 as the oldest" test "$(upgraded "$out")" = "b2 d1 d3 d4 "
reset
out=$(proof fixed.txt)
check "a baseline that cannot take a port runs though it has the path of the oldest" test "$(upgraded "$out")" = "b0 b2 d1 f1 "
has "the paths are counted for them as well" "$out" "4 baselines of the list are 3 update paths"
reset
out=$(proof oldest-movable.txt)
check "the oldest baseline that can take a port runs though a newer one has its path" test "$(upgraded "$out")" = "b0 b7 d1 d2 "
check "and is the one the drills' install is made from" test "$(called '^drill-install b7 ')" -eq 1
unset -f side upgraded


echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
