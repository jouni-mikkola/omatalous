# shellcheck shell=bash disable=SC2034,SC2154
# The stand-in world of tools/test/local-proof.test.sh, sourced by it: a repository with baselines, legs that are stubs, and
# stubs of docker, id, setpriv, chown, getent and nproc first in PATH. It defines helpers and runs nothing else.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
R=$TMP/repo
BIN=$TMP/bin
PLAY=$TMP/play
CALLS=$TMP/calls
export PROOF_CALLS=$CALLS PROOF_PLAY=$PLAY
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
# A release cut hands its children their shares of the cores (PROOF_JOBS among them): the stand-in proof takes none.
unset CUT_LOCK_HELD CUT_LOCK_WAIT CUT_CPUS CHECK_JOBS E2E_WORKERS PROOF_JOBS VITEST_MAX_WORKERS npm_config_workspace_concurrency
stub() { cat >"$1"; chmod +x "$1"; }
commit() { git -C "$1" add -A && git -C "$1" commit -q -m "$2"; }

# ── the stand-in repository ──
mkdir -p "$R/tools/ci" "$R/scripts" "$R/apps/server/migrations" "$R/docs" "$BIN"
git init -q "$R"
cp "$REPO/tools/ci/local-proof.sh" "$REPO/tools/ci/proof-drills.sh" "$R/tools/ci/"
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
# the part of the drills this is: on the default install of lane 0, or on the drills' own
part=default
[[ -z ${UPGRADE_PROJECT:-} ]] || part=own
said "drills work=${UPGRADE_WORK##*/} install=$([[ -d $UPGRADE_WORK/talous ]] && echo up || echo missing) only=$DRILLS_ONLY port=${UPGRADE_PORT:-} project=${UPGRADE_PROJECT:-} cwd=$PWD"
# with the file meet-drills, the drills of the own install tell the newest rehearsal (which waits for them)
[[ ! -e $PROOF_PLAY/meet-drills || $part != own ]] || timeout 30 bash -c 'echo go >"$1"' _ "$PROOF_PLAY/drills.fifo"
# with the file kill-ppid-NAME, the shell that started this leg is killed first, and the leg fails: no line, no word
if [[ -e $PROOF_PLAY/kill-ppid-drills-$part ]]; then kill -9 "$PPID"; echo "the drills leg broke"; exit 1; fi
[[ $part != default ]] || hold drills
broken drills
broken "drills-$part"
rm -rf "$UPGRADE_WORK"
LEG
stub "$R/tools/ci/upgrade-run.sh" <<'LEG'
#!/usr/bin/env bash
. "$(dirname "$0")/play.sh"
ref=$1
port=${UPGRADE_PORT:-8080}
project=${UPGRADE_PROJECT:-default}
# a run with UPGRADE_UNTIL is an install for the drills, not a rehearsal
kind=rehearsal
[[ -z ${UPGRADE_UNTIL:-} ]] || kind=drill-install
said "$kind $ref port=${UPGRADE_PORT:-} project=${UPGRADE_PROJECT:-} keep=${UPGRADE_KEEP_UP:-} work=${UPGRADE_WORK##*/} until=${UPGRADE_UNTIL:-} home=${HOME##*/} cwd=$PWD"
# two runs inside at once on one port or in one project
mkdir "$PROOF_PLAY/port-$port" 2>/dev/null || said "CLASH port $port ($ref)"
mkdir "$PROOF_PLAY/project-$project" 2>/dev/null || said "CLASH project $project ($ref)"
if [[ $kind == drill-install ]]; then
  hold "install-$project"
  # with the file orphan, a process that outlives the install keeps whatever lock the install holds (until it is killed)
  [[ ! -e $PROOF_PLAY/orphan ]] || { cat "$PROOF_PLAY/never" & echo $! >"$PROOF_PLAY/orphan.pid"; }
  # with the file install-after-b7, the install is made only after the newest rehearsal has ended
  [[ ! -e $PROOF_PLAY/install-after-b7 ]] || timeout 30 head -n 1 "$PROOF_PLAY/b7.fifo" >/dev/null
  rmdir "$PROOF_PLAY/port-$port" "$PROOF_PLAY/project-$project" 2>/dev/null
  broken "install-$project"
  mkdir -p "$UPGRADE_WORK/talous"
  said "drill-install-end $project"
  exit 0
