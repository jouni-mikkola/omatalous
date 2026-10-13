#!/usr/bin/env bash
# Tests for the shell step of tools/check.sh: which suites it runs, and how a suite of `t_` scenarios is split into one
# job per scenario. A world is a folder with a copy of check.sh and fake suites that log every scenario they run to
# $RUNLOG. The --changed cases also copy tools/check/scope.mjs and make a git history.
#
#   tools/test/check.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
# A check inside a release cut runs this suite with the cut's shares of the cores: none reaches a scenario that does not set it.
# shellcheck source=cut-env.sh
. "$HERE/cut-env.sh"
FILTER=${1:-}
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n" "$(tail -n 6 "$W/out" 2>/dev/null | tr '\n' '|')"; fi; }
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
export RUNLOG

world() { # world: an empty folder in W with check.sh, and the log of the scenarios that ran
  W=$(mktemp -d "$ROOT/w.XXXXXX")
  mkdir -p "$W/tools/test" "$W/tools/check" "$W/scripts" "$W/bin"
  cp "$SRC/tools/check.sh" "$W/tools/"
  # what the run leaves behind is no change to the scope
  printf '%s\n' out rc runlog bin/ >"$W/.gitignore"
  RUNLOG=$W/runlog; : >"$RUNLOG"
}

# The header of a fake suite: the filter, the counters and a scenario that logs itself.
suite_head() { # suite_head FILE
  cat >"$1" <<'EOS'
#!/usr/bin/env bash
FILTER=${1:-}
PASS=0; FAILED=0
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
scenario() { echo "${0##*/} $1" >>"$RUNLOG"; echo "ok   $1"; PASS=$((PASS + 1)); }
EOS
}
suite_tail() { printf '%s\n' 'echo "$PASS passed, $FAILED failed"' '((FAILED == 0))' >>"$1"; }

# alpha: the scenarios are found with declare -F, and t_one is inside the name t_one_more. t_two fails when FAIL_TWO is set.
fake_alpha() {
  local f=$W/tools/test/alpha.test.sh
  suite_head "$f"
  sed 's/^@//' >>"$f" <<'EOS'
@t_one() { scenario t_one; }
@t_one_more() { scenario t_one_more; }
@t_two() { if [[ -n ${FAIL_TWO:-} ]]; then echo "FAIL two: a check with no detail"; echo "FAIL two: the thing broke"; echo "       got 1 want 2"; FAILED=$((FAILED + 1)); else scenario t_two; fi; }
for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  "$t"
done
EOS
  suite_tail "$f"
}
# beta: backup's way, a list of names without the prefix and the call "t_$t"
fake_beta() {
  local f=$W/tools/test/beta.test.sh
  suite_head "$f"
  sed 's/^@//' >>"$f" <<'EOS'
@t_x() { scenario t_x; }
@t_y() { scenario t_y; }
for t in x y; do
  want "$t" && "t_$t"
done
EOS
  suite_tail "$f"
}
# plain: no scenarios, so it runs whole
fake_plain() {
  local f=$W/tools/test/plain.test.sh
  suite_head "$f"
  echo 'scenario plain' >>"$f"
  suite_tail "$f"
}

run_check() { # run_check ARGS...: check.sh in W with its own log folder and no slot to wait for
  (cd "$W" && env -u CHECK_LOG -u CHECK_JOBS CHECK_SLOT_HELD=1 PATH="$W/bin:$PATH" bash tools/check.sh "$@") >"$W/out" 2>&1
  echo $? >"$W/rc"
}
ran() { sort "$RUNLOG" | tr '\n' ','; }

t_scenarios_run_once() {
  world; fake_alpha; fake_beta; fake_plain
  run_check sh
  check "sh: all green" test "$(cat "$W/rc")" = 0
  check "sh: every scenario ran, and t_one_more only once although t_one's filter matches it" test "$(ran)" = "alpha.test.sh t_one,alpha.test.sh t_one_more,alpha.test.sh t_two,beta.test.sh t_x,beta.test.sh t_y,plain.test.sh plain,"
  check "sh: the summary counts one job per scenario and the suite run whole" grep -q 'sh ok (4 scenario jobs from 2 suites, 1 suites whole' "$W/out"
}

