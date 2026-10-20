#!/usr/bin/env bash
# shellcheck disable=SC2034 # DRILL_REF, KEPT, DROOT and the like are read in proof-drills.sh, which shellcheck does not follow
# What the Docker job of CI and the upgrade workflow prove, on this machine, as one command and with no billed minute:
#
#   tools/ci/local-proof.sh [--all] [--jobs N] BASELINES     prove the commit that is checked out
#   tools/ci/local-proof.sh --proved [--all] [--commit SHA] BASELINES
#                                                            exit 0 when that commit (SHA, else the one checked out) is proved
#                                                            already, from its baselines too; runs nothing. The one reader of the stamp
#   tools/ci/local-proof.sh --part PART | --lane K/N | --farm [--all] [--jobs N] BASELINES
#                                                            a part of the proof, or the parts no farm record covers (proof-parts.sh)
#
# BASELINES is the list of upgrade baselines: a file of the repository with one ref a line, the oldest first, which
# the upgrade workflow reads too. It is read from the commit, like everything else: the legs run in a fresh clone of
# HEAD, never in the working tree. The legs, each with its output in a log of its own:
#
#   image              docker build -t banking-app:ci .
#   smoke              tools/ci/smoke-image.sh banking-app:ci unknown unknown
#   signature          tools/ci/verify-release.sh: the newest release verifies with the install scripts of this commit
#                      and of every baseline
#   upgrade from REF   check-migrations.sh, compose-compat.sh and upgrade-run.sh, once for each baseline
#   drills             tools/ci/drills.sh in two parts: drills 3, 4, 7 and 8 (the helper) on the install with the default
#                      names and port 8080 that lane 0 leaves up after its last rehearsal, the newest, in lane 0 after it;
#                      drills 1, 2, 5, 6, 9 and 10 on an install of their own (project "drills", port 8280), made by
#                      upgrade-run.sh from the oldest baseline that can take a port and a name, up to its update
#
# Everything starts at once: the image and then the smoke test in a chain of their own, the signature, the rehearsals in
# their lanes, and the drills' install with its drills after it. They share nothing: a rehearsal makes its own images
# (never banking-app:ci), the smoke test publishes no port, the signature only reads, and the drills' install has a name and
# a port that no lane has. What they would share is the watchdog, which counts every update.sh and install.sh of the same
# user on the machine. So, with a proof started as root and more than one job, lane 0 and the drills' install run as
# another user than the other lanes (PROOF_DRILL_USER, default 2), and drills 3 and 4 wait until the drills' install has
# been made, the last update.sh of that user beside them (the other drills start none). In any other case the three parts
# run one at a time when every other leg has ended: drills 3 and 4, then the making of the install, then its drills. With
# one job the image and the smoke test run first and alone, and a red one ends the proof before any other leg starts.
#
# Images that are kept: the image of a baseline is the same one in every proof, so a rehearsal keeps it under the name
# proof-baseline:<the full hash of the baseline's commit> once its install has come up, and a later proof starts from it
# instead of building it (upgrade-run.sh; the name is the only claim, and the hash is read from the clone, never from a ref).
# PROOF_FRESH=1 builds every baseline image anew and keeps the new one. At the end of a green proof the kept images whose
# commit the list no longer names are removed, and one line says how many are kept. The image of the commit under proof is
# not shared by name: every rehearsal's update.sh builds it, as a user's update does (that build is part of what is proved),
# and the layers the image leg builds at the same time are the Docker cache it reuses. What the builds and the other
# phases take is in each rehearsal's log, one line a phase ("phase update: 31 s"), and a drills log has a line a drill.
#
# One line a leg when it ends, with its seconds. A failed leg stops the others (see "One red leg" below; a failed image
# or smoke test always does, since every rehearsal builds the same Dockerfile): the legs that are running are cut (each takes
# its install down), the drills do not run, and the line "stopped" stands for each leg that was cut. The last lines before the verdict say where the time went: a line a leg with its seconds, the longest
# first, then one for each lane and one for the drills' install and drills, so that the next cut shows the long path. The
# proof passes, and is stamped, only when every leg said ok: a leg whose shell was lost leaves no line, and the end says
# so. At the end the failed ones are named with their logs and the exit code is 1.
# Exit 2 means it refused before it ran anything. A commit that passed gets a stamp in the git folder, with the baselines it was proved
# from, and the next run for the same commit ends at once (remove the file `local-proof` there to run it again).
# The folder is the repository's common git dir, so the stamp of one worktree is read by the others.
#
# Verdicts: a rehearsal that passed is noted in the git folder (local-proof-verdicts) under a sha256 of the baseline's commit and
# of this commit's tree. A later proof of the same tree, after a red leg or a lost shell, takes that verdict and says "cached" in
# the leg's line instead of running it again; any changed byte of the tree, or another baseline commit, is another key, and
# PROOF_FRESH=1 reruns everything. The rehearsal of the newest baseline always runs: it leaves the install for drills 3 and 4.
#
# "One red leg": it fails the proof at once: the legs that run are cut (each takes its install down), no other starts, and the end
# names that leg. PROOF_KEEP_GOING=1 lets the others finish, so that one proof shows every failure. Every leg runs at nice 10
# (PROOF_NICE), and the rehearsals run in at most PROOF_MAX_LANES lanes (default 3) unless --jobs says more.
#
# Every docker build of every leg goes through the docker of the proof (tools/ci/build-ca.sh), which builds no image with
# the tests of its version; those of the commit under proof are the gate's. PROOF_BUILD_CA=FILE (or AUDIT_BUILD_CA): every
# build stage trusts that CA, for a proxy that re-signs TLS, and the images hold none; the variables that name the same file
# (SSL_CERT_FILE, CURL_CA_BUNDLE and the like) name a copy the legs' users can read.
#
# Which baselines: all of the list when the commit changes what an update runs through, compared with the last ref of
# the list (the last release): a migration, scripts/, the compose file, the Dockerfile or tools/ci/, except the few files
# of tools/ci that only the release workflow's own jobs run (NOT_RUN in the script) and the one that only the signature leg runs
# (LEG_ONLY: a change of verify-release.sh alone gave 25 baselines in 0.63.0 where 0.62.0 had 5); a test keeps both lists honest.
# Of those, baselines with the same update path run once, the newest of each: the same apps/server/migrations, scripts/,
# docker-compose*.yml and Dockerfile (what an install of the baseline runs; their git hashes decide). The oldest, the newest,
# the oldest that can take a port and a name and every one that cannot run in any case. The signature leg and the kept images
# still name every baseline. Otherwise (nothing changed) the oldest, the first public release (the ref under the comment line
# that says "first public release") and the last three. --all runs every baseline, none collapsed, and says so in the first line.
#
# --jobs N (or PROOF_JOBS; the flag wins) is how many rehearsals run at once, each in a lane. Without either it is one
# lane for every 4 CPUs, at least 4 and at most the number of rehearsals. A machine too small for that sets PROOF_JOBS=1
# (also through release.sh), and the rehearsals run one after another. Lane 0 has port 8080 and the names
# docker-compose.yml gives without a key. Lane N has port 8080+N and the project proof-N (UPGRADE_PORT and
# UPGRADE_PROJECT of upgrade-run.sh). Two kinds of rehearsal stay one at a time, in lane 0:
#   - from a baseline whose docker-compose.yml fixes the port and the names (the ones before 0.4.0),
#   - from the newest baseline, last, so that the update most installs make runs with the default names; its install is
#     left up for drills 3 and 4 in lane 0. Lane 0 is weighed with those drills as one more rehearsal (they take about
#     three quarters of one) when the others are shared out, so that it does not become the longest part.
#
# The maintenance helper refuses root, so no leg runs as root. Started as root, the script hands the clone and its work
# folder to user 1 (PROOF_USER) and starts each leg as that user with the group `docker` (setpriv); lane 0 and the drills'
# install get a clone, a folder and a home of their own, as user 2 (PROOF_DRILL_USER, which must differ). Started as another
# user, the legs run as that user. No test install may run as those users at the same time, and one proof runs on a machine
# at a time (a lock on TMPDIR/local-proof-running.lock; a second proof ends at once, naming it). Drills 3 and 4 wait for the drills' install
# at most PROOF_SETUP_WAIT seconds (default 900). A killed proof leaves the drills' install, its image, drill 5's containers and volumes and its folder; the next
# proof removes them at its start by their fixed names and says so in one line, and never touches the default install or a
# lane's. INT or TERM stops the legs, each of which takes its install down, and proves nothing.
# Needs git, a running Docker, setsid and flock, and what the legs need (curl, node, jq, the network for the signature). The
# work folder is a new one under TMPDIR (/tmp); its logs stay, the rest is removed.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
JOBS='' # from the flag or PROOF_JOBS, else from the CPUs once the baselines are picked
ALL=0
# jobs_are NAME VALUE: the number of rehearsals at once, from the flag or from the environment
jobs_are() { [[ ${2:-} =~ ^[1-9][0-9]?$ ]] || refuse "$1 needs a number from 1 to 99."; JOBS=$2; [[ $1 != --jobs ]] || JOBS_FLAG=1; }
JOBS_FLAG=0 # 1 when --jobs named the lanes: the cap of PROOF_MAX_LANES is for the default and for PROOF_JOBS, not for the flag
PROVED=0
LIST=''
COMMIT=''
PROOF_USER=${PROOF_USER:-1}
DRILL_USER=${PROOF_DRILL_USER:-2}
# what an update runs through: a change here since the last release is proved from every baseline, except in the
# files NOT_RUN names, which no install and no leg of the proof runs (a name may be of a file that does not exist yet)
NOT_RUN=(tools/ci/release-plan.sh tools/ci/candidate-index.sh)
# files that only the signature leg runs: no install and no rehearsal reads them, and that leg checks every baseline of the list
# whatever the rule picks, so a change of them alone is no reason for more rehearsals (a test keeps this list honest too)
LEG_ONLY=(tools/ci/verify-release.sh)
PATHS=(apps/server/migrations scripts 'docker-compose*.yml' Dockerfile tools/ci)
USAGE="usage: local-proof.sh [--all] [--jobs N] [--part PART | --lane K/N | --farm] BASELINES, or --proved [--all] [--commit SHA] BASELINES"
PART='' FARM=0 # --part or --lane: one part of the proof; --farm: the parts no record covers (tools/ci/proof-parts.sh)
# shellcheck source=proof-parts.sh
. "$ROOT/tools/ci/proof-parts.sh" || exit 2
# a rehearsal takes these from the lane it runs in and from nowhere else
unset UPGRADE_PORT UPGRADE_PROJECT UPGRADE_WORK UPGRADE_KEEP_UP UPGRADE_UNTIL DRILLS_ONLY

