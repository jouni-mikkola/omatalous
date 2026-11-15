# shellcheck shell=bash
# shellcheck disable=SC2154 # dim, bold and reset are set by scripts/update.sh, which sources this file
# The seconds of each step of an update. Sourced by update.sh, which provides say, dim, bold and reset.
# Each step of an update says how long it took when the next one starts (lap), and the update ends with one line of
# them all (steps_summary), so a slow update shows where the time went. tools/ci/upgrade-run.sh reads the "Update took"
# line against the budget in docs/RELEASING.md.
STEP_NAME=''; STEP_AT=$SECONDS; STEP_TIMES=()
lap() {
  [[ -n $STEP_NAME ]] || return 0
  local s=$((SECONDS - STEP_AT))
  printf '%s  %s: %d s%s\n' "$dim" "$STEP_NAME" "$s" "$reset"
  STEP_TIMES+=("$STEP_NAME $s")
  STEP_NAME=''
}
step() { lap; printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; STEP_NAME=${*%…}; STEP_AT=$SECONDS; }
# quiet_step NAME: the next step with no heading
quiet_step() { lap; STEP_NAME=$1; STEP_AT=$SECONDS; }
steps_summary() {
  local t=0 line='' e
  lap
  for e in "${STEP_TIMES[@]}"; do t=$((t + ${e##* })); line+="${line:+, }${e% *} ${e##* } s"; done
  say "Update took $t s ($line)"
}
