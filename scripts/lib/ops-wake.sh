# shellcheck shell=bash
# The helper's wait for a press, for scripts/ops-helper.sh. The helper's load_libs sources this file after check_permissions
# has passed on scripts/lib; it defines functions and nothing else.
#
#   wake_loop RUNS   main calls it last in a tick that holds the lock, RUNS being the number of requests the tick ran (0 or 1).
#
# The app touches /data/ops/wake after it has queued a request, and `ops poll` removes it. So a tick that found nothing waits in
# the container for that file, to second 45 of the tick, and polls again when it comes: a request starts within seconds of the
# press, not at the next minute. Each such poll is the helper's own poll_once, with the same answer shape and the same journal.
#
# Bounds: at most five wakes that find nothing; no poll that starts with under 5 s left to second 58 (and a poll is cut at the
# seconds left, 30 at most); a tick runs at most two requests, the second only after check-update, which is read-only on the host
# and has its time cap. Nothing from the container is read but the exit status of the wait. $SECONDS is bash's own: 0 when the
# helper starts, as the helper starts itself again with a clean environment before anything else.

# The wait, run by sh in the app's container. The bound of 50 is the wait of a client that was killed: the `sh` there may
# outlive the `timeout` that ends the client.
readonly WAKE_WAIT='i=0; while [ "$i" -lt 50 ] && [ ! -e /data/ops/wake ]; do sleep 1; i=$((i+1)); done; [ -e /data/ops/wake ]'
wake_wait() { # 0 only when the container says the file is there. Its output is dropped; so is the lock's descriptor (8)
  local left=$((WAKE_UNTIL - SECONDS))
  ((left >= 1 && left <= WAKE_UNTIL)) || return 1
  timeout -k 5 "$left" docker compose exec -T banking sh -c "$WAKE_WAIT" </dev/null >/dev/null 2>&1 8>&-
}
wake_loop() {
  local runs=$1 empty=0 left
  WAKE_UNTIL=$(t_for 45 WAKE); WAKE_END=$(t_for 58 WAKEEND) # a test may shorten them (OPS_T_WAKE, OPS_T_WAKEEND)
  # a version check does not end the tick: the update the owner presses next is the one more request it may run
  ((runs == 0)) || [[ $LAST_RAN == check-update ]] || return 0
  while ((runs < 2 && empty < 5)) && wake_wait; do
    left=$((WAKE_END - SECONDS))
    ((left >= 5)) || return 0
    ((left <= 30)) || left=30
    if poll_once "$left"; then
      runs=$((runs + 1))
      [[ $LAST_RAN == check-update ]] || return 0
    else
      empty=$((empty + 1))
    fi
  done
  return 0
}