refuse() { printf 'Error: %s\n' "$*" >&2; exit 2; }

[[ -z ${PROOF_JOBS:-} ]] || jobs_are PROOF_JOBS "$PROOF_JOBS"
MAX_LANES=${PROOF_MAX_LANES:-3}
[[ $MAX_LANES =~ ^[1-9][0-9]?$ ]] || refuse "PROOF_MAX_LANES needs a number from 1 to 99."
while (($#)); do
  case $1 in
    --all) ALL=1 ;;
    --proved) PROVED=1 ;;
    --commit) [[ -n ${2:-} ]] || refuse "--commit needs a commit."; COMMIT=$2; shift ;;
    --jobs) jobs_are --jobs "${2:-}"; shift ;;
    --part) part_is "${2:-}"; shift ;;
    --lane) part_is "lane:${2:-}"; shift ;;
    --farm) FARM=1 ;;
    -h | --help) sed -n '2,/^set /{/^#/p}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) refuse "Unknown option: $1 ($USAGE)" ;;
    *) [[ -z $LIST ]] || refuse "Give one list of baselines ($USAGE)."; LIST=$1 ;;
  esac
  shift
done
[[ -n $LIST ]] || refuse "Which list of baselines? ($USAGE)"
((PROVED)) || [[ -z $COMMIT ]] || refuse "--commit goes with --proved."
((PROVED == 0 || FARM == 0)) && [[ -z $PART || $PROVED$FARM == 00 ]] || refuse "--part, --lane, --farm and --proved go one at a time."

