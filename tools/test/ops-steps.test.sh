#!/usr/bin/env bash
# Tests for scripts/lib/ops-step.sh (the helper tells the app each step while an action runs) and scripts/lib/ops-hourly.sh (the
# version check once an hour, with the second mark ops/last-hourly). The world (clone, ticks, stub docker) is
# tools/test/ops-world.sh; its docker answers `ops progress` and writes the line it was given to calls.log as PROGRESS, and
# the files progress-refuse and progress-hang there make it an app that does not know the command or one that never answers.
#
#   tools/test/ops-steps.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by ops-world.sh (unprivileged)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged ops-steps.test.sh "$@"

ID=op_0123456789abcdef
told() { n_calls 'ops progress'; }                 # calls of the command, whatever the stub answered
lock_free() { (exec 7>>"$CL/ops/.lock"; flock -n 7); }
frag_offers() { grep -o '"update_available":[a-z]*' "$CL/ops/check.frag" 2>/dev/null | cut -d: -f2; }
age_hourly() { touch -d "$1 minutes ago" "$CL/ops/last-hourly"; }

# ── telling ─────────────────────────────────────────────────────────────────
t_step_each_step_of_four() {
  new_world; release 0.2.0; tick; poll update; : >"$S/calls.log"
  tick
  check "steps: a 4-step update tells the app four times, once per step" test "$(told)" = 4 -a "$(n_calls '^PROGRESS ')" = 4
  check "steps: the line is the helper's fixed text, with the polled id" grep -qF "PROGRESS {\"id\":\"$ID\",\"step\":{\"n\":2,\"m\":4,\"text\":\"Haetaan ja vaihdetaan versio\"}}" "$S/calls.log"
  check "steps: the update ran and was reported ok" test "$(cver)" = 0.2.0 && reported ok
  check "steps: the lock's descriptor did not reach the client, and the lock is free" test "$(n_calls LOCK-FD-LEAKED)" = 0 && lock_free
  check "steps: the log has the STEP line as before and the seconds on the next line" grep -qE 'STEP: 2/4 Haetaan ja vaihdetaan versio\\nSTEP-AT: 2/4 [0-9]+\\n' "$S/reports/$(nreports).json"
}
t_step_not_for_one_step() {
  new_world; tick; poll doctor; : >"$S/calls.log"
  tick
  check "steps: a 1/1 action tells nothing, and writes its STEP-AT line" test "$(told)" = 0 && grep -qE 'STEP: 1/1 Tarkistetaan asennus\\nSTEP-AT: 1/1 [0-9]+' "$S/reports/$(nreports).json"
  poll check-update "op_0123456789abcde0"; : >"$S/calls.log"
  tick
  check "steps: nor does the version check" test "$(told)" = 0 -a "$(n_calls 'ops progress')" = 0
  poll backup "op_0123456789abcde1"; : >"$S/calls.log"
  tick
  check "steps: a 2-step action does (the near miss)" test "$(told)" = 2
}
t_step_after_refusal() {
  new_world; release 0.2.0; tick; poll update; touch "$S/progress-refuse"; : >"$S/calls.log"
  tick
  check "steps: after the first refusal (an older app) no call in that request" test "$(told)" = 1 -a "$(cver)" = 0.2.0
  check "steps: and the action still ends ok" reported ok
  rm -f "$S/progress-refuse"; poll backup "op_0123456789abcde1"; : >"$S/calls.log"
  tick
  check "steps: the next request asks again" test "$(told)" = 2
}
t_step_hung_call() {
  new_world; tick; poll backup; touch "$S/progress-hang"; : >"$S/calls.log"
  local t0=$SECONDS
  tick OPS_T_PROGRESS=2
  check "steps: a call that never answers is cut at its limit, the action ends ok and asks no more" test "$(told)" = 1 -a "$((SECONDS - t0))" -lt 25 && reported ok
  check "steps: and the lock is free" lock_free
}
t_step_hook_zero() {
  new_world; tick; poll backup; : >"$S/calls.log"
  tick OPS_T_PROGRESS=0
  check "steps: OPS_T_PROGRESS=0 (the drills) makes no call, and the action runs" test "$(told)" = 0 && reported ok
}
t_step_container_down() { # step_tell on its own, with the stub's docker: the app's container is not running
  new_world; tick; : >"$S/calls.log"
  local run="source '$SRC/scripts/lib/ops-step.sh'; t_for() { echo 10; }; json_str() { printf '\"%s\"' \"\$1\"; }; NODE=(node); OPS_HELPER_VERSION=5
    app_running() { [[ -n \$(timeout 20 docker compose ps --status running -q banking 2>/dev/null) ]]; }
    STEP_ID=$ID; step_tell 2/4 text"
  rm -f "$S/running"
  env OPS_STUB_DIR="$S" PATH="$S/bin:$PATH" bash -c "$run"
  check "steps: the container is down: no call (only the look at it)" test "$(told)" = 0 -a "$(n_calls 'ps --status running')" = 1
  touch "$S/running"
  env OPS_STUB_DIR="$S" PATH="$S/bin:$PATH" bash -c "$run"
  check "steps: the container is up: the call is made (the near miss)" test "$(told)" = 1
}