t_failing_scenario_is_named() {
  world; fake_alpha; fake_beta
  FAIL_TWO=1 run_check sh
  check "sh: exit 1" test "$(cat "$W/rc")" = 1
  check "sh: the summary names the suite and the scenario, then its failures, also one right after another" bash -c "grep -q 'sh FAILED (1 of' '$W/out' && grep -qx '  tools/test/alpha.test.sh t_two' '$W/out' && grep -q 'FAIL two: a check with no detail' '$W/out' && grep -q 'FAIL two: the thing broke' '$W/out' && grep -q 'got 1 want 2' '$W/out'"
  check "sh: the other scenarios still ran" test "$(ran)" = "alpha.test.sh t_one,alpha.test.sh t_one_more,beta.test.sh t_x,beta.test.sh t_y,"
}

t_filter_that_matches_nothing_fails() {
  world; fake_alpha
  local f=$W/tools/test/orphan.test.sh
  suite_head "$f"
  # t_never is never reached by the filter, as in a suite whose loop calls its scenarios by another name
  sed 's/^@//' >>"$f" <<'EOS'
@t_never() { scenario t_never; }
for t in other; do
  want "$t" && scenario "$t"
done
EOS
  suite_tail "$f"
  run_check sh
  check "sh: a job that ran no scenario fails" test "$(cat "$W/rc")" = 1
  check "sh: and says the filter matched nothing" grep -q 'filter t_never matched no scenario' "$W/out"
}

t_jobs_that_see_each_others_processes_run_again_alone() {
  world
  local f=$W/tools/test/watcher.test.sh ps=ps tok=$$-$RANDOM
  suite_head "$f"
  # t_a keeps a process with a token in its arguments until t_b has looked (it touches $RUNLOG.looked; t_a gives up
  # after 30 s). t_b waits for t_a to start, then looks for the token in the process table, as install.test.sh does:
  # next to t_a it fails, alone it passes. The token is made for this run, so another run of this suite on the same
  # machine is not seen. The words are put together here so that this suite does not hold them itself.
  {
    echo "# the scenarios look at the machine: $ps -eo args"
    echo 't_a() { touch "$RUNLOG.started"; bash -c "for i in \$(seq 300); do [[ -e \$RUNLOG.looked ]] && break; sleep 0.1; done" token-'"$tok"'; scenario t_a; }'
    echo 't_b() { local i seen=0; for i in $(seq 300); do [[ -e $RUNLOG.started ]] && break; sleep 0.1; done'
    echo '  '"$ps"' -eo args | grep "[t]oken-'"$tok"'" >/dev/null && seen=1; touch "$RUNLOG.looked"'
    echo '  if ((seen)); then echo "FAIL b: a token in the process list"; FAILED=$((FAILED + 1)); else scenario t_b; fi; }'
    echo 'for t in $(declare -F | awk "{print \$3}" | grep "^t_"); do want "$t" && "$t"; done'
  } >>"$f"
  suite_tail "$f"
  run_check sh
  check "sh: both ran and the run is green" bash -c "[[ \$(cat '$W/rc') = 0 ]] && [[ \$(sort '$RUNLOG' | tr '\n' ,) = 'watcher.test.sh t_a,watcher.test.sh t_b,' ]]"
  check "sh: the summary says one job passed when run again alone" grep -q '1 passed when run again alone' "$W/out"
}

t_jobs_follow_the_cpus() {
  world; fake_plain
  local n
  for n in "28 20" "24 16" "16 8" "13 5" "12 4" "8 4"; do
    set -- $n
    printf '%s
' '#!/bin/sh' "echo $1" >"$W/bin/nproc"; chmod +x "$W/bin/nproc"
    run_check sh
    check "jobs: $2 at a time on $1 CPUs" grep -q "[ ]$2 at a time" "$W/out"
  done
  printf '%s
' '#!/bin/sh' 'echo 64' >"$W/bin/nproc"
  (cd "$W" && env -u CHECK_LOG CHECK_JOBS=3 CHECK_SLOT_HELD=1 PATH="$W/bin:$PATH" bash tools/check.sh sh) >"$W/out" 2>&1
  check "jobs: CHECK_JOBS wins" grep -q '3 at a time' "$W/out"
}

