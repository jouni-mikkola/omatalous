#!/usr/bin/env bash
# What the Docker job of CI and the upgrade workflow prove, on this machine, as one command and with no billed minute:
#
#   tools/ci/local-proof.sh [--all] [--jobs N] BASELINES     prove the commit that is checked out
#   tools/ci/local-proof.sh --proved [--all] BASELINES       exit 0 when that commit is proved already; runs nothing
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
#   drills             tools/ci/drills.sh, on the install that the rehearsal from the first baseline left up
#
# Everything but the drills starts at once: the image and then the smoke test in a chain of their own, the signature,
# and the rehearsals in their lanes. They share nothing: a rehearsal makes its own images (never banking-app:ci), the
# smoke test publishes no port and names its containers after its own pid, and the signature only reads. The drills start
# when all of those have ended. With one job the image and the smoke test run first and alone, and a red one ends the
# proof before any other leg starts.
#
# Images that are kept: the image of a baseline is the same one in every proof, so a rehearsal keeps it under the name
# proof-baseline:<the full hash of the baseline's commit> once its install has come up, and a later proof starts from it
# instead of building it (upgrade-run.sh; the name is the only claim, and the hash is read from the clone, never from a ref).
# PROOF_FRESH=1 builds every baseline image anew and keeps the new one. At the end of a green proof the kept images whose
# commit the list no longer names are removed, and one line says how many are kept. The image of the commit under proof is
# not shared by name: every rehearsal's update.sh builds it, as a user's update does (that build is part of what is proved),
# and the layers the image leg builds at the same time are the Docker cache it reuses. What the builds and the other
# phases take is in each rehearsal's log, one line a phase ("phase update: 31 s"), and the drills' log has a line a drill.
#
# One line a leg when it ends, with its seconds. A failed leg does not stop the others, so that one proof shows every
# failure; a failed image or smoke test is the exception, since every rehearsal builds the same Dockerfile: it stops the
# legs that are running (each takes its install down), the drills do not run, and the line "stopped" stands for each
# leg that was cut. At the end the failed ones are named with their logs and the exit code is 1. Exit 2 means it
# refused before it ran anything. A commit that passed gets a stamp in the git folder, with the baselines it was proved
# from, and the next run for the same commit ends at once (remove the file `local-proof` there to run it again).
#
# Which baselines: all of the list when the commit changes what an update runs through, compared with the last ref of
# the list (the last release): a migration, scripts/, the compose file, the Dockerfile or tools/ci/. Otherwise the
# oldest, the first public release (the ref under the comment line that says "first public release") and the last
# three. --all takes the whole list.
#
# --jobs N (or PROOF_JOBS; the flag wins) is how many rehearsals run at once, each in a lane. Without either it is one
# lane for every 4 CPUs, at least 4 and at most the number of rehearsals. A machine too small for that sets PROOF_JOBS=1
# (also through release.sh), and the rehearsals run one after another. Lane 0 has port 8080 and the names
# docker-compose.yml gives without a key. Lane N has port 8080+N and the project proof-N (UPGRADE_PORT and
# UPGRADE_PROJECT of upgrade-run.sh). Three rehearsals stay one at a time, in lane 0:
#   - from a baseline whose docker-compose.yml fixes the port and the names (the ones before 0.4.0),
#   - from the newest baseline, so that the update most installs make runs with the default names,
#   - from the first baseline, last, because its install stays up for the drills.
# The drills run when every other leg has ended: they stand on the ports 8080 and 18080 and on the default names, and
# their watchdog counts every update.sh of the same user, so a rehearsal beside them could keep a drill from its
# rollback. For the same reasons one proof runs on a machine at a time.
#
# The maintenance helper refuses root, so no leg runs as root. Started as root, the script hands the clone and its
# work folder to user 1 (PROOF_USER names another uid) and starts each leg as that user with the group `docker`
# (setpriv). No test install may run as that user at the same time. Started as another user, the legs run as that user.
# INT or TERM stops the legs, each of which takes its install down, and proves nothing.
# Needs git, a running Docker and setsid, and what the legs need (curl, node, jq, the network for the signature). The
# work folder is a new one under TMPDIR (/tmp); its logs stay, the rest is removed.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
JOBS='' # from the flag or PROOF_JOBS, else from the CPUs once the baselines are picked
ALL=0
# jobs_are NAME VALUE: the number of rehearsals at once, from the flag or from the environment
jobs_are() { [[ ${2:-} =~ ^[1-9][0-9]?$ ]] || refuse "$1 needs a number from 1 to 99."; JOBS=$2; }
PROVED=0
LIST=''
PROOF_USER=${PROOF_USER:-1}
# what an update runs through: a change here since the last release is proved from every baseline
PATHS=(apps/server/migrations scripts 'docker-compose*.yml' Dockerfile tools/ci)
USAGE="usage: local-proof.sh [--all] [--jobs N] BASELINES, or --proved [--all] BASELINES"
# a rehearsal takes these from the lane it runs in and from nowhere else
unset UPGRADE_PORT UPGRADE_PROJECT UPGRADE_WORK UPGRADE_KEEP_UP

