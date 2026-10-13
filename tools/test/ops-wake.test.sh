#!/usr/bin/env bash
# Tests for scripts/lib/ops-wake.sh: the helper's wait for a press, inside the lock, to second 45 of its tick. The world (clone,
# ticks, stub docker) is tools/test/ops-world.sh; its docker answers the wait from the files wake, wake-keep, wake-hang and
# poll-after-wake there, and waits OPS_T_WAKE seconds for the wake (none unless a test sets them).
#
#   tools/test/ops-wake.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by ops-world.sh (unprivileged)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged ops-wake.test.sh "$@"

# OPS_T_WAKE is how many seconds the stub waits for the wake, and the helper's second 45; OPS_T_WAKEEND is its second 58.
polls() { n_calls 'ops poll'; }
waits() { n_calls 'sh -c i=0;'; }
queue_after_wake() { poll "$@"; mv "$S/poll" "$S/poll-after-wake"; } # queue_after_wake ACTION [ID]: the request the app queues while the helper waits
lock_free() { (exec 7>>"$CL/ops/.lock"; flock -n 7); }
t_wake_none() {
  new_world; tick; : >"$S/calls.log"
  local t0=$SECONDS
  tick OPS_T_WAKE=3
  check "wake: none came, so one poll, one wait, and the tick ends at once after it" test "$(polls)" = 1 -a "$(waits)" = 1 -a "$TICK_RC" = 0 -a "$((SECONDS - t0))" -ge 2
  check "wake: the lock is free when the tick has ended, and the wait never held its descriptor" test "$(n_calls LOCK-FD-LEAKED)" = 0 && lock_free
  : >"$S/calls.log"; tick
  check "wake: an older app, where the wait ends non-zero at once: one poll, no more" test "$(polls)" = 1 -a "$(waits)" = 1 -a "$TICK_RC" = 0
  check "wake: nothing from the container reaches the host log" bash -c "! grep -q 'data/ops/wake' '$W/tick.out'"
}
t_wake_zero_is_no_wait() {
  new_world; tick; touch "$S/wake"; : >"$S/calls.log"
  tick OPS_T_WAKE=0
  check "wake: OPS_T_WAKE=0 makes no wait call at all and polls once, as before the wake" test "$(polls)" = 1 -a "$(waits)" = 0 -a "$TICK_RC" = 0
}
t_wake_hung_client() {
  new_world; tick; : >"$S/calls.log"; touch "$S/wake-hang"
  local t0=$SECONDS
  tick OPS_T_WAKE=3
  check "wake: a client that never answers is killed at the bound, and the lock is free" test "$(polls)" = 1 -a "$(waits)" = 1 -a "$TICK_RC" = 0 -a "$((SECONDS - t0))" -lt 20
  check "wake: the lock is free after it" lock_free
}
t_wake_request() {
  new_world; tick; queue_after_wake backup; touch "$S/wake"; : >"$S/calls.log"
  tick OPS_T_WAKE=6
  check "wake: a wake with a request: two polls, the request runs once and is reported" test "$(polls)" = 2 -a "$(waits)" = 1 -a "$(n_calls 'backup.sh ran')" = 1
  check "wake: and reported ok" reported ok
  check "wake: the journal holds it as reported" grep -q '"reported":true' "$CL/ops/journal/$ID.json"
  check "wake: the wake is used up" test ! -e "$S/wake"
  queue_after_wake backup; touch "$S/wake"; : >"$S/calls.log"
  tick OPS_T_WAKE=6
  check "wake: the same id again is not run a second time, wake or no" test "$(polls)" = 2 -a "$(n_calls 'backup.sh ran')" = 0
}
t_wake_five_empty() {
  new_world; tick; touch "$S/wake" "$S/wake-keep"; : >"$S/calls.log"
  tick OPS_T_WAKE=6
  check "wake: five wakes that find nothing: six polls, then the tick ends" test "$(polls)" = 6 -a "$(waits)" = 5 -a "$TICK_RC" = 0
  check "wake: and the lock is free" lock_free
}
t_wake_last_second() {
  new_world; tick; queue_after_wake backup; touch "$S/wake"; : >"$S/calls.log"
  tick OPS_T_WAKE=6 OPS_T_WAKEEND=4
  check "wake: with under 5 s left to the end of the tick the woken poll is not started" test "$(polls)" = 1 -a "$(waits)" = 1 -a "$(n_calls 'backup.sh ran')" = 0 -a -f "$S/poll"
  rm -f "$S/poll" "$S/poll-after-wake"; queue_after_wake backup "$ID2"; touch "$S/wake"; : >"$S/calls.log"
  tick OPS_T_WAKE=6 OPS_T_WAKEEND=30
  check "wake: with time left it is started (the near miss)" test "$(polls)" = 2 -a "$(n_calls 'backup.sh ran')" = 1
}
t_wake_check_then_update() {
  new_world; release 0.2.0; tick; queue_after_wake update "$ID2"; poll check-update; touch "$S/wake"; : >"$S/calls.log"
  tick OPS_T_WAKE=6
  check "wake: a version check and then the update run in one tick: two polls, both reported" test "$(polls)" = 2 -a "$(nreports)" = 2 -a "$(cver)" = 0.2.0 -a "$(n_calls '^docker pull ')" = 1
  check "wake: both are in the journal" test -f "$CL/ops/journal/$ID.json" -a -f "$CL/ops/journal/$ID2.json"
}
t_wake_one_more_only() {
  new_world; release 0.2.0; tick; queue_after_wake check-update "$ID2"; poll check-update; touch "$S/wake" "$S/wake-keep"; : >"$S/calls.log"
  tick OPS_T_WAKE=6
  check "wake: after a version check at most ONE more request: two polls, and the wake is left unused" test "$(polls)" = 2 -a "$(waits)" = 1 -a "$(nreports)" = 2
  rm -rf "$S/reports"/* "$CL/ops/journal"/*; rm -f "$S/wake" "$S/wake-keep"
  queue_after_wake backup "$ID2"; poll check-update; touch "$S/wake" "$S/wake-keep"; : >"$S/calls.log"
  tick OPS_T_WAKE=6
  check "wake: the one more request after a version check may be of any kind" test "$(polls)" = 2 -a "$(waits)" = 1 -a "$(n_calls 'backup.sh ran')" = 1
}
t_wake_not_after_update() {
  new_world; release 0.2.0; tick; queue_after_wake backup "$ID2"; poll update; touch "$S/wake" "$S/wake-keep"; : >"$S/calls.log"
  tick OPS_T_WAKE=6
  check "wake: after an update the tick ends: one poll, no wait, the next request waits for the next tick" test "$(polls)" = 1 -a "$(waits)" = 0 -a "$(cver)" = 0.2.0 -a "$(n_calls 'backup.sh ran')" = 0 -a -f "$S/poll-after-wake"
}
t_wake_not_after_other_in_loop() {
  new_world; tick; queue_after_wake backup; touch "$S/wake" "$S/wake-keep"; : >"$S/calls.log"
  tick OPS_T_WAKE=6
  check "wake: a request other than a version check, found by a wake, ends the tick: two polls, one wait" test "$(polls)" = 2 -a "$(waits)" = 1 -a "$(n_calls 'backup.sh ran')" = 1
}
for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
