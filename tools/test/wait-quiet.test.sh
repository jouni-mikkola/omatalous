#!/usr/bin/env bash
# Tests for tools/wait-quiet.sh: busy and quiet by running programs and by load, the exits 0 and 3, --file and --pid, and
# the processes that must not count (the caller's own worktree, a run that is itself waiting). The "heavy" programs are
# scripts of this run's own folder, found by a pattern of its own, so real tests on the machine change no result.
#
#   tools/test/wait-quiet.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WQ=$HERE/../wait-quiet.sh
FILTER=${1:-}
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n" "$(tail -n 4 "$TMP/out" 2>/dev/null | tr '\n' '|')"; fi; }
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

TMP=$(mktemp -d)
# a process is ended by the pid it noted, never by a pattern in the process list
cleanup() { local f p; for f in "$TMP"/*.pid; do [[ -s $f ]] && { p=$(<"$f"); kill "$p" 2>/dev/null; }; done; rm -rf "$TMP"; }
trap cleanup EXIT
# the programs that count as heavy are the ones that run a script from this folder
export WAIT_QUIET_PATTERN="$TMP/heavy-"
export WAIT_QUIET_POLL=0.2 WAIT_QUIET_CPUS=4
export WAIT_QUIET_LOADAVG_FILE=$TMP/loadavg
echo "0.50 0.50 0.50 1/100 1" >"$TMP/loadavg"
mkdir -p "$TMP/other" "$TMP/me/sub"
cd "$TMP/me" || exit 1

wait_for() { local i; for ((i = 0; i < 100; i++)); do [[ -s $1 ]] && return 0; sleep 0.1; done; return 1; }
gone() { local s; s=$(ps -o stat= -p "$1" 2>/dev/null); [[ -z $s || $s == Z* ]]; }

# heavy NAME DIR: a program that runs a script of the pattern's folder with DIR as its directory, its pid in NAME.pid
heavy() {
  cat >"$TMP/heavy-$1.sh" <<'EOF'
#!/usr/bin/env bash
echo $$ >"$1"
sleep 60 & s=$!
trap 'kill $s; exit 0' TERM
wait $s
EOF
  (cd "$2" && bash "$TMP/heavy-$1.sh" "$TMP/$1.pid" </dev/null >/dev/null 2>&1 &)
  wait_for "$TMP/$1.pid"
}
stop() { local p; p=$(<"$TMP/$1.pid"); kill "$p" 2>/dev/null; rm -f "$TMP/$1.pid"; }
run() { bash "$WQ" "$@" >"$TMP/out" 2>&1; echo $? >"$TMP/rc"; }
rc_is() { [[ $(<"$TMP/rc") == "$1" ]]; }
out_has() { [[ $(<"$TMP/out") == *"$1"* ]]; }

t_quiet_machine_returns_0_at_once() {
  run --max 5
  rc_is 0 && [[ ! -s $TMP/out ]]
}
t_heavy_process_of_another_worktree_is_busy() {
  heavy a "$TMP/other" || return 1
  run --max 1
  local ok=1
  rc_is 3 && out_has "busy: " && out_has "$TMP/other" || ok=0
  stop a
  ((ok))
}
t_process_of_the_own_worktree_does_not_count() {
  heavy b "$TMP/me/sub" || return 1
  run --max 1
  local ok=1
  rc_is 0 || ok=0
  stop b
  ((ok))
}
t_busy_then_quiet_returns_0_and_says_how_long() {
  heavy c "$TMP/other" || return 1
  (sleep 1; stop c) &
  run --max 20
  wait
  rc_is 0 && out_has "quiet after "
}
t_load_at_twice_the_cpus_is_busy_below_it_is_quiet() {
  echo "8.00 1 1 1/1 1" >"$TMP/loadavg"
  run --max 1
  local ok=1
  rc_is 3 && out_has "load 8.00" || ok=0
  echo "7.99 1 1 1/1 1" >"$TMP/loadavg"
  run --max 1
  rc_is 0 || ok=0
  echo "0.50 0.50 0.50 1/100 1" >"$TMP/loadavg"
  ((ok))
}
t_file_ends_the_wait() {
  heavy d "$TMP/other" || return 1
  (sleep 1; : >"$TMP/flag") &
  run --max 20 --file "$TMP/flag"
  wait
  local ok=1
  rc_is 0 && out_has "done: $TMP/flag exists" || ok=0
  stop d
  ((ok))
}
t_pid_ending_ends_the_wait() {
  heavy e "$TMP/other" || return 1
  sleep 60 &
  local p=$!
  (sleep 1; kill "$p") &
  run --max 20 --pid "$p"
  wait
  local ok=1
  rc_is 0 && out_has "done: pid $p has ended" || ok=0
  stop e
  ((ok))
}
t_a_pid_that_still_runs_does_not_end_the_wait() {
  heavy f "$TMP/other" || return 1
  sleep 30 &
  local p=$!
  run --max 1 --pid "$p"
  local ok=1
  rc_is 3 || ok=0
  kill "$p" 2>/dev/null
  stop f
  ((ok))
}
t_a_run_that_is_itself_waiting_does_not_count() {
  # the parent of a waiting wait-quiet is what a check queued behind another looks like: it matches the pattern and must be skipped
  cat >"$TMP/heavy-g.sh" <<EOF
#!/usr/bin/env bash
echo \$\$ >"$TMP/g.pid"
bash "$WQ" --max 20 --file "$TMP/flag-g"
EOF
  (cd "$TMP/other" && bash "$TMP/heavy-g.sh" </dev/null >/dev/null 2>&1 &)
  wait_for "$TMP/g.pid" || return 1
  sleep 0.5
  run --max 2
  local ok=1
  rc_is 0 || ok=0
  : >"$TMP/flag-g"
  ((ok))
}
t_max_above_280_is_cut_to_280() {
  run --max 9999
  rc_is 0 && out_has "using 280"
}
t_max_0_looks_once() {
  heavy h "$TMP/other" || return 1
  local t=$SECONDS ok=1
  run --max 0
  rc_is 3 && ((SECONDS - t < 3)) || ok=0
  stop h
  ((ok))
}
t_bad_arguments_exit_2() {
  run --max soon
  rc_is 2 || return 1
  run --pid x
  rc_is 2 || return 1
  run --file a --pid 1
  rc_is 2 || return 1
  run --nope
  rc_is 2
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  check "${t#t_}" "$t"
done
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
