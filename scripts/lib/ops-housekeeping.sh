# shellcheck shell=bash
# The helper's disk housekeeping, for scripts/ops-helper.sh. The helper's load_libs sources this file after
# check_permissions has passed on scripts/lib; it defines functions and nothing else.
#
#   housekeeping   heartbeat calls it, with no arguments, in its daily block: the tick that has no request to run and finds
#                  ops/last-check missing or a day old, after check_update, run_doctor and write_backups_frag. The app runs
#                  then. Its status is not read.
#
# When the disk Docker stores on has under 3 GB free, housekeeping removes this app's old images: it runs `act_prune own` (the
# helper's one definition of the Siivoa button's prune, with the label filter and without the build cache: docker image prune -f
# --filter label=talous.version, which Dockerfile sets on every image of this app), at most once in six hours
# (ops/housekeeping-at holds the time of the last try, in seconds). It is an unattended job on a Docker other software may
# share, so what other software left (untagged images without the label, the build cache) stays, and so does everything
# Docker keeps itself: what has a tag and what a container uses. This install's :latest and :previous, the image the app runs
# from, other projects' images and containers stay; no volume is touched. It does nothing while an action runs in this
# process or while the installer's lock (the one install.sh and update.sh take) is held, and then tries again at the next
# daily block. The result is one line in helper.log
# with the free space before and after; a tick that does not prune writes nothing.

HK_MIN_KB=$((3 * 1024 * 1024))
HK_GAP=$((6 * 3600))

# tried_within FILE NOW SECONDS: FILE holds the time of the last try, in seconds, and that is under SECONDS before NOW.
# A time in the future (the clock went back) or one that is not a time holds nothing back. The helper's one "not again
# within": the prune here and the change of the address (lib/ops-address.sh).
tried_within() {
  local at
  at=$(cat "$1" 2>/dev/null) || at=""
  [[ $at =~ ^[0-9]{1,12}$ ]] && ((10#$at <= $2 && $2 - 10#$at < $3))
}

# the image ID the running app container was made from, empty when it is not known
hk_running_image() {
  local c
  c=$(timeout 20 docker compose ps -q banking 2>/dev/null | head -1) || true
  [[ $c =~ ^[A-Za-z0-9]+$ ]] || return 0
  timeout 20 docker inspect -f '{{.Image}}' "$c" 2>/dev/null | head -1 || true
}

# The prune, in a shell of its own (so act_prune's STATUS, SUMMARY and LOGF stay out of the tick) and while holding the
# installer's lock. hk_prune NOW prints four lines: ok or failed, the exit code, act_prune's summary and the last line of its
# output. It returns 3 when the lock is held, and prints nothing then.
hk_prune() {
  local run_img
  declare -F installer_lock >/dev/null || return 4 # a lib/release.sh from before the function
  installer_lock || return 3
  printf '%s\n' "$1" >"$OPS/housekeeping-at"
  LOGF=$(mktemp "$OPS/run/housekeeping.XXXXXX") || return 4
  STATUS=ok; RC=0; SUMMARY=""
  run_img=$(hk_running_image)
  act_prune own
  # act_prune checked :latest and :previous. The image the app runs from is checked here: Docker does not remove an image a
  # container uses, so this is for a prune that did.
  if [[ $STATUS == ok && -n $run_img ]] && ! timeout 20 docker image inspect "$run_img" >/dev/null 2>&1; then
    fail "Siivous poisti käynnissä olevan version kuvan."
  fi
  printf '%s\n%s\n%s\n%s\n' "$STATUS" "$RC" "$SUMMARY" "$(scrub_out <"$LOGF" | tail -n 1 | head -c 120)"
  rm -f "$LOGF"
}

housekeeping() {
  local dir kb now out rc st prc sm ll after
  [[ -z ${LOGF:-} ]] || return 0   # an action is running
  now=$(date +%s)
  if tried_within "$OPS/housekeeping-at" "$now" "$HK_GAP"; then return 0; fi
  dir=$(timeout 20 docker info -f '{{.DockerRootDir}}' 2>/dev/null | head -1) || true
  [[ -n $dir && -d $dir ]] || return 0
  kb=$(free_kb "$dir")
  [[ $kb =~ ^[0-9]+$ ]] && ((kb < HK_MIN_KB)) || return 0
  out=$(hk_prune "$now"); rc=$?
  ((rc == 0)) || return 0   # the installer's lock is held or the log file could not be made: nothing was done
  { IFS= read -r st; IFS= read -r prc; IFS= read -r sm; IFS= read -r ll; } <<<"$out"
  after=$(free_kb "$dir"); [[ $after =~ ^[0-9]+$ ]] || after=$kb
  if [[ $st == ok ]]; then
    log "housekeeping: Docker's disk ($dir) had $((kb / 1024)) MB free; pruned this app's old images; now $((after / 1024)) MB free"
  else
    [[ $prc =~ ^[0-9]+$ ]] || prc=1
    log "housekeeping: Docker's disk ($dir) had $((kb / 1024)) MB free; the prune failed (exit $prc: $sm ${ll:-}); now $((after / 1024)) MB free"
  fi
  return 0
}