cd "$ROOT" || exit 2
git rev-parse --git-dir >/dev/null 2>&1 || refuse "$ROOT is not a git checkout."
SHA=$(git rev-parse --verify -q "${COMMIT:-HEAD}^{commit}") || refuse "${COMMIT:-HEAD} is not a commit of $ROOT."
SHORT=${SHA:0:7}
STAMP=$(cd "$(git rev-parse --git-common-dir)" && pwd)/local-proof # the common git dir: every worktree of the repository reads it
VERDICTS=$(dirname "$STAMP")/local-proof-verdicts # one key a line: a rehearsal that passed (see "Verdicts")
TREE=$(git rev-parse --verify -q "$SHA^{tree}")
TEXT=$(git show "$SHA:$LIST" 2>/dev/null) || refuse "$LIST is not a file of the commit $SHORT (name it from the root of the repository)."

# shellcheck source=proof-pick.sh
. "$ROOT/tools/ci/proof-pick.sh" || exit 2

# verdict_key REF: the key of a rehearsal from REF on this commit: the hash of REF's commit (its image) and of this commit's tree
# (every script, the Dockerfile, the compose file, the migrations and the app that the update builds), as one sha256. A change of
# any byte of either is another key. Returns 1 for a ref that names no commit here.
verdict_key() {
  local c
  c=$(git rev-parse --verify -q "$1^{commit}") || return 1
  echo "rehearsal $c tree $TREE" | sha256sum | cut -c1-64
}