# The cut lock: a world in a repository of its own, so that its lock file is W/.git/cut.lock. The suite blocks on a
# fifo while it runs, so the test reads the lock from inside a running check. Nothing waits on the clock.
lock_world() {
  world
  git -C "$W" init -q -b main
  mkfifo "$W/in" "$W/go" "$W/held" "$W/rel" "$W/first"
  suite_head "$W/tools/test/plain.test.sh"
  echo 'echo "held=${CUT_LOCK_HELD:-}" >"$IN"; read -r _ <"$GO"; scenario plain' >>"$W/tools/test/plain.test.sh"
  suite_tail "$W/tools/test/plain.test.sh"
  LOCK=$W/.git/cut.lock; export IN=$W/in GO=$W/go
}
# lock_run [VAR=value ...]: check.sh sh without the cut variables, its output into the fifo "first", its code into rc
lock_run() {
  (cd "$W" && env -u CHECK_LOG -u CHECK_JOBS -u CUT_LOCK_HELD -u CUT_LOCK_WAIT -u CI CHECK_SLOT_HELD=1 "$@" PATH="$W/bin:$PATH" bash tools/check.sh sh >"$W/first" 2>&1; echo $? >"$W/rc") &
  RUNPID=$!
}
# the cut: an exclusive holder that says so and lets go when told
lock_cut() {
  (flock -x "$LOCK" bash -c 'echo held >"$1"; read -r _ <"$2"' _ "$W/held" "$W/rel") &
  CUTPID=$!
  read -r _ <"$W/held"
}

t_check_holds_the_lock_shared() {
  lock_world; : >>"$LOCK"
  lock_run
  exec 4<"$W/first"
  read -r seen <"$W/in"
  check "lock: what the check starts sees CUT_LOCK_HELD" test "$seen" = "held=1"
  check "lock: a release cannot take the lock while a check runs" bash -c "! flock -x -n '$LOCK' true"
  check "lock: another check can" flock -s -n "$LOCK" true
  echo >"$W/go"; wait "$RUNPID"; cat <&4 >"$W/out"; exec 4<&-
  check "lock: the check ran green, without waiting" bash -c "[[ \$(cat '$W/rc') = 0 ]] && ! grep -q 'waiting for the cut' '$W/out' && grep -q 'sh ok' '$W/out'"
}

t_check_waits_for_the_cut() {
  lock_world
  lock_cut
  lock_run
  exec 4<"$W/first"
  read -r line <&4
  check "lock: the check says it waits for the cut" test "$line" = "check: waiting for the cut"
  check "lock: nothing ran while the cut held the lock" test -z "$(ran)"
  echo >"$W/rel"; wait "$CUTPID"
  read -r seen <"$W/in"
  echo >"$W/go"; wait "$RUNPID"; cat <&4 >"$W/out"; exec 4<&-
  check "lock: after the cut the check ran, green" bash -c "[[ \$(cat '$W/rc') = 0 ]] && grep -q 'sh ok' '$W/out'"
  check "lock: and ran the suite" test "$(ran)" = "plain.test.sh plain,"
}

t_check_ends_red_when_the_cut_does_not_end() {
  lock_world
  lock_cut
  lock_run CHECK_CUT_WAIT=0
  exec 4<"$W/first"
  cat <&4 >"$W/out"; wait "$RUNPID"; exec 4<&-
  echo >"$W/rel"; wait "$CUTPID"
  check "lock: red after the wait, naming the lock file" bash -c "[[ \$(cat '$W/rc') = 1 ]] && grep -q 'the cut still holds .*/.git/cut.lock' '$W/out'"
  check "lock: nothing ran" test -z "$(ran)"
}

