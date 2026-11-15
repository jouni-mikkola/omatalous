#!/usr/bin/env bash
# Tests for the part of tools/ci/drills-lib.sh that needs no Docker: the helper's look at an app that SIGSTOP has stopped
# (timeout_shim), and the signal to the container of the install the drills stand on (stop_app, by NAME).
#
#   tools/test/drills-lib.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
has() { if [[ $2 == *"$3"* ]]; then pass "$1"; else fail "$1" "$2"; fi; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
BIN=$TMP/bin
PLAY=$TMP/play
CALLS=$TMP/calls
mkdir -p "$BIN" "$PLAY"
: >"$CALLS"
stub() { cat >"$1"; chmod +x "$1"; }
called() { grep -c -- "$1" "$CALLS"; }
# a docker that says what it was asked; with the file fail-kill in the play folder, `kill` fails
stub "$BIN/docker" <<STUB
#!/usr/bin/env bash
echo "docker \$*" >>"$CALLS"
[[ \${1:-} != kill || ! -e "$PLAY/fail-kill" ]] || exit 1
STUB

# ── the helper's look at an app that is stopped (tools/ci/drills-lib.sh) ──
# timeout_shim writes the `timeout` that goes first in the helper's PATH. The real one is a stand-in that says what it got.
T=$TMP/look
mkdir -p "$T"
stub "$T/real-timeout" <<'STUB'
#!/usr/bin/env bash
echo "real $*"
STUB
(. "$REPO/tools/ci/drills-lib.sh" && timeout_shim "$T" "$T/real-timeout")
look() { "$T/timeout" "$@"; }
probe=(20 docker compose exec -T banking wget -qO- http://127.0.0.1:8080/api/health)
check "the shim is there and can run" test -x "$T/timeout"
has "no mark: the helper's look keeps its 20 s" "$(look "${probe[@]}")" "real 20 docker compose exec -T banking wget -qO- http://127.0.0.1:8080/api/health"
(CLOCK=$T; NAME=banking-app; PATH=$BIN:$PATH; . "$REPO/tools/ci/drills-lib.sh"; stop_app)
check "stop_app stops the app and makes the mark" test -e "$T/stopped" -a "$(called '^docker kill -s STOP banking-app')" -eq 1
has "marked: the same look waits 5 s" "$(look "${probe[@]}")" "real 5 docker compose exec -T banking wget -qO- http://127.0.0.1:8080/api/health"
has "a longer wait of the same call is the helper's own" "$(look 30 docker compose exec -T banking wget -qO- x)" "real 30 docker compose exec -T banking wget"
has "another command of 20 s keeps it" "$(look 20 docker compose ps -a -q banking)" "real 20 docker compose ps -a -q banking"
has "another exec of 20 s keeps it" "$(look 20 docker compose exec -T banking node -e x)" "real 20 docker compose exec -T banking node -e x"
has "another service keeps it" "$(look 20 docker compose exec -T caddy wget -qO- x)" "real 20 docker compose exec -T caddy"
has "the options of timeout reach the real one as they came" "$(look -k 10 600 ./scripts/update.sh --rollback --yes)" "real -k 10 600 ./scripts/update.sh --rollback --yes"
rm "$T/stopped"
: >"$CALLS"
(CLOCK=$T; NAME=drill-2; PATH=$BIN:$PATH; . "$REPO/tools/ci/drills-lib.sh"; stop_app)
check "on an install with a name of its own the signal goes to that container, and no other" test "$(called '^docker kill -s STOP drill-2$')" -eq 1 -a "$(called 'banking-app')" -eq 0
rm "$T/stopped"
has "no mark again: 20 s again" "$(look "${probe[@]}")" "real 20 docker compose exec"
touch "$PLAY/fail-kill"
(CLOCK=$T; NAME=banking-app; PATH=$BIN:$PATH; . "$REPO/tools/ci/drills-lib.sh"; stop_app)
check "a kill that fails leaves no mark" test ! -e "$T/stopped"

echo

# ── tick passes OPS_T_WAKE=0, so an idle drill tick does not wait for a press ──
mkdir -p "$TMP/clone/scripts" "$TMP/clock"
stub "$TMP/clone/scripts/ops-helper.sh" <<'STUB'
#!/usr/bin/env bash
echo "test=$OPS_TEST wake=${OPS_T_WAKE-unset}"
STUB
tick_out=$( (. "$REPO/tools/ci/drills-lib.sh"; DIR=$TMP/clone CLOCK=$TMP/clock LOGS=$TMP; DEADLINE=$((SECONDS + 100)); tick 0; cat "$TMP/tick.out") )
has "tick runs the helper with OPS_T_WAKE=0 (and OPS_TEST=1)" "$tick_out" "test=1 wake=0"

echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