# ── the check once an hour ──────────────────────────────────────────────────
t_hourly_marks() {
  new_world; release 0.2.0; tick
  check "hourly: the first tick checks and makes both marks" test "$(n_calls '^curl ')" = 1 -a -f "$CL/ops/last-check" -a -f "$CL/ops/last-hourly"
  : >"$S/calls.log"; tick
  check "hourly: a tick inside the hour does not check" test "$(n_calls '^curl ')" = 0
  age_hourly 58; tick
  check "hourly: 58 minutes is not an hour" test "$(n_calls '^curl ')" = 0
  local daily; touch -d '1 minute ago' "$CL/ops/last-check"; daily=$(stat -c %Y "$CL/ops/last-check")
  age_hourly 62; rm -f "$S/state.last"; tick
  check "hourly: after an hour it checks once, sends the answer at once, and does not touch the daily mark" test "$(n_calls '^curl ')" = 1 -a -f "$S/state.last" -a "$(stat -c %Y "$CL/ops/last-check")" = "$daily"
  check "hourly: and it is in the answer" grep -q '"update_available":true' "$S/state.last"
  check "hourly: the daily round did not run (no doctor result written again)" test "$(find "$CL/ops/last-hourly" -mmin -1 | wc -l)" = 1 -a "$(n_calls '^housekeeping')" = 0
}
t_hourly_daily_round_untouched() {
  new_world; release 0.2.0; tick; : >"$S/calls.log"
  touch -d '2 days ago' "$CL/ops/last-check"; rm -f "$S/state.last"; tick
  check "hourly: the daily round still runs when its own mark is a day old: one check, both marks new" test "$(n_calls '^curl ')" = 1 -a "$(find "$CL/ops/last-check" "$CL/ops/last-hourly" -mmin -1 | wc -l)" = 2 -a -f "$S/state.last"
}
t_hourly_failed_check() {
  new_world; release 0.2.0; tick; echo 500 >"$S/release.status"; : >"$S/calls.log"
  age_hourly 62; tick
  check "hourly: a failed check is made once" test "$(n_calls '^curl ')" = 1
  tick
  check "hourly: and not again before the hour has passed" test "$(n_calls '^curl ')" = 1
  echo 200 >"$S/release.status"; age_hourly 62; tick
  check "hourly: an hour later it tries again" test "$(n_calls '^curl ')" = 2 && [[ $(frag_offers) == true ]]
}
t_hourly_taken_back() {
  new_world; set_clock; release 0.2.0; tick
  check "taken back: the version is on offer before the rollback" test "$(frag_offers)" = true
  echo "$T0 0.2.0 -" >"$CL/ops/taken-back"
  local offered=""
  for _ in $(seq 1 24); do
    later 3600; age_hourly 62; tick
    offered+=$(frag_offers | cut -c1)
  done
  check "taken back: 24 hourly checks over a day: not offered for the first 23, offered at the 24th" test "$offered" = ffffffffffffffffffffffft
  check "taken back: the checks did look (24 of them, plus the first)" test "$(n_calls '^curl ')" = 25
  new_world; set_clock; release 0.2.0; tick; echo "$T0 0.2.0 -" >"$CL/ops/taken-back"; release 0.3.0; later 3600; age_hourly 62; tick
  check "taken back: another, newer version is offered at once (the near miss)" test "$(frag_offers)" = true
  new_world; set_clock; release 0.2.0; tick; echo "$T0 0.2.0 -" >"$CL/ops/taken-back"; later 3600; age_hourly 62; tick
  poll check-update; tick
  check "taken back: a check a person asks for shows what is there" test "$(frag_offers)" = true
}
t_hourly_taken_back_source() {
  new_world; set_clock; setenv TALOUS_CHANNEL=source; src_commit; tick
  check "taken back, source: the fetched commits are on offer before" test "$(frag_offers)" = true
  echo "$T0 - $(git -C "$CL" rev-parse refs/remotes/origin/main)" >"$CL/ops/taken-back"
  later 3600; age_hourly 62; tick
  check "taken back, source: the same tip is not offered again within a day" test "$(frag_offers)" = false
  src_commit; later 3600; age_hourly 62; tick
  check "taken back, source: a new tip is (the near miss)" test "$(frag_offers)" = true
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