refuse() { printf 'Error: %s\n' "$*" >&2; exit 2; }

[[ -z ${PROOF_JOBS:-} ]] || jobs_are PROOF_JOBS "$PROOF_JOBS"
while (($#)); do
  case $1 in
    --all) ALL=1 ;;
    --proved) PROVED=1 ;;
    --jobs) jobs_are --jobs "${2:-}"; shift ;;
    -h | --help) sed -n '2,/^set /{/^#/p}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) refuse "Unknown option: $1 ($USAGE)" ;;
    *) [[ -z $LIST ]] || refuse "Give one list of baselines ($USAGE)."; LIST=$1 ;;
  esac
  shift
done
[[ -n $LIST ]] || refuse "Which list of baselines? ($USAGE)"

cd "$ROOT" || exit 2
SHA=$(git rev-parse --verify -q HEAD) || refuse "$ROOT is not a git checkout with a commit."
SHORT=${SHA:0:7}
STAMP=$(git rev-parse --git-path local-proof)
TEXT=$(git show "$SHA:$LIST" 2>/dev/null) || refuse "$LIST is not a file of the commit $SHORT (name it from the root of the repository)."

# pick_baselines TEXT: the baselines this proof runs, into PICK in the order of the list, and why into WHY. The one
# place for the rule in the header.
PICK=()
ALLREFS=() # every ref of the list, picked or not
WHY=''
pick_baselines() {
  local refs=() marked='' above='' l last changed i n
  while IFS= read -r l; do
    l=${l#"${l%%[![:space:]]*}"}
    l=${l%"${l##*[![:space:]]}"}
    case $l in
      '') ;;
      '#'*) above=$l ;;
      *)
        [[ " ${refs[*]:-} " == *" $l "* ]] || refs+=("$l")
        [[ $above != *"first public release"* ]] || marked=$l
        above='' ;;
    esac
  done <<<"$1"
  n=${#refs[@]}
  ((n)) || return 1
  ALLREFS=("${refs[@]}")
  last=${refs[n - 1]}
  if ((ALL)); then PICK=("${refs[@]}"); WHY="--all"; return 0; fi
  # a last ref that is no commit here cannot say that nothing changed
  if ! changed=$(git diff --name-only "$last" "$SHA" -- "${PATHS[@]}" 2>/dev/null); then
    PICK=("${refs[@]}"); WHY="no diff from $last, the last of the list, could be read"; return 0
  fi
  if [[ -n $changed ]]; then PICK=("${refs[@]}"); WHY="${changed%%$'\n'*} changed since $last"; return 0; fi
  for i in "${!refs[@]}"; do
    if ((i == 0 || i >= n - 3)) || [[ ${refs[i]} == "$marked" ]]; then PICK+=("${refs[i]}"); fi
  done
  WHY="nothing an update runs through changed since $last"
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
  echo "local proof: $SHORT is proved already from ${PICK[*]} (the stamp is $STAMP). Nothing ran."
  exit 0
fi

if [[ -z $JOBS ]]; then
  JOBS=$(($(nproc 2>/dev/null || echo 4) / 4))
  ((JOBS >= 4)) || JOBS=4
  ((JOBS <= ${#PICK[@]})) || JOBS=${#PICK[@]}
  ((JOBS <= 99)) || JOBS=99
fi

for c in docker setsid; do command -v "$c" >/dev/null 2>&1 || refuse "$c is not installed."; done
docker info >/dev/null 2>&1 || refuse "Docker does not answer (docker info). Start it, for example with: systemctl start docker. Then run again."
DOCKER_GID=''
if [[ $(id -u) == 0 ]]; then
  command -v setpriv >/dev/null 2>&1 || refuse "setpriv is not installed (util-linux), and the legs cannot run as root."
  DOCKER_GID=$(getent group docker | cut -d: -f3)
  [[ -n $DOCKER_GID ]] || refuse "This machine has no group docker, so user $PROOF_USER could not reach Docker. Run the proof as a user that can."
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/local-proof.XXXXXX") || refuse "No work folder could be made under ${TMPDIR:-/tmp}."
SRC=$WORK/src
LOGS=$WORK/logs
RUNNING=$WORK/running
KEPT='' # the work folder of the rehearsal whose install stays up for the drills
mkdir -p "$LOGS" "$RUNNING" "$WORK/home"
# the words that start a command as the user of the legs
AS=()
[[ -z $DOCKER_GID ]] || AS=(setpriv "--reuid=$PROOF_USER" "--regid=$PROOF_USER" "--groups=$DOCKER_GID" env "HOME=$WORK/home")

# Every branch comes along, as a checkout with the whole history brings it, and the commit itself in any case.
if ! {
  git clone -q --no-hardlinks --no-checkout "$ROOT" "$SRC" \
    && { git -C "$SRC" cat-file -e "$SHA^{commit}" 2>/dev/null || git push -q "$SRC" "$SHA:refs/heads/proved"; } \
    && git -C "$SRC" checkout -q --detach "$SHA"
} >"$LOGS/clone.log" 2>&1 </dev/null; then
  why=$(tail -n 2 "$LOGS/clone.log" | tr '\n' ' ')
  rm -rf "$WORK"
  refuse "The commit $SHORT could not be cloned into $SRC: $why"
fi

# movable REF: the docker-compose.yml of the baseline reads the keys of a port and a name, so its rehearsal can run
# in another lane than 0 (upgrade-run.sh refuses the keys otherwise). Asked here, before the clone changes its owner.
movable() {
  local c
  c=$(git show "$1:docker-compose.yml" 2>/dev/null) || return 1
  [[ $c == *"\${HOST_PORT"* && $c == *"\${INSTANCE_NAME"* ]]
}
FIRST=${PICK[0]}
NEWEST=${PICK[${#PICK[@]} - 1]}
LANES=() # the refs of each lane, in the order they run
for ((k = 0; k < JOBS; k++)); do LANES+=(''); done
legs_of() { local w; read -ra w <<<"$1"; echo "${#w[@]}"; }
for ref in "${PICK[@]}"; do
  [[ $ref != "$FIRST" ]] || continue
  k=0
  if [[ $ref != "$NEWEST" ]] && movable "$ref"; then
    # the lane with the fewest legs; lane 0 counts the first baseline, which it runs last
    least=$(($(legs_of "${LANES[0]}") + 1))
    for ((j = 1; j < JOBS; j++)); do
      n=$(legs_of "${LANES[j]}")
      if ((n < least)); then least=$n; k=$j; fi
    done
  fi
  LANES[k]+=" $ref"
done
LANES[0]+=" $FIRST"

if ((${#AS[@]})); then
  chown -R "$PROOF_USER:$PROOF_USER" "$WORK"
  if ! "${AS[@]}" test -r "$SRC/tools/ci/upgrade-run.sh"; then
    rm -rf "$WORK"
    refuse "User $PROOF_USER cannot read $SRC. Set TMPDIR to a folder that user can enter (TMPDIR=/tmp) and run again."
  fi
fi

T0=$SECONDS
LEGS=$((${#PICK[@]} + 4))
echo "local proof of $SHORT: ${#PICK[@]} baselines ($WHY), $JOBS at a time. Logs: $LOGS"

# leg NAME LABEL COMMAND...: one leg, started in the clone, in a session of its own so that a stop reaches all of it,
# as the user of the legs, with its output in logs/NAME.log. One line when it ends; a failed one is noted in the file
# `failed`.
leg() {
  local name=$1 label=$2 t0=$SECONDS rc=0 pid
  shift 2
  (cd "$SRC" && exec setsid "${AS[@]}" "$@") </dev/null >"$LOGS/$name.log" 2>&1 &
  pid=$!
  echo "$pid" >"$RUNNING/$name"
  # a stop that came between the start and the line above did not see this leg
  [[ ! -e $WORK/stop ]] || kill -TERM -- "-$pid" 2>/dev/null
  wait "$pid"; rc=$?
  # a signal that this shell catches ends `wait` early: the leg has ended only when it is gone
  while ((rc > 128)) && kill -0 "$pid" 2>/dev/null; do wait "$pid"; rc=$?; done
  rm -f "$RUNNING/$name"
  if ((rc == 0)); then
    echo "ok      $label ($((SECONDS - t0)) s)"
  elif ((rc == 143)) && [[ -e $WORK/halt ]]; then
    echo "stopped $label ($((SECONDS - t0)) s)" # cut by halt: not a fault of its own
  else
    echo "FAILED  $label ($((SECONDS - t0)) s): $LOGS/$name.log"
    echo "$name" >>"$WORK/failed"
  fi
  return "$rc"
}

# upgrade_leg REF LANE [keep]: the three steps of the upgrade workflow for one baseline. The rehearsal is the leg's own
# process (exec), so the leg has ended only when its install is down.
upgrade_leg() {
  local ref=$1 lane=$2 name set=()
  name=upgrade-${ref//[^A-Za-z0-9._-]/_}
  ((lane == 0)) || set=("UPGRADE_PORT=$((8080 + lane))" "UPGRADE_PROJECT=proof-$lane")
  [[ ${3:-} != keep ]] || set+=(UPGRADE_KEEP_UP=1)
  if leg "$name" "upgrade from $ref" env "UPGRADE_WORK=$WORK/$name" "${set[@]}" bash -c \
    'tools/ci/check-migrations.sh "$1" && tools/ci/compose-compat.sh "$1" && exec tools/ci/upgrade-run.sh "$1"' leg "$ref" \
    && [[ ${3:-} == keep ]]; then
    return 0
  fi
  rm -rf "${WORK:?}/$name" 2>/dev/null
}

# the install that the rehearsal from the first baseline left up, when no drills will take it down
drop_kept() {
  [[ -n $KEPT && -d $KEPT/talous ]] || return 0
  (cd "$KEPT/talous" && "${AS[@]}" docker compose down -v) >>"$LOGS/drills.log" 2>&1
}
tidy() { rm -rf "$SRC" "${WORK:?}/home" "$RUNNING" "$WORK"/upgrade-* 2>/dev/null; }

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
  local failed=() name
  [[ ! -f $WORK/failed ]] || mapfile -t failed <"$WORK/failed"
  tidy
  if ((${#failed[@]} == 0)); then
    printf '%s\n%s\n' "$SHA" "${PICK[*]}" >"$STAMP"
    keep_images
    echo "local proof passed for $SHORT in $((SECONDS - T0)) s: the image, the smoke test, the signature, ${#PICK[@]} baselines and the drills. Logs: $LOGS"
    exit 0
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
if ((JOBS == 1)); then
  image_and_smoke || report "The other legs did not run."
else
  (trap : INT TERM; image_and_smoke || halt) &
fi

KEPT=$WORK/upgrade-${FIRST//[^A-Za-z0-9._-]/_}
for ((k = 0; k < JOBS; k++)); do
  read -ra refs <<<"${LANES[k]}"
  ((${#refs[@]})) || continue
  (
    # a lane outlives a signal to the whole process group (Ctrl-C), so that it still waits for its leg to end
    trap : INT TERM
    for ref in "${refs[@]}"; do
      [[ ! -e $WORK/stop ]] || break
      if [[ $ref == "$FIRST" ]]; then upgrade_leg "$ref" "$k" keep; else upgrade_leg "$ref" "$k"; fi
    done
  ) &
done
(trap : INT TERM; leg signature "signature of the newest release" tools/ci/verify-release.sh) &
wait

if [[ -e $WORK/halt ]]; then
  drop_kept
  report "The legs still running were stopped, and the drills did not run."
fi
if [[ -d $KEPT/talous ]]; then
  leg drills "drills" env "UPGRADE_WORK=$KEPT" tools/ci/drills.sh
else
  echo "FAILED  drills: not run, the rehearsal from $FIRST that they stand on failed"
  echo "not run: the rehearsal from $FIRST failed, so there is no install to drill" >"$LOGS/drills.log"
  echo drills >>"$WORK/failed"
fi
report
