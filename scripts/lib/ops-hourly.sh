# shellcheck shell=bash
# The version check once an hour, for scripts/ops-helper.sh. The helper's load_libs sources this file after check_permissions
# has passed on scripts/lib; it defines functions and nothing else.
#
#   hourly_due             0 when ops/last-hourly is missing or over an hour old. It is the second mark, beside ops/last-check:
#                          that one still sets the daily round (doctor, the backups list, housekeeping) and is not touched here.
#   held_check             the heartbeat's check_update, for the daily round and the hourly check alike. It touches
#                          ops/last-hourly whatever the answer, so a failed check is tried again after an hour and not before,
#                          and it does not offer a version the watchdog took back within the last 24 hours.
#   taken_back_mark VER    the watchdog's rollback calls it with the version it went back from.
#   taken_back_holds VER TIP   write_check_frag (lib/ops-release.sh) asks it while held_check runs: 0 when VER, or a source
#                          install's fetched tip TIP, is what was taken back less than 24 hours ago.
# A check a person asks for (Tarkista päivitykset) is not held back: it shows what is there.
HOLD_BACK=0
hourly_due() { [[ ! -f $OPS/last-hourly ]] || [[ -n $(find "$OPS/last-hourly" -mmin +59 2>/dev/null) ]]; }
held_check() {
  local rc=0
  HOLD_BACK=1; check_update >/dev/null 2>&1 || rc=$?; HOLD_BACK=0
  touch "$OPS/last-hourly"
  return "$rc"
}
taken_back_mark() { # taken_back_mark VERSION: ops/taken-back is "SECONDS VERSION TIP" ("-" for what is not known)
  local tip
  if on_private; then tip=$(git rev-parse --verify -q "$(private_ref)" 2>/dev/null) || tip=""
  else tip=$(git rev-parse --verify -q "refs/remotes/origin/$(pol_get BRANCH)" 2>/dev/null) || tip=""; fi
  [[ $tip =~ ^[0-9a-f]{40}$ ]] || tip=-
  [[ ${1:-} =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || set -- -
  printf '%s %s %s\n' "$(date +%s)" "$1" "$tip" >"$OPS/taken-back" 2>/dev/null || true
}
taken_back_holds() { # taken_back_holds VERSION TIP
  local at ver tip now
  [[ $HOLD_BACK == 1 ]] && read -r at ver tip <"$OPS/taken-back" 2>/dev/null || return 1
  now=$(date +%s); [[ $at =~ ^[0-9]{1,12}$ && $now =~ ^[0-9]{1,12}$ ]] && ((now >= at && now - at < 86400)) || return 1
  [[ (-n $1 && $1 == "$ver") || (-n ${2:-} && $2 != - && $2 == "$tip") ]]
}
