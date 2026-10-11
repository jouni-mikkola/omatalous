#!/usr/bin/env bash
# Tests for tools/slots.sh: at most N commands run at once, a slot is given back after a failure or a kill, and a
# stuck holder cannot block for ever. Slots live in a throwaway directory, so the real checks are not affected.
#
#   tools/test/slots.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SLOTS_SH=$HERE/../slots.sh
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; pkill -f "sleep 30.123" 2>/dev/null; pkill -f "sleep 40.321" 2>/dev/null' EXIT
export CHECK_SLOT_POLL=0.1
D=$TMP/slots

# a job that notes how many jobs run at the same time
cat >"$TMP/job.sh" <<'EOF'
#!/usr/bin/env bash
mkdir -p "$1/running" "$1/peak"
touch "$1/running/$$" "$1/ran.$$"
n=$(ls "$1/running" | wc -l)
touch "$1/peak/$n"
sleep "${2:-0.6}"
rm -f "$1/running/$$"
EOF

run() { bash "$SLOTS_SH" --dir "$D" --slots "$@"; }
left() { local n=0 f; for f in "$D"/slot-*; do [[ -e $f ]] && n=$((n + 1)); done; echo "$n"; }

# three callers, two slots: all three finish and never more than two run together
for i in 1 2 3; do run 2 -- bash "$TMP/job.sh" "$TMP/c1" >"$TMP/o$i" 2>&1 & done
wait
check "three callers with two slots: the third waits" test "$(ls "$TMP/c1/peak" | sort -n | tail -n 1)" = 2
check "all three ran" test "$(ls "$TMP"/c1/ran.* | wc -l)" = 3
check "the slots are free afterwards" test "$(left)" = 0

# the exit code of the command is the exit code of the caller, and the slot is given back
run 1 -- bash -c 'exit 7'; rc=$?
check "exit code is passed on" test $rc -eq 7
check "a failed command gives its slot back" test "$(left)" = 0

# a holder that is killed leaves its slot behind: the next caller takes it over
bash "$SLOTS_SH" --dir "$D" --slots 1 -- sleep 30.123 & holder=$!
sleep 0.5
kill -9 "$holder"; wait "$holder" 2>/dev/null
SECONDS=0
out=$(run 1 --wait 20 -- echo ran 2>&1); rc=$?
check "a slot of a dead owner is taken over" test $rc -eq 0 -a "${out##*$'\n'}" = ran
check "and quickly" test $SECONDS -lt 5
pkill -f "sleep 30.123" 2>/dev/null

# a holder that stays alive blocks until --wait is over, then the command runs without a slot
bash "$SLOTS_SH" --dir "$D" --slots 1 -- sleep 3.17 & holder=$!
sleep 0.5
out=$(run 1 --wait 1 -- echo ran 2>&1); rc=$?
check "waiting is bounded by --wait" test $rc -eq 0
[[ $out == *"running without one"* && $out == *ran ]] && pass "says it ran without a slot" || fail "says it ran without a slot" "$out"
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null

# the two waiters of one stale slot do not both get it
mkdir -p "$D/slot-0"; echo "999999 1" >"$D/slot-0/owner"
for i in 1 2; do run 1 -- bash "$TMP/job.sh" "$TMP/c2" 0.5 >/dev/null 2>&1 & done
wait
check "two waiters on a stale slot run one after the other" test "$(ls "$TMP/c2/peak" | sort -n | tail -n 1)" = 1

check "no slots (0) runs the command at once" test "$(bash "$SLOTS_SH" --dir "$D" --slots 0 -- echo hi)" = hi

# SIGTERM to the script reaches the command, and the slot is given back
bash "$SLOTS_SH" --dir "$D" --slots 1 -- bash -c 'sleep 40.321 & wait' & holder=$!
sleep 0.5
kill -TERM "$holder"
SECONDS=0
wait "$holder"; rc=$?
check "SIGTERM ends the script with the command's status" test $rc -eq 143
check "and quickly" test $SECONDS -lt 5
check "the command is gone, with what it started" test -z "$(pgrep -f 'sleep 40.321')"
check "the slot is free" test "$(left)" = 0

echo "$PASS passed, $FAILED failed"
((FAILED == 0))