fi
# with the file meet-drills, the newest rehearsal stays inside until the drills of the own install have begun
if [[ -e $PROOF_PLAY/meet-drills && $ref == b7 ]]; then timeout 30 head -n 1 "$PROOF_PLAY/drills.fifo" >/dev/null; fi
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
# with the file meet-image, the first rehearsal in tells the image build (which waits for it) and then holds, if the file
# hold-meeting is there
if [[ -e $PROOF_PLAY/meet-image ]] && mkdir "$PROOF_PLAY/met" 2>/dev/null; then
  timeout 30 bash -c 'echo go >"$1"' _ "$PROOF_PLAY/meet.fifo" # the 30 s are for a proof whose image build never reads
  hold meeting
fi
rmdir "$PROOF_PLAY/port-$port" "$PROOF_PLAY/project-$project" 2>/dev/null
# with the file kill-ppid-REF, the shell of the lane that started this leg is killed, and the leg fails
if [[ -e $PROOF_PLAY/kill-ppid-$ref ]]; then kill -9 "$PPID"; echo "the $ref leg broke"; exit 1; fi
broken "$ref"
[[ ${UPGRADE_KEEP_UP:-} != 1 ]] || mkdir -p "$UPGRADE_WORK/talous"
said "rehearsal-end $ref"
[[ ! -e $PROOF_PLAY/install-after-b7 || $ref != b7 ]] || timeout 30 bash -c 'echo go >"$1"' _ "$PROOF_PLAY/b7.fifo"
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
printf '%s\n' b3 nope >"$R/ghost.txt"
printf '%s\n' b0 b7 >"$R/two.txt"
commit "$R" "the lists"

stub "$BIN/docker" <<'STUB'
#!/usr/bin/env bash
case ${1:-} in
  build) echo "docker $* cwd=$PWD" >>"$PROOF_CALLS" ;;
  image | rmi) echo "docker $*" >>"$PROOF_PLAY/images" ;; # after the drills: not among the calls of the legs
  *) echo "docker $*" >>"$PROOF_CALLS" ;;
esac
case ${1:-} in
  info) [[ ! -e $PROOF_PLAY/no-docker ]] || exit 1 ;;
  image)
    case ${2:-} in
      ls) cat "$PROOF_PLAY/kept" 2>/dev/null ;; # the tags of the kept images, one a line
      inspect) grep -qx -- "$3" "$PROOF_PLAY/left" 2>/dev/null; exit ;; # what an earlier proof left: one name a line
    esac ;;
  container | volume)
    if [[ ${2:-} == inspect ]]; then grep -qx -- "$3" "$PROOF_PLAY/left" 2>/dev/null; exit; fi
    [[ ${2:-} != ls ]] || cat "$PROOF_PLAY/left-volumes" 2>/dev/null ;;
  ps) cat "$PROOF_PLAY/left-ps" 2>/dev/null ;; # the containers of the drills' project, asked for by its label
  kill) [[ ! -e $PROOF_PLAY/fail-kill ]] || exit 1 ;;
  build)
    # with the file image-waits, the build stays until a rehearsal is inside (the 30 s are for a proof that never starts one)
    [[ ! -e $PROOF_PLAY/image-waits ]] || timeout 30 head -n 1 "$PROOF_PLAY/meet.fifo" >/dev/null
    echo "image-end" >>"$PROOF_CALLS"
    [[ ! -e $PROOF_PLAY/fail-image ]] || { echo "the image leg broke"; exit 1; } ;;
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
[[ $6 != test || $1 != --reuid=2 || ! -e $PROOF_PLAY/cannot-read-drills ]] || exit 1
shift 3
exec "$@"
STUB
stub "$BIN/chown" <<'STUB'
#!/usr/bin/env bash
echo "chown $*" >>"$PROOF_CALLS"
STUB
stub "$BIN/nproc" <<'STUB'
#!/usr/bin/env bash
n=$(cat "$PROOF_PLAY/cpus" 2>/dev/null || echo 16)
[[ $n != none ]] || exit 1 # a machine that cannot say
echo "$n"
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
only path-no-setpriv bash git dirname setsid flock; cp "$BIN/docker" "$BIN/id" "$TMP/path-no-setpriv/"

# proof ARGS: the proof of the stand-in repository, started from another folder
proof() { (cd "$TMP" && TMPDIR=$TMP/work PATH=$BIN:$PATH "$R/tools/ci/local-proof.sh" "$@" 2>&1); }
reset() { rm -rf "$PLAY" "$TMP/work" "$R/.git/local-proof"; mkdir -p "$PLAY" "$TMP/work"; : >"$CALLS"; }
called() { grep -c -- "$1" "$CALLS"; }
calls() { cat "$CALLS"; }
logs() { echo "$TMP"/work/local-proof.*/logs; }
short() { git -C "$R" rev-parse --short=7 HEAD; }
stamp() { cat "$R/.git/local-proof" 2>/dev/null; }

