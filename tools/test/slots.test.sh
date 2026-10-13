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
has_text() { [[ $1 == *"$2"* ]]; }

TMP=$(mktemp -d)
# A holder's command notes its own pid in a file of this run, and the suite ends it by that pid and never by a pattern
# in the process list, which would also reach a holder of another run of this suite on the same machine. The duration
# is made for the run as well, so a stray holder can be told from the others.
HOLD=30.$$
stop() { local p; [[ -s $1 ]] || return 0; p=$(<"$1"); kill "$p" 2>/dev/null; rm -f "$1"; }
cleanup() { local f; for f in "$TMP"/*.pid; do stop "$f"; done; rm -rf "$TMP"; }
trap cleanup EXIT
export CHECK_SLOT_POLL=0.1
# a wait is logged: the suite's waits go to a file of its own, not to the lead-logs of the repository it runs in
export SLOTS_LOG=$TMP/slots.log
D=$TMP/slots

# wait_for FILE: until the file has something in it (up to 30 s), in place of a sleep that hopes it is there
wait_for() { local i; for ((i = 0; i < 300; i++)); do [[ -s $1 ]] && return 0; sleep 0.1; done; return 1; }
# gone PID: no such process any more, or only a zombie that nobody has waited for yet
gone() { local s; s=$(ps -o stat= -p "$1" 2>/dev/null); [[ -z $s || $s == Z* ]]; }
wait_gone() { local i; for ((i = 0; i < 50; i++)); do gone "$1" && return 0; sleep 0.1; done; return 1; }

# a command that notes its pid in the file $1, then sleeps for $2 seconds as the same process
cat >"$TMP/hold.sh" <<'EOF'
#!/usr/bin/env bash
echo $$ >"$1"
exec sleep "$2"
EOF

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
bash "$SLOTS_SH" --dir "$D" --slots 1 -- bash "$TMP/hold.sh" "$TMP/h1.pid" "$HOLD" & holder=$!
wait_for "$TMP/h1.pid" && wait_for "$D/slot-0/owner"
kill -9 "$holder"; wait "$holder" 2>/dev/null
stop "$TMP/h1.pid" # the command outlives its killed script
SECONDS=0
out=$(run 1 --wait 20 -- echo ran 2>&1); rc=$?
check "a slot of a dead owner is taken over" test $rc -eq 0 -a "${out##*$'\n'}" = ran
check "and quickly" test $SECONDS -lt 5

# an owner that has ended but nobody has waited for yet (a zombie) is gone as well: here its parent is a sleep, which
# never waits for its children
rm -rf "$D/slot-0"; mkdir -p "$D/slot-0"
(bash -c 'echo $$ >"$1"' _ "$TMP/z.pid" & exec sleep "$HOLD") & zparent=$!
wait_for "$TMP/z.pid"
for ((i = 0; i < 50; i++)); do [[ $(ps -o stat= -p "$(<"$TMP/z.pid")" 2>/dev/null) == Z* ]] && break; sleep 0.1; done
cp "$TMP/z.pid" "$D/slot-0/owner"
SECONDS=0
out=$(run 1 --wait 20 -- echo ran 2>&1); rc=$?
check "a slot whose owner is a zombie is taken over" test $rc -eq 0 -a "$out" = ran -a $SECONDS -lt 5
kill "$zparent" 2>/dev/null; wait "$zparent" 2>/dev/null; rm -f "$TMP/z.pid"

# a holder that stays alive blocks until --wait is over, then the command runs without a slot
bash "$SLOTS_SH" --dir "$D" --slots 1 -- bash "$TMP/hold.sh" "$TMP/h2.pid" "$HOLD" & holder=$!
wait_for "$TMP/h2.pid"
out=$(SLOTS_LOG=$TMP/lead-logs/w.log run 1 --wait 1 --label held -- echo ran 2>&1); rc=$?
check "waiting is bounded by --wait" test $rc -eq 0
[[ $out == *"running without one"* && $out == *ran ]] && pass "says it ran without a slot" || fail "says it ran without a slot" "$out"
# the wait left a line: label, seconds waited, date. A slot taken at once leaves none. The folder is made.
logged=$(cat "$TMP/lead-logs/w.log" 2>/dev/null)
[[ $(wc -l <<<"$logged") -eq 1 && $logged =~ ^held\ [1-9][0-9]*\ [0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}$ ]] && pass "a wait appends one line: label, seconds waited, date" || fail "a wait appends one line: label, seconds waited, date" "$logged"
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null; rm -f "$TMP/h2.pid"
rm -rf "$D"
SLOTS_LOG=$TMP/free.log run 1 -- echo ran >/dev/null 2>&1
check "a slot that was free leaves no line" test ! -e "$TMP/free.log"

# the two waiters of one stale slot do not both get it
mkdir -p "$D/slot-0"; echo "999999 1" >"$D/slot-0/owner"
for i in 1 2; do run 1 -- bash "$TMP/job.sh" "$TMP/c2" 0.5 >/dev/null 2>&1 & done
wait
check "two waiters on a stale slot run one after the other" test "$(ls "$TMP/c2/peak" | sort -n | tail -n 1)" = 1

check "no slots (0) runs the command at once" test "$(bash "$SLOTS_SH" --dir "$D" --slots 0 -- echo hi)" = hi

# SIGTERM to the script reaches the command, and the slot is given back
bash "$SLOTS_SH" --dir "$D" --slots 1 -- bash -c 'sleep "$2" & echo $! >"$1"; wait' _ "$TMP/h3.pid" "$HOLD" & holder=$!
wait_for "$TMP/h3.pid"
kill -TERM "$holder"
SECONDS=0
wait "$holder"; rc=$?
check "SIGTERM ends the script with the command's status" test $rc -eq 143
check "and quickly" test $SECONDS -lt 5
check "the command is gone, with what it started" wait_gone "$(<"$TMP/h3.pid")"; rm -f "$TMP/h3.pid"
check "the slot is free" test "$(left)" = 0

# --pool NAME: slots of another folder in the git common dir, free while every slot of the default pool is held
git init -q "$TMP/gr"
(cd "$TMP/gr" && exec bash "$SLOTS_SH" --slots 1 -- bash "$TMP/hold.sh" "$TMP/h4.pid" "$HOLD") & holder=$!
wait_for "$TMP/h4.pid"
SECONDS=0
out=$(cd "$TMP/gr" && bash "$SLOTS_SH" --pool lead --slots 1 --wait 20 -- echo ran 2>&1); rc=$?
check "a pool of its own has a free slot while the default pool is held" test $rc -eq 0 -a "$out" = ran -a $SECONDS -lt 5
check "its slots are a folder of their own next to the default one" test -d "$TMP/gr/.git/lead-slots" -a -d "$TMP/gr/.git/check-slots"
out=$(cd "$TMP/gr" && env -u SLOTS_LOG bash "$SLOTS_SH" --slots 1 --wait 1 --label gate -- echo ran 2>&1)
check "and the default pool was held all the time" has_text "$out" "running without one"
check "the wait is logged in lead-logs of the git common dir by default" grep -qE '^gate [1-9][0-9]* [0-9]{4}-' "$TMP/gr/.git/lead-logs/slots.log"
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null; rm -f "$TMP/h4.pid"
out=$(cd "$TMP/gr" && bash "$SLOTS_SH" --pool "Bad Name" -- echo ran 2>&1); rc=$?
check "a pool name that is not a short lower-case word is refused" test $rc -eq 2

echo "$PASS passed, $FAILED failed"
((FAILED == 0))
