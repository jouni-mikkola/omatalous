# shellcheck shell=bash disable=SC2154,SC2034
# The drills' part of tools/ci/local-proof.sh, sourced by it: the drills' own install and the drills on it and on lane 0's
# install, the clean-up of what a killed proof left of them, and the waiting between them. It defines functions and runs
# nothing; it reads the variables, `leg` and `part` of local-proof.sh when they are called (see the header there).
# the drills' own install: its port, its Compose project (which is also its container and its image; no lane has them), and the drills
# of the helper and of the own install (7 and 8 ride on 3)
DRILL_PORT=8280
DRILL_PROJECT=drills
HELPER_DRILLS="3 4"
OWN_DRILLS="1 2 5 6 9 10"


# leftovers: what a killed proof left of the drills' own install, found by its fixed names: the Compose project
# $DRILL_PROJECT (containers and volumes by its label), its image, drill 5's containers and volumes, and the drills folders
# of earlier work folders. One line says how many were removed. The default install and the lanes' are not looked at.
leftovers() {
  local x n=0 d label="label=com.docker.compose.project=$DRILL_PROJECT"
  for x in $(docker ps -aq --filter "$label" 2>/dev/null) drill-disk drill-disk-hold; do
    ! docker container inspect "$x" >/dev/null 2>&1 || { docker rm -f -v "$x" >/dev/null 2>&1; n=$((n + 1)); }
  done
  for x in $(docker volume ls -q --filter "$label" 2>/dev/null) drill-disk-data drill-disk-secrets; do
    ! docker volume inspect "$x" >/dev/null 2>&1 || { docker volume rm -f "$x" >/dev/null 2>&1; n=$((n + 1)); }
  done
  ! docker image inspect "$DRILL_PROJECT:latest" >/dev/null 2>&1 || { docker rmi -f "$DRILL_PROJECT:latest" >/dev/null 2>&1; n=$((n + 1)); }
  for d in "${TMPDIR:-/tmp}"/local-proof.*/drills; do [[ ! -d $d ]] || { rm -rf "$d" 2>/dev/null; n=$((n + 1)); }; done
  ((n == 0)) || echo "removed $n things that an earlier proof left of the drills' install (project $DRILL_PROJECT, drill 5, a drills folder)"
}

# The drills. drills_default: drills 3, 4 (with 7 and 8) on the install that lane 0 left up, with the default names and the
# port 8080. The drills' own install is made from DRILL_REF up to its update and left up, and drills_own runs drills 1, 2, 5, 6,
# 9 and 10 on it. LEG_AS=drill: both run as the drills' user when the proof was started as root, in its clone.
drills_label() { echo "drills ${1// /, }"; }
drills_default() {
  LEG_AS=drill
  if [[ ! -d $KEPT/talous ]]; then not_run default "3 4 7 8" "the rehearsal from $NEWEST that they stand on failed"; return 0; fi
  leg drills-default "$(drills_label "3 4 7 8")" env "UPGRADE_WORK=$KEPT" "DRILLS_ONLY=$HELPER_DRILLS" tools/ci/drills.sh
}
drills_vars() { DV=("UPGRADE_WORK=$DROOT/own" "UPGRADE_PORT=$DRILL_PORT" "UPGRADE_PROJECT=$DRILL_PROJECT"); }
drills_install() {
  drills_vars; LEG_AS=drill
  leg drills-install "install for $(drills_label "$OWN_DRILLS")" env "${DV[@]}" UPGRADE_UNTIL=update UPGRADE_KEEP_UP=1 tools/ci/upgrade-run.sh "$DRILL_REF"
}
drills_own() {
  drills_vars; LEG_AS=drill
  leg drills-own "$(drills_label "$OWN_DRILLS")" env "${DV[@]}" "DRILLS_ONLY=$OWN_DRILLS" tools/ci/drills.sh
}
# not_run KEY DRILLS WHY: a drills leg that cannot start; its log says why
not_run() {
  echo "FAILED  $(drills_label "$2"): not run, $3"
  echo "not run: $3" >"$LOGS/drills-$1.log"
  echo "drills-$1" >>"$WORK/failed"
}
# wait_for PID: its status, though a signal that this shell catches ends `wait` early
wait_for() {
  local rc=0
  wait "$1"; rc=$?
  while ((rc > 128)) && kill -0 "$1" 2>/dev/null; do wait "$1"; rc=$?; done
  return "$rc"
}
# own_chain: the drills' own install, then, when it stands and no stop has come, its drills. The install holds the lock
# $WORK/setup.lock (file descriptor 8, taken by the main shell before this starts) while it is made: drills 3 and 4 in lane 0
# wait for that lock, because the update.sh of this install is the one that the watchdog of those drills would count. The
# drills of this install start no update.sh. An install that failed leaves its drills a failed leg ("not run").
own_chain() {
  local t0=$SECONDS p ok=0
  if [[ -z $DRILL_REF ]]; then
    exec 8>&-
    not_run own "$OWN_DRILLS" "no baseline of this proof reads a port and a name in its docker-compose.yml, so no install of the drills can stand beside the rehearsals"
    return 0
  fi
  (trap : INT TERM; drills_install) & p=$!
  wait_for "$p" && ok=1
  exec 8>&-
  if [[ ! -e $WORK/stop ]]; then
    if ((ok)); then
      (trap : INT TERM; drills_own) & p=$!
      wait_for "$p"
    else
      not_run own "$OWN_DRILLS" "the install they stand on failed"
    fi
  fi
  part $((SECONDS - t0)) "" "the drills' own install and its drills"
}
# lane0_drills: at the end of lane 0, beside the other lanes: drills 3 and 4 once the drills' own install has been made
lane0_drills() {
  [[ ! -e $WORK/stop ]] || return 0
  # bounded: a process that outlived the install leg and still holds the lock must not hang the proof (PROOF_SETUP_WAIT, seconds)
  if ! flock -w "${PROOF_SETUP_WAIT:-900}" "$WORK/setup.lock" true; then
    not_run default "3 4 7 8" "the drills' install did not finish: $WORK/setup.lock is still held after ${PROOF_SETUP_WAIT:-900} s"
    return 0
  fi
  [[ ! -e $WORK/stop ]] || return 0
  LEG_NOTE="lane 0"
  drills_default
}

# the installs of the drills that no drill took down (a cut or a failed proof); a drills leg removes its own
drop_kept() {
  local d
  for d in "$KEPT" "$DROOT/own"; do
    [[ -d $d/talous ]] || continue
    (cd "$d/talous" && "${DRILL_AS[@]}" docker compose down -v) >>"$LOGS/drills-down.log" 2>&1
  done
}