# The queue: A (another check) holds cut.lock shared, and the cut waits for it holding cut.wait exclusive, as the release does.
# B, this check, arrives then and stands behind the cut: it says so, and it runs only after A has ended, the cut has had the
# lock and let it go. Everything is told by fifos, so nothing waits on the clock.
t_check_stands_behind_a_cut_that_waits() {
  lock_world; : >>"$LOCK"; : >>"$W/.git/cut.wait"
  mkfifo "$W/a_held" "$W/a_rel" "$W/cut_waiting" "$W/cut_got" "$W/cut_rel"
  cat >"$W/cut.sh" <<'EOF'
exec 8>"$1/cut.wait" 9>"$1/cut.lock"
flock -x 8; echo waiting >"$2"; flock -x 9; echo got >"$3"; read -r _ <"$4"
EOF
  (flock -s "$LOCK" bash -c 'echo held >"$1"; read -r _ <"$2"' _ "$W/a_held" "$W/a_rel") &
  APID=$!
  read -r _ <"$W/a_held"
  bash "$W/cut.sh" "$W/.git" "$W/cut_waiting" "$W/cut_got" "$W/cut_rel" &
  CPID=$!
  read -r _ <"$W/cut_waiting"
  lock_run
  exec 4<"$W/first"
  read -r line <&4
  check "queue: a check that arrives while the cut waits says it waits for the cut, although the lock is only held shared" test "$line" = "check: waiting for the cut"
  echo >"$W/a_rel"; wait "$APID"
  read -r _ <"$W/cut_got"
  check "queue: the cut got the lock when A ended, and the check did not run before it" test -z "$(ran)"
  echo >"$W/cut_rel"; wait "$CPID"
  read -r seen <"$W/in"
  echo >"$W/go"; wait "$RUNPID"; cat <&4 >"$W/out"; exec 4<&-
  check "queue: after the cut the check ran, green" bash -c "[[ \$(cat '$W/rc') = 0 ]] && grep -q 'sh ok' '$W/out'"
  check "queue: with the lock held, as before" test "$seen" = "held=1"
}

t_check_inside_the_cut_does_not_wait() {
  lock_world
  lock_cut
  (cd "$W" && env -u CHECK_LOG -u CHECK_JOBS -u CI CUT_LOCK_HELD=1 CHECK_SLOT_HELD=1 PATH="$W/bin:$PATH" bash tools/check.sh sh >"$W/out" 2>&1; echo $? >"$W/rc") &
  RUNPID=$!
  read -r seen <"$W/in"
  check "lock: the release's own check starts at once, with the variable as it was" test "$seen" = "held=1"
  echo >"$W/go"; wait "$RUNPID"
  echo >"$W/rel"; wait "$CUTPID"
  check "lock: it ran green and did not wait" bash -c "[[ \$(cat '$W/rc') = 0 ]] && ! grep -q 'waiting' '$W/out'"
}

# A history with two scripts, each named by a suite of its own, and one that no suite names.
scoped_world() {
  world
  cp "$SRC/tools/check/scope.mjs" "$W/tools/check/"
  local n
  for n in a b; do
    echo "echo $n" >"$W/scripts/$n.sh"
    suite_head "$W/tools/test/$n.test.sh"
    printf '%s\n' "bash scripts/$n.sh" "scenario $n" >>"$W/tools/test/$n.test.sh"
    suite_tail "$W/tools/test/$n.test.sh"
  done
  echo "echo c" >"$W/scripts/c.sh"
  git -C "$W" init -q -b main
  git -C "$W" add -A
  git -C "$W" -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false commit -q -m base
}

t_changed_script_runs_its_suite() {
  scoped_world
  echo "# edit" >>"$W/scripts/a.sh"
  run_check --changed main sh
  check "changed: only the suite that names the script ran" test "$(ran)" = "a.test.sh a,"
  check "changed: the scope line names the suite" grep -q 'shell suites a$' "$W/out"
}

t_changed_script_nothing_names_runs_all() {
  scoped_world
  echo "# edit" >>"$W/scripts/c.sh"
  run_check --changed main sh
  check "changed: every suite ran" test "$(ran)" = "a.test.sh a,b.test.sh b,"
  check "changed: and the scope line says why" grep -q 'scripts/c.sh is named by no suite or test' "$W/out"
}

t_changed_without_shell_skips_the_suites() {
  scoped_world
  echo "note" >"$W/NOTES.md"
  run_check --changed main sh
  check "changed: nothing to run" grep -q 'nothing to run' "$W/out"
  check "changed: no suite ran" test -z "$(ran)"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  "$t"
done
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
