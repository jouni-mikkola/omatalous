# shellcheck shell=bash
# The steps of a request, for scripts/ops-helper.sh. The helper's load_libs sources this file after check_permissions has
# passed on scripts/lib; it defines functions and nothing else.
#
#   step_say "N/M text"   the one way an action says a step: the log's `STEP: N/M text` line, exactly as before (an older app's
#                         parser reads it), then `STEP-AT: N/M SECONDS` on the next line (the seconds since run_request began),
#                         then the app is told, so the page shows the step while the action runs.
#
# Telling is `ops progress` in the app's container: one call in the foreground, with a time limit (OPS_T_PROGRESS, 10 s; a test
# may shorten it, and 0 means no call, as the drills set it), the lock's descriptor (8) closed for the child and its output
# dropped. It is made only while the app's container is up, never for the step of a one-step action, and not again in a request
# after the first call that failed or timed out (an older app answers its usage line and exit 1). A call that fails never
# fails the action. What goes in it is the helper's own fixed words and the id this tick polled: nothing read from the container.
# STEP_T0 and STEP_ID are set by run_request (STEP_ID is "" outside a request).
STEP_T0=0; STEP_OFF=0; STEP_ID=""
step_say() { # step_say "N/M text"
  local nm=${1%% *}
  printf 'STEP: %s\n' "$1" >>"$LOGF"
  printf 'STEP-AT: %s %s\n' "$nm" "$((SECONDS - STEP_T0))" >>"$LOGF"
  step_tell "$nm" "${1#* }"
}
step_tell() { # step_tell N/M TEXT: always returns 0
  local n=${1%/*} m=${1#*/} secs
  [[ $STEP_OFF == 0 && $STEP_ID =~ ^op_[0-9a-f]{16}$ && $n =~ ^[0-9]{1,2}$ && $m =~ ^[0-9]{1,2}$ ]] || return 0
  ((10#$m > 1)) || return 0
  secs=$(t_for 10 PROGRESS); [[ $secs =~ ^[0-9]{1,2}$ ]] && ((10#$secs > 0)) || return 0
  app_running || return 0
  printf '{"id":"%s","step":{"n":%s,"m":%s,"text":%s}}\n' "$STEP_ID" "$((10#$n))" "$((10#$m))" "$(json_str "$2")" |
    timeout -k 5 "$((10#$secs))" docker compose exec -T banking "${NODE[@]}" dist/node.js ops progress --helper "$OPS_HELPER_VERSION" >/dev/null 2>&1 8>&- || STEP_OFF=1
  return 0
}