# the stamp names this commit and every baseline of this proof
proved() {
  local sha='' have='' r
  [[ -f $STAMP ]] || return 1
  { IFS= read -r sha; IFS= read -r have; } <"$STAMP"
  [[ $sha == "$SHA" ]] || return 1
  for r in "${PICK[@]}"; do [[ " $have " == *" $r "* ]] || return 1; done
}

pick_baselines "$TEXT" || refuse "$LIST names no baseline."
if ((PROVED)); then
  if proved; then echo "$SHORT is proved from ${#PICK[@]} baselines ($WHY)."; exit 0; fi
  echo "$SHORT is not proved from its ${#PICK[@]} baselines ($WHY)."
  exit 1
fi
if proved; then
  echo "local proof: $SHORT is proved already from ${PICK[*]} (the stamp is ${STAMP#"$ROOT"/}). Nothing ran."
  exit 0
fi


choose_parts

if [[ -z $JOBS ]]; then
  JOBS=$(($(nproc 2>/dev/null || echo 4) / 4))
  ((JOBS >= 4)) || JOBS=4
fi
# lanes side by side: at most PROOF_MAX_LANES (default 3: the machine is shared with other users), and never more than rehearsals
((JOBS_FLAG || JOBS <= MAX_LANES)) || JOBS=$MAX_LANES
((JOBS_FLAG || JOBS <= ${#RUN_REFS[@]})) || JOBS=${#RUN_REFS[@]}
((JOBS >= 1)) || JOBS=1
((JOBS <= 99)) || JOBS=99

for c in docker setsid flock; do command -v "$c" >/dev/null 2>&1 || refuse "$c is not installed."; done
docker info >/dev/null 2>&1 || refuse "Docker does not answer (docker info). Start it, for example with: systemctl start docker. Then run again."
DOCKER_GID=''
if [[ $(id -u) == 0 ]]; then
  command -v setpriv >/dev/null 2>&1 || refuse "setpriv is not installed (util-linux), and the legs cannot run as root."
  DOCKER_GID=$(getent group docker | cut -d: -f3)
  [[ -n $DOCKER_GID ]] || refuse "This machine has no group docker, so user $PROOF_USER could not reach Docker. Run the proof as a user that can."
  [[ $DRILL_USER != "$PROOF_USER" ]] || refuse "PROOF_DRILL_USER and PROOF_USER are both $PROOF_USER: the watchdog of the drills counts the updates of every rehearsal of the same user, so the drills need another one."
fi
# PROOF_BUILD_CA=FILE, or AUDIT_BUILD_CA, the name the release gate's audit reads for the same CA, so one setting serves
# the whole release: every build of every leg trusts it in its build stage (tools/ci/build-ca.sh). Every Dockerfile those
# builds read needs that stage, so a baseline without one is refused before anything runs.
PROOF_BUILD_CA=${PROOF_BUILD_CA:-${AUDIT_BUILD_CA:-}}
if [[ -n $PROOF_BUILD_CA ]]; then
  [[ -f $PROOF_BUILD_CA && -r $PROOF_BUILD_CA ]] || refuse "PROOF_BUILD_CA names no file that can be read: $PROOF_BUILD_CA"
  for ref in "$SHA" "${PICK[@]}"; do
    git show "$ref:Dockerfile" 2>/dev/null | grep -E '^FROM .* AS build$' >/dev/null \
      || refuse "The Dockerfile of $ref has no 'FROM ... AS build' stage, so PROOF_BUILD_CA cannot reach its build."
  done
fi

# shellcheck source=proof-drills.sh
. "$ROOT/tools/ci/proof-drills.sh" || exit 2
# One proof at a time on a machine: a lock that the legs inherit, so that it is held as long as any part of a proof runs. A
# second proof does not wait and removes nothing; leftovers below would take a running proof's drills folder otherwise.
LOCK=${TMPDIR:-/tmp}/local-proof-running.lock
[[ -e $LOCK ]] || : >"$LOCK" 2>/dev/null
exec 7<"$LOCK" || refuse "The lock file $LOCK cannot be opened."
flock -n 7 || refuse "Another local proof is running on this machine ($LOCK is held). One proof at a time; this one removed nothing."
leftovers

WORK=$(mktemp -d "${TMPDIR:-/tmp}/local-proof.XXXXXX") || refuse "No work folder could be made under ${TMPDIR:-/tmp}."
SRC=$WORK/src
LOGS=$WORK/logs
RUNNING=$WORK/running
DROOT=$WORK/drills # the drills' own folder: their clone (as root), their home, lane 0 (as root) and their install
mkdir -p "$LOGS" "$RUNNING" "$WORK/home" "$DROOT"
# the words that start a command as the user of the legs, and as the user of the drills with the clone they run in
AS=()
DRILL_AS=()
DSRC=$SRC
if [[ -n $DOCKER_GID ]]; then
  AS=(setpriv "--reuid=$PROOF_USER" "--regid=$PROOF_USER" "--groups=$DOCKER_GID" env "HOME=$WORK/home")
  DRILL_AS=(setpriv "--reuid=$DRILL_USER" "--regid=$DRILL_USER" "--groups=$DOCKER_GID" env "HOME=$DROOT/home")
  DSRC=$DROOT/src
  mkdir -p "$DROOT/home"
fi

# Every branch comes along, as a checkout with the whole history brings it, and the commit itself in any case. The drills'
# user gets a clone of that clone: git refuses a folder of another owner.
if ! {
  git clone -q --no-hardlinks --no-checkout "$ROOT" "$SRC" \
    && { git -C "$SRC" cat-file -e "$SHA^{commit}" 2>/dev/null || git push -q "$SRC" "$SHA:refs/heads/proved"; } \
    && git -C "$SRC" checkout -q --detach "$SHA" \
    && { [[ $DSRC == "$SRC" ]] || git clone -q --no-hardlinks "$SRC" "$DSRC"; }
} >"$LOGS/clone.log" 2>&1 </dev/null; then
  why=$(tail -n 2 "$LOGS/clone.log" | tr '\n' ' ')
  rm -rf "$WORK"
  refuse "The commit $SHORT could not be cloned into $SRC: $why"
fi
if ! CA_PATH=$(PROOF_BUILD_CA=$PROOF_BUILD_CA "$SRC/tools/ci/build-ca.sh" setup "$WORK" 2>"$LOGS/build-ca.log"); then
  why=$(tail -n 2 "$LOGS/build-ca.log" | tr '\n' ' ')
  rm -rf "$WORK"
  refuse "The docker of the proof (tools/ci/build-ca.sh) could not be set up: $why"
fi
[[ -s $LOGS/build-ca.log ]] || rm -f "$LOGS/build-ca.log"; export PATH=$CA_PATH:$PATH
if [[ -n $PROOF_BUILD_CA ]]; then
  # the machine's own tools (curl, git, node) often name the same CA, in a folder the legs' users cannot enter (/root):
  # every variable that names it names the copy they can read
  for k in $(compgen -e); do [[ ${!k} != "$PROOF_BUILD_CA" ]] || export "$k=$CA_PATH/build-ca.crt"; done
  export PROOF_BUILD_CA=$CA_PATH/build-ca.crt
fi

deal_lanes
# the baseline the drills' own install is made from: the oldest that can take a port and a name of its own, the state that
# the oldest installs have after one update
DRILL_REF=''
for ((k = 0; k < ${#PICK[@]}; k++)); do
  if movable "${PICK[k]}"; then DRILL_REF=${PICK[k]}; break; fi
done
# Started as root, lane 0 and the drills' install run as the drills' user (see the header). Beside the other lanes only
# with more than one lane; otherwise, and for a proof of one user, the drills come after every other leg, one at a time.
BESIDE=0
((${#AS[@]} && JOBS > 1 && DO_DRILLS)) && BESIDE=1
LANE0_ROOT=$WORK # where lane 0 makes its installs
((${#AS[@]} == 0)) || LANE0_ROOT=$DROOT
KEPT=$LANE0_ROOT/upgrade-${NEWEST//[^A-Za-z0-9._-]/_} # the install that the newest rehearsal leaves up for drills 3 and 4

if ((${#AS[@]})); then
  chown -R "$PROOF_USER:$PROOF_USER" "$WORK"
  chown -R "$DRILL_USER:$DRILL_USER" "$DROOT"
  chmod 711 "$WORK" # the drills' user enters it to reach its own folder
  if ! "${AS[@]}" test -r "$SRC/tools/ci/upgrade-run.sh"; then
    rm -rf "$WORK"
    refuse "User $PROOF_USER cannot read $SRC. Set TMPDIR to a folder that user can enter (TMPDIR=/tmp) and run again."
  fi
  if ! "${DRILL_AS[@]}" test -r "$DSRC/tools/ci/upgrade-run.sh"; then
    rm -rf "$WORK"
    refuse "User $DRILL_USER cannot read $DSRC. Set TMPDIR to a folder that user can enter (TMPDIR=/tmp) and run again."
  fi
fi

if [[ -f $VERDICTS ]]; then { tail -n 400 "$VERDICTS" >"$VERDICTS.new" && cat "$VERDICTS.new" >"$VERDICTS"; rm -f "$VERDICTS.new"; } 2>/dev/null; fi
T0=$SECONDS
LEGS=$((DO_IMAGE * 2 + DO_SIG + ${#RUN_REFS[@]} + DO_DRILLS * 3)) # the image, the smoke test, the signature, a rehearsal each, the drills' install and two drills parts
first_line

# part SECONDS NOTE LABEL: one line of the list that closes the proof (see parts). Written by many processes at once, one
# short line each.
part() { printf '%d|%s|%s\n' "$1" "$2" "$3" >>"$WORK/parts"; }

# leg NAME LABEL COMMAND...: one leg, started in the clone, in a session of its own so that a stop reaches all of it,
# as the user of the legs, with its output in logs/NAME.log. One line when it ends; a failed one is noted in the file
# `failed`. LEG_AS=drill (a plain variable of the caller's shell, not exported) starts the leg as the user of the drills, in
# their clone; LEG_NOTE goes beside the leg's seconds in the closing list.
leg() {
  local name=$1 label=$2 t0=$SECONDS rc=0 pid dir=$SRC who=("${AS[@]}")
  shift 2
  if [[ ${LEG_AS:-} == drill ]]; then dir=$DSRC; who=("${DRILL_AS[@]}"); fi
  (cd "$dir" && exec setsid nice -n "${PROOF_NICE:-10}" "${who[@]}" "$@") </dev/null >"$LOGS/$name.log" 2>&1 &
  pid=$!
  echo "$pid" >"$RUNNING/$name"
  # a stop that came between the start and the line above did not see this leg
  [[ ! -e $WORK/stop ]] || kill -TERM -- "-$pid" 2>/dev/null
  wait "$pid"; rc=$?
  # a signal that this shell catches ends `wait` early: the leg has ended only when it is gone
  while ((rc > 128)) && kill -0 "$pid" 2>/dev/null; do wait "$pid"; rc=$?; done
  rm -f "$RUNNING/$name"
  part $((SECONDS - t0)) "${LEG_NOTE:-}" "$label"
  if ((rc == 0)); then
    echo "$name" >>"$WORK/passed" # the proof passes only when every leg is in this file (see report)
    echo "ok      $label ($((SECONDS - t0)) s)$(grep -q '^cached: ' "$LOGS/$name.log" 2>/dev/null && echo ', cached')"
  elif ((rc == 143)) && [[ -e $WORK/halt ]]; then
    echo "stopped $label ($((SECONDS - t0)) s)" # cut by halt: not a fault of its own
  else
    echo "FAILED  $label ($((SECONDS - t0)) s): $LOGS/$name.log"
    echo "$name" >>"$WORK/failed"
    # one red fails the proof: the legs that run are cut and no new one starts, unless PROOF_KEEP_GOING=1 asks to see every failure
    [[ ${PROOF_KEEP_GOING:-} == 1 ]] || halt
  fi
  return "$rc"
}

# upgrade_leg REF LANE [keep]: the three steps of the upgrade workflow for one baseline. The rehearsal is the leg's own
# process (exec), so the leg has ended only when its install is down, unless keep leaves it up (the newest rehearsal, for
# drills 3 and 4). Lane 0 runs as the drills' user when the proof was started as root (the other lanes are never that user).
upgrade_leg() {
  local ref=$1 lane=$2 name set=() root=$WORK
  name=upgrade-${ref//[^A-Za-z0-9._-]/_}
  ((lane == 0)) || set=("UPGRADE_PORT=$((8080 + lane))" "UPGRADE_PROJECT=proof-$lane")
  [[ ${3:-} != keep ]] || set+=(UPGRADE_KEEP_UP=1)
  if ((lane == 0 && ${#AS[@]})); then LEG_AS=drill; root=$DROOT; fi
  LEG_NOTE="lane $lane"
  # the verdict of an earlier proof of this very tree from this very baseline stands (see "Verdicts"); the rehearsal that
  # leaves its install up for drills 3 and 4 always runs
  local key='' reused=0
  if [[ ${3:-} != keep ]] && key=$(verdict_key "$ref"); then
    if [[ ${PROOF_FRESH:-} != 1 ]] && grep -qxF "$key" "$VERDICTS" 2>/dev/null; then reused=1; fi
  fi
  if ((reused)); then
    leg "$name" "upgrade from $ref" echo "cached: the rehearsal from $ref passed before for this tree and this baseline"
    return 0
  fi
  if leg "$name" "upgrade from $ref" env "UPGRADE_WORK=$root/$name" "${set[@]}" bash -c \
    'tools/ci/check-migrations.sh "$1" && tools/ci/compose-compat.sh "$1" && exec tools/ci/upgrade-run.sh "$1"' leg "$ref"; then
    [[ -z $key ]] || echo "$key" >>"$VERDICTS"
    [[ ${3:-} != keep ]] || return 0
  fi
  rm -rf "${root:?}/$name" 2>/dev/null
}

tidy() { rm -rf "$SRC" "${WORK:?}/home" "$WORK/build-ca" "$RUNNING" "$DROOT" "$WORK"/upgrade-* "$WORK/parts" "$WORK/passed" "$WORK/setup.lock" 2>/dev/null; }

# parts: where the time went, the longest first: a line a leg with its seconds, and a line for each lane and for the drills
parts() {
  [[ -s $WORK/parts ]] || return 0
  echo "where the time went, the longest first:"
  {
    cat "$WORK/parts"
    awk -F'|' '$2 ~ /^lane / { t[$2] += $1 } END { for (k in t) printf "%d||%s, all its rehearsals\n", t[k], k }' "$WORK/parts"
  } | sort -t'|' -k1,1nr -s | while IFS='|' read -r s note label; do printf '  %4d s  %s%s\n' "$s" "$label" "${note:+ ($note)}"; done
}

# end_legs: no leg starts from now on, and the ones that run get TERM (each takes its install down)
end_legs() {
  : >"$WORK/stop"
  local f
  for f in "$RUNNING"/*; do [[ ! -e $f ]] || kill -TERM -- "-$(<"$f")" 2>/dev/null; done
}
# halt: the image or the smoke test failed. The legs that run are cut, and the drills will not run.
halt() { : >"$WORK/halt"; end_legs; }

stop() {
  trap '' INT TERM
  end_legs
  wait
  drop_kept
  tidy
  echo "local proof: stopped, so $SHORT is not proved. Logs: $LOGS"
  exit 143
}
trap stop INT TERM

# keep_images: the kept baseline images (proof-baseline:<hash>) whose commit the list no longer names are removed; one line
# says how many are kept. A ref that names no commit here leaves every image alone: it cannot say what is still named.
keep_images() {
  local named=' ' ref c tag kept=0 gone=0
  for ref in "${ALLREFS[@]}"; do
    c=$(git -C "$ROOT" rev-parse --verify -q "$ref^{commit}") || { echo "baseline images: $ref names no commit here, so none is removed"; return 0; }
    named+="$c "
  done
  while IFS= read -r tag; do
    [[ $tag =~ ^[0-9a-f]{40}$ ]] || continue
    if [[ $named == *" $tag "* ]]; then kept=$((kept + 1))
    elif docker rmi "proof-baseline:$tag" >/dev/null 2>&1; then gone=$((gone + 1))
    else kept=$((kept + 1)); fi
  done < <(docker image ls --format '{{.Tag}}' proof-baseline 2>/dev/null)
  echo "baseline images kept for the next proof: $kept ($gone removed, no longer in $LIST)"
}

# report [NOTE]: the last lines, the stamp when every leg passed, and the exit code
report() {
  local failed=() passed=() name
  [[ ! -f $WORK/failed ]] || mapfile -t failed <"$WORK/failed"
  [[ ! -f $WORK/passed ]] || mapfile -t passed <"$WORK/passed"
  drop_kept # an install that is still up (a lane lost its shell before the drills): no folder removal leaves it running
  parts
  tidy
  # a leg whose shell was lost leaves no line in either file: the proof passes only when every leg said ok
  if ((${#failed[@]} == 0 && ${#passed[@]} == LEGS)) && [[ -n $PART ]]; then
    echo "local proof part $PART passed for $SHORT in $((SECONDS - T0)) s: $LEGS legs. A part writes no stamp. Logs: $LOGS"
    exit 0
  fi
  if ((${#failed[@]} == 0 && ${#passed[@]} == LEGS)); then
    ((${#FROM_RECORDS[@]} == 0)) || echo "from the farm's records: ${FROM_RECORDS[*]}"
    printf '%s\n%s\n' "$SHA" "${PICK[*]}" >"$STAMP"
    keep_images
    echo "local proof passed for $SHORT in $((SECONDS - T0)) s: the image, the smoke test, the signature, ${#PICK[@]} baselines and the drills. Logs: $LOGS"
    exit 0
  fi
  if ((${#failed[@]} == 0)); then
    echo "local proof FAILED for $SHORT: ${#passed[@]} of $LEGS legs reported ok, the others ended without a result.${1:+ $1} Nothing is stamped."
    exit 1
  fi
  echo "local proof FAILED for $SHORT: ${#failed[@]} of $LEGS legs.${1:+ $1} Nothing is stamped."
  for name in "${failed[@]}"; do
    echo "  $name: $LOGS/$name.log"
    [[ ! -s $LOGS/$name.log ]] || tail -n 12 "$LOGS/$name.log" | cut -c1-200 | sed 's/^/    /'
  done
  exit 1
}

image_and_smoke() {
  leg image "the image builds" docker build -t banking-app:ci . \
    && leg smoke "smoke test of the image" tools/ci/smoke-image.sh banking-app:ci unknown unknown
}
if ((DO_IMAGE == 0)); then :
elif ((JOBS == 1)); then
  image_and_smoke || report "The other legs did not run."
else
  (trap : INT TERM; image_and_smoke || halt) &
fi

if ((BESIDE)); then
  # the lock that drills 3 and 4 wait for (lane0_drills) is taken before the install of the drills starts, held by it, and
  # let go of by the main shell before any lane starts, so that no lane holds it
  exec 8>"$WORK/setup.lock"
  flock 8
  (trap : INT TERM; own_chain) &
  exec 8>&-
fi
for ((k = 0; k < JOBS; k++)); do
  read -ra refs <<<"${LANES[k]}"
  ((${#refs[@]})) || continue
  (
    # a lane outlives a signal to the whole process group (Ctrl-C), so that it still waits for its leg to end
    trap : INT TERM
    for ref in "${refs[@]}"; do
      [[ ! -e $WORK/stop ]] || break
      if [[ $k == 0 && $ref == "$NEWEST" ]]; then upgrade_leg "$ref" "$k" keep; else upgrade_leg "$ref" "$k"; fi
    done
    if ((k == 0 && BESIDE)); then lane0_drills; fi
  ) &
done
((DO_SIG == 0)) || (trap : INT TERM; leg signature "signature of the newest release" tools/ci/verify-release.sh) &
wait

if [[ -e $WORK/halt ]]; then
  drop_kept
  report "The legs still running were stopped, and the drills did not run."
fi
if ((!BESIDE && DO_DRILLS)); then
  # one job, or a proof of one user: after every other leg, one at a time (drills 3 and 4, the drills' install, its drills)
  [[ -e $WORK/stop ]] || drills_default
  own_chain
fi
report
