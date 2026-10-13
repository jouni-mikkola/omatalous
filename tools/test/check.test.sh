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
  cp "$SRC/tools/check.sh" "$W/tools/"; cp "$SRC/tools/check/stamps.sh" "$W/tools/check/"
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

# ── stamps ──
# A world in a repository of its own, so that its stamps are in W/.git/check-stamps and never in a real one. The steps are
# fakes that log what they ran to $RUNLOG: tsc ("types"), the lint ("lint"), vitest (one "vt:<file>" a test file, the file's
# lines being pass, fail or skip) and the suites. The real tools/check/reads.txt and key.sh decide what a change misses.
fake_vitest() {
  cat >"$W/bin/vitest.mjs" <<'EOS'
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith("--outputFile=")).slice("--outputFile=".length);
const filters = args.filter((a) => !a.startsWith("--"));
const all = execFileSync("git", ["ls-files", "--", "*.test.ts"], { encoding: "utf8" }).split("\n").filter(Boolean);
const res = { numTotalTests: 0, numFailedTests: 0, numPendingTests: 0, testResults: [] };
let t = 1000;
for (const f of all.filter((f) => !filters.length || filters.some((x) => f.includes(x)))) {
  appendFileSync(process.env.RUNLOG, `vt:${f}\n`);
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
  const bad = lines.filter((l) => l === "fail").length;
  const assertionResults = lines.map((l, i) => ({ status: l === "pass" ? "passed" : l === "fail" ? "failed" : "pending", title: `t${i}`, fullName: `${f} t${i}`, duration: 1, failureMessages: l === "fail" ? ["boom"] : [] }));
  res.numTotalTests += lines.length;
  res.numFailedTests += bad;
  res.numPendingTests += lines.filter((l) => l !== "pass" && l !== "fail").length;
  res.testResults.push({ name: `${process.cwd()}/${f}`, status: bad ? "failed" : "passed", startTime: t, endTime: t + 2000, assertionResults });
  t += 500;
}
writeFileSync(out, JSON.stringify(res));
process.exit(res.numFailedTests ? 1 : 0);
EOS
  printf '%s\n' '#!/usr/bin/env bash' '[[ $1 == exec && $2 == vitest ]] || { echo "fake pnpm: $*" >&2; exit 1; }' 'exec node "$(dirname "$0")/vitest.mjs" "${@:4}"' >"$W/bin/pnpm"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "tsc ${PWD##*/}" >>"$RUNLOG"' '[[ -z ${TSC_FAIL:-} ]] || { echo "x.ts(1,1): error TS2322: bad"; exit 1; }' >"$W/node_modules/.bin/tsc"
  printf '%s\n' '#!/usr/bin/env bash' 'echo lint >>"$RUNLOG"; [[ -z ${DURING:-} ]] || echo x >>"$DURING"; [[ -z ${TOUCHED:-} ]] || { echo x >>"$TOUCHED"; head -n -1 "$TOUCHED" >"$TOUCHED.t"; mv "$TOUCHED.t" "$TOUCHED"; }; echo "1 files ok"' >"$W/tools/ci/shell-lint.sh"
  chmod +x "$W/bin/pnpm" "$W/node_modules/.bin/tsc"
}
# skippy: passes, and says that one of its tests was skipped
fake_skippy() {
  local f=$W/tools/test/skippy.test.sh
  suite_head "$f"
  { echo 'scenario skippy'; echo 'echo "1 passed, 0 failed, 1 skipped"'; } >>"$f"
  suite_tail "$f"
}
# flaky: t_b fails the first time and passes when check.sh runs it again alone (the words in the comment make it a suite
# that is run again, so they are put together here: this suite must not hold them itself)
fake_flaky() {
  local f=$W/tools/test/flaky.test.sh ps=ps
  suite_head "$f"
  { echo "# the scenarios look at the machine: $ps -eo args"
    sed 's/^@//' <<'EOS'
@t_a() { scenario t_a; }
@t_b() { if [[ -e $RUNLOG.again ]]; then scenario t_b; else touch "$RUNLOG.again"; echo "FAIL b: the first time"; FAILED=$((FAILED + 1)); fi; }
for t in $(declare -F | awk '{print $3}' | grep '^t_'); do want "$t" && "$t"; done
EOS
  } >>"$f"
  suite_tail "$f"
}
lockinstall() { cp "$W/pnpm-lock.yaml" "$W/node_modules/.pnpm/lock.yaml"; } # what pnpm install leaves beside the packages
wcommit() { git -C "$W" add -A && git -C "$W" -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false commit -q -m "${1:-c}"; }
stamp_world() {
  world
  mkdir -p "$W"/{packages/core/src,packages/core/test,apps/web/src,apps/web/test,apps/server/test,tools/release,tools/repo-rules,tools/ci,tools/findings,docs,relay/callback,.github/workflows,.claude/hooks,node_modules/.bin,node_modules/.pnpm}
  cp "$SRC/tools/check/key.sh" "$SRC/tools/check/reads.txt" "$SRC/tools/check/report.mjs" "$W/tools/check/"
  printf '%s\n' 'runlog*' node_modules/ >>"$W/.gitignore"
  echo "export const a = 1;" >"$W/packages/core/src/a.ts"; echo "export const w = 1;" >"$W/apps/web/src/w.ts"
  echo "echo x" >"$W/scripts/x.sh"; echo "notes" >"$W/docs/NOTES.md"; echo "lock: 1" >"$W/pnpm-lock.yaml"; lockinstall
  echo "export const l = 1;" >"$W/tools/findings/x.mjs"; echo "<p>x</p>" >"$W/relay/callback/index.html"; echo "name: pages" >"$W/.github/workflows/pages.yml"
  echo "readme" >"$W/README.md"; echo "echo hook" >"$W/.claude/hooks/h.sh"
  echo '{}' >"$W/tsconfig.json"; echo '{}' >"$W/package.json"; echo "packages: []" >"$W/pnpm-workspace.yaml"; echo "export default {};" >"$W/vitest.config.ts"
  printf 'pass\npass\npass\n' >"$W/packages/core/test/a.test.ts"; echo pass >"$W/apps/web/test/w.test.ts"
  printf 'pass\npass\n' >"$W/apps/server/test/s.test.ts"; echo pass >"$W/tools/release/r.test.ts"; echo pass >"$W/tools/repo-rules/rr.test.ts"
  fake_vitest; fake_alpha; fake_plain
  git -C "$W" init -q -b main
  wcommit base
  SD=$W/.git/check-stamps BIN=$W/bin
}
# srun [VAR=value ...] [-- ARGS...]: check.sh in W without the variables of the outer run, the log of what ran in RUNLOG
srun() {
  local envs=()
  while (($#)) && [[ $1 != -- ]]; do envs+=("$1"); shift; done
  (($#)) && shift
  : >"$RUNLOG"
  (cd "$W" && env -u CHECK_LOG -u CHECK_JOBS -u CHECK_FRESH -u CHECK_STAMPS_DIR -u CI -u CUT_LOCK_HELD CHECK_SLOT_HELD=1 "${envs[@]}" PATH="$BIN:$PATH" bash tools/check.sh "$@") >"$W/out" 2>&1
  echo $? >"$W/rc"
}
ranlog() { sed -E 's/^tsc .*/types/; s/^([a-z]+)\.test\.sh .*/sh:\1/' "$RUNLOG" | LC_ALL=C sort -u | tr '\n' ' '; }
nst() { find "$SD" -type f ! -name '.tmp.*' 2>/dev/null | wc -l | tr -d ' '; }
ALL_RAN="lint sh:alpha sh:plain types vt:apps/server/test/s.test.ts vt:apps/web/test/w.test.ts vt:packages/core/test/a.test.ts vt:tools/release/r.test.ts vt:tools/repo-rules/rr.test.ts "
NOLINT_RAN=${ALL_RAN#lint } # every step that reads the whole tree: all but the lint, which reads scripts and the like
RULES_RAN="vt:tools/repo-rules/rr.test.ts "

t_stamps_a_second_run_takes_every_step_from_stamps() {
  stamp_world
  srun
  check "stamps: the first run ran everything, green" bash -c "[[ \$(cat '$W/rc') = 0 ]] && [[ '$(ranlog)' = '$ALL_RAN' ]]"
  check "stamps: and wrote one stamp a stampable step: types, lint, core, web, server, the tools test file, two suites" test "$(nst)" = 8
  check "stamps: a stamp is one line with the key, the counts of tests passed and skipped" bash -c "[[ \$(wc -l <\$(ls '$SD/tests:core/'*)) = 1 ]] && grep -qE '^key=[0-9a-f]{64} date=.* commit=[0-9a-f]+ worktree=w\.[A-Za-z0-9]+ seconds=[0-9]+ passed=3 skipped=0\$' \$(ls '$SD/tests:core/'*)"
  srun
  check "stamps: the second run ran the rules only, green" bash -c "[[ \$(cat '$W/rc') = 0 ]] && [[ '$(ranlog)' = '$RULES_RAN' ]]"
  check "stamps: and says so in each step's line" bash -c "grep -q 'types ok (from a stamp of [0-9:]* (' '$W/out' && grep -q 'lint ok (from a stamp of' '$W/out' && grep -q 'sh ok (2 of 2 suites from stamps,' '$W/out' && grep -q 'core from a stamp of [0-9:]* ([0-9]* s then), web from a stamp.*server from a stamp.*1 tools test files from stamps' '$W/out'"
  check "stamps: a hit writes no stamp" test "$(nst)" = 8
}

t_stamps_a_change_misses_the_steps_that_read_it() {
  stamp_world; srun
  echo "export const w = 2;" >"$W/apps/web/src/w.ts"; wcommit
  srun
  check "stamps: a page source misses the types, every test part and the suites: they read the whole tree; not the lint" test "$(ranlog)" = "$NOLINT_RAN"
  echo "export const a = 2;" >"$W/packages/core/src/a.ts"; wcommit
  srun
  check "stamps: so does a core source" test "$(ranlog)" = "$NOLINT_RAN"
  echo "echo y" >"$W/scripts/x.sh"; wcommit
  srun
  check "stamps: a script is in the lint's set too: everything runs" test "$(ranlog)" = "$ALL_RAN"
  srun
  check "stamps: and the next run, on the same commit, takes all of them from stamps" test "$(ranlog)" = "$RULES_RAN"
}

t_stamps_a_file_outside_the_lint_set_misses_every_other_step() {
  stamp_world; srun
  echo "more notes" >>"$W/docs/NOTES.md"; wcommit
  srun
  check "stamps: a note misses all but the lint" test "$(ranlog)" = "$NOLINT_RAN"
  check "stamps: green" test "$(cat "$W/rc")" = 0
  echo "echo more" >>"$W/.claude/hooks/h.sh"; wcommit
  srun
  check "stamps: near miss: a hook script is in the lint's set, so the lint runs too" test "$(ranlog)" = "$ALL_RAN"
}

# Each of these was a file a step reads that no set of reads.txt named: a type-checked script, the relay and the workflow
# the core tests open, the page source the server tests read, the workflows and the README the suites read.
t_stamps_a_file_a_step_reads_that_no_narrow_set_named_misses_it() {
  stamp_world; srun
  local f
  for f in tools/findings/x.mjs relay/callback/index.html .github/workflows/pages.yml README.md apps/web/src/w.ts; do
    echo " " >>"$W/$f"; wcommit
    srun
    check "stamps: a change of $f misses the types, the test parts and the suites, not the lint" test "$(ranlog)" = "$NOLINT_RAN"
  done
}

t_stamps_a_part_or_suite_with_a_skipped_test_has_no_stamp() {
  stamp_world; fake_skippy
  printf 'pass\npass\nskip\n' >"$W/packages/core/test/a.test.ts"; wcommit
  srun
  check "stamps: a skipped test is no failure: the run is green" test "$(cat "$W/rc")" = 0
  check "stamps: the part with a skipped test and the suite that says so have no stamp, the others have" bash -c "[[ ! -e '$SD/tests:core' && ! -e '$SD/sh:skippy.test.sh' && -d '$SD/tests:web' && -d '$SD/tests:server' && -d '$SD/sh:alpha.test.sh' && -d '$SD/types' ]] && [[ $(nst) = 7 ]]"
  srun
  check "stamps: so the next run runs those two and nothing else" test "$(ranlog)" = "sh:skippy vt:packages/core/test/a.test.ts $RULES_RAN"
  printf 'pass\npass\npass\n' >"$W/packages/core/test/a.test.ts"; wcommit
  srun
  check "stamps: near miss: with the skip gone the part is stamped" test -d "$SD/tests:core"
}

# the local day is in every key: a test that depends on today is not a hit on another day (date +%F is faked, date otherwise is real)
t_stamps_a_stamp_is_a_hit_on_its_own_day_only() {
  stamp_world
  printf '#!/usr/bin/env bash
if [[ ${1:-} == +%%F ]]; then cat "%s/day"; else exec /usr/bin/date "$@"; fi
' "$BIN" >"$BIN/date"; chmod +x "$BIN/date"
  echo 2031-01-01 >"$BIN/day"; srun
  check "stamps: the first run ran everything" test "$(ranlog)" = "$ALL_RAN"
  srun
  check "stamps: near miss: the same day takes all from stamps" test "$(ranlog)" = "$RULES_RAN"
  echo 2031-01-02 >"$BIN/day"; srun
  check "stamps: the next day runs every step again" test "$(ranlog)" = "$ALL_RAN"
}

t_stamps_a_variable_the_tests_read_is_in_the_key() {
  stamp_world; srun
  srun ISLAND_SEEDS=1
  check "stamps: a run with ISLAND_SEEDS set takes nothing from the stamps of a run without it" test "$(ranlog)" = "$ALL_RAN"
  srun ISLAND_SEEDS=1
  check "stamps: but takes its own, the second time" test "$(ranlog)" = "$RULES_RAN"
  srun INCREMENTAL_SEEDS=1 UPDATE_CONTRACT=1
  check "stamps: also INCREMENTAL_SEEDS and UPDATE_CONTRACT" test "$(ranlog)" = "$ALL_RAN"
  srun ISLAND_SEEDS=
  check "stamps: a variable that is set and empty is not an unset one: it takes nothing from the plain stamps" test "$(ranlog)" = "$ALL_RAN"
  srun ISLAND_SEEDS=
  check "stamps: but takes its own, the second time" test "$(ranlog)" = "$RULES_RAN"
  srun SOME_OTHER_VARIABLE=1
  check "stamps: and a variable no test reads is in no key" test "$(ranlog)" = "$RULES_RAN"
}

t_stamps_a_file_changed_and_changed_back_writes_nothing() {
  stamp_world
  srun TOUCHED=docs/NOTES.md
  check "stamps: a tracked file changed and changed back during the steps: green, clean, the same key, but no stamp" bash -c "[[ \$(cat '$W/rc') = 0 ]] && [[ $(nst) = 0 ]] && grep -q 'NOTES.md was touched' '$W/out'"
  srun
  check "stamps: near miss: the same run without it writes them" test "$(nst)" = 8
}

t_stamps_node_modules_must_be_the_install_of_the_lockfile() {
  stamp_world; srun
  echo "lock: 2" >>"$W/pnpm-lock.yaml"; wcommit; lockinstall
  srun
  check "stamps: the lockfile and its install agree: the run is stamped" test "$(nst)" = 16
  echo "stale" >"$W/node_modules/.pnpm/lock.yaml"
  srun
  check "stamps: packages installed from another lockfile: everything runs, nothing is read although the stamps are there" bash -c "[[ '$(ranlog)' = '$ALL_RAN' ]] && grep -q 'not the install of this pnpm-lock.yaml' '$W/out'"
  rm "$W/node_modules/.pnpm/lock.yaml"; echo "lock: 3" >>"$W/pnpm-lock.yaml"; wcommit
  srun
  check "stamps: and nothing is written, no install at all included" test "$(nst)" = 16
  lockinstall
  srun
  check "stamps: near miss: installed again, the run is stamped" test "$(nst)" = 24
}

t_stamps_no_two_steps_share_a_key() {
  stamp_world
  local n k1 k2
  n=$(cd "$W" && bash tools/check/key.sh tests:tools/a.test.ts tests:tools/b.test.ts types rules sh:alpha.test.sh | cut -f2 | sort -u | wc -l | tr -d ' ')
  check "stamps: two test files, the types, the rules and a suite, all read the whole tree, have five keys" test "$n" = 5
  k1=$(cd "$W" && bash tools/check/key.sh types); k2=$(cd "$W" && bash tools/check/key.sh types)
  check "stamps: near miss: the same step has the same key" test "$k1" = "$k2"
}

t_stamps_a_change_of_check_or_lockfile_misses_everything() {
  stamp_world
  local f
  for f in pnpm-lock.yaml tools/check.sh tools/check/reads.txt package.json; do
    srun
    echo "# $f" >>"$W/$f"; wcommit; lockinstall
    srun
    check "stamps: a change of $f misses every step" test "$(ranlog)" = "$ALL_RAN"
  done
}

t_stamps_a_red_step_writes_nothing() {
  stamp_world
  printf 'pass\nfail\n' >"$W/packages/core/test/a.test.ts"; wcommit
  srun
  check "stamps: a red test makes the run red" test "$(cat "$W/rc")" = 1
  check "stamps: and no test stamp is written (the run failed), where types, lint and the suites are" bash -c "[[ \$(ls '$SD' | tr '\n' ' ') = 'lint sh:alpha.test.sh sh:plain.test.sh types ' ]]"
  printf 'pass\npass\npass\n' >"$W/packages/core/test/a.test.ts"; wcommit
  srun
  check "stamps: green after the fix: the test stamps are written (and a second types stamp, for the new key)" bash -c "[[ -d '$SD/tests:core' && -d '$SD/tests:web' ]] && [[ $(nst) = 11 ]]"
  stamp_world
  srun TSC_FAIL=1
  check "stamps: a red type check writes no types stamp, the others are written" bash -c "[[ \$(cat '$W/rc') = 1 ]] && grep -q '(4 errors' '$W/out' && [[ ! -e '$SD/types' ]] && [[ $(nst) = 7 ]]"
  srun
  check "stamps: green again: only the types ran, and its stamp is written" bash -c "[[ \$(cat '$W/rc') = 0 ]] && [[ '$(ranlog)' = 'types $RULES_RAN' ]] && [[ $(nst) = 8 ]]"
}

t_stamps_a_step_green_after_a_rerun_writes_nothing() {
  stamp_world; fake_flaky; wcommit
  srun
  check "stamps: a job that passed only when run again alone is green" bash -c "[[ \$(cat '$W/rc') = 0 ]] && grep -q '1 passed when run again alone' '$W/out'"
  check "stamps: its suite has no stamp, the other suites have" bash -c "[[ ! -e '$SD/sh:flaky.test.sh' && -d '$SD/sh:alpha.test.sh' && -d '$SD/sh:plain.test.sh' ]]"
  srun
  check "stamps: next time it passes at once and runs, then its stamp is written" bash -c "[[ \$(cat '$W/rc') = 0 ]] && grep -q 'sh ok (2 of 3 suites from stamps' '$W/out' && [[ -d '$SD/sh:flaky.test.sh' ]]"
}

t_stamps_a_dirty_tree_neither_reads_nor_writes() {
  stamp_world
  echo x >"$W/extra.txt"
  srun
  check "stamps: an untracked file: everything runs, green, nothing is written, and the line says why" bash -c "[[ \$(cat '$W/rc') = 0 ]] && [[ '$(ranlog)' = '$ALL_RAN' ]] && [[ $(nst) = 0 ]] && grep -q 'the tree is not clean' '$W/out'"
  rm "$W/extra.txt"
  srun
  check "stamps: without it the same tree is stamped" test "$(nst)" = 8
  rm -r "$SD/types"
  echo x >"$W/extra.txt"; srun
  check "stamps: an untracked file reads nothing and writes nothing, although a stamp is missing" bash -c "[[ '$(ranlog)' = '$ALL_RAN' ]] && [[ ! -e '$SD/types' ]] && [[ $(nst) = 7 ]]"
  rm "$W/extra.txt"; echo changed >>"$W/docs/NOTES.md"; srun
  check "stamps: a changed tracked file: the same" bash -c "[[ '$(ranlog)' = '$ALL_RAN' ]] && [[ ! -e '$SD/types' ]] && [[ $(nst) = 7 ]]"
  git -C "$W" checkout -q docs/NOTES.md
  git -C "$W" update-index --assume-unchanged docs/NOTES.md; echo hidden >>"$W/docs/NOTES.md"; srun
  check "stamps: a change hidden by assume-unchanged is no clean tree either" bash -c "[[ '$(ranlog)' = '$ALL_RAN' ]] && [[ ! -e '$SD/types' ]]"
}

t_stamps_a_file_changed_during_the_step_writes_nothing() {
  stamp_world
  srun DURING=docs/NOTES.md
  check "stamps: a tracked file changed while the steps ran: green, but no stamp" bash -c "[[ \$(cat '$W/rc') = 0 ]] && [[ $(nst) = 0 ]] && grep -q 'no stamp written' '$W/out'"
  git -C "$W" checkout -q docs/NOTES.md
  srun
  check "stamps: near miss: the same run without the change writes them" test "$(nst)" = 8
}

t_stamps_fresh_reads_none_and_still_writes() {
  stamp_world; srun
  srun CHECK_FRESH=1
  check "stamps: CHECK_FRESH=1 runs everything" bash -c "[[ \$(cat '$W/rc') = 0 ]] && [[ '$(ranlog)' = '$ALL_RAN' ]] && ! grep -q 'from a stamp' '$W/out'"
  srun CHECK_FRESH=0
  check "stamps: any value counts, also 0" test "$(ranlog)" = "$ALL_RAN"
  rm -r "$SD"
  srun CHECK_FRESH=1
  check "stamps: and a fresh run writes the stamps" test "$(nst)" = 8
  srun
  check "stamps: which the next plain run reads" test "$(ranlog)" = "$RULES_RAN"
}

t_stamps_a_scoped_run_or_one_step_or_ci() {
  stamp_world
  local base; base=$(git -C "$W" rev-parse HEAD)
  cp "$SRC/tools/check/scope.mjs" "$W/tools/check/"; echo "echo y" >"$W/scripts/x.sh"; wcommit
  srun -- --changed "$base"
  check "stamps: a --changed run writes no stamp" bash -c "[[ \$(cat '$W/rc') = 0 ]] && [[ $(nst) = 0 ]] && grep -q 'scoped to' '$W/out'"
  srun
  srun -- --changed "$base"
  check "stamps: and reads none, with all of them there" bash -c "! grep -q 'from a stamp' '$W/out'"
  rm -r "$SD"
  srun -- sh
  check "stamps: one step run whole writes its stamps: the two suites" bash -c "[[ $(nst) = 2 ]] && [[ -d '$SD/sh:alpha.test.sh' ]]"
  srun -- types
  check "stamps: and the types; the second asks for nothing it has not got" bash -c "[[ $(nst) = 3 ]] && grep -q 'types ok (tsc' '$W/out'"
  rm -r "$SD"; srun CI=1
  check "stamps: with CI set nothing is written" test "$(nst)" = 0
  srun CHECK_STAMPS_DIR="$W/elsewhere"
  check "stamps: CHECK_STAMPS_DIR moves them" bash -c "[[ \$(find '$W/elsewhere' -type f | wc -l) = 8 ]] && [[ $(nst) = 0 ]]"
}

t_stamps_a_stamp_that_is_not_whole_is_a_miss() {
  stamp_world; srun
  local f
  f=$(ls "$SD/types/"*); : >"$f"
  f=$(ls "$SD/sh:alpha.test.sh/"*); head -c 40 "$f" >"$f.cut"; mv "$f.cut" "$f"
  f=$(ls "$SD/sh:plain.test.sh/"*); sed 's/^key=./key=0/; s/^key=00/key=01/' "$f" >"$f.cut"; mv "$f.cut" "$f"
  f=$(ls "$SD/tests:core/"*); echo "a second line" >>"$f"
  srun
  check "stamps: an empty, a cut, a stamp of another key and a stamp with a second line are misses, the rest hits" test "$(ranlog)" = "sh:alpha sh:plain types vt:packages/core/test/a.test.ts $RULES_RAN"
  srun
  check "stamps: they were written again, whole" test "$(ranlog)" = "$RULES_RAN"
}

t_stamps_are_shared_by_worktrees_of_the_same_content() {
  stamp_world; srun
  local v w1=$W
  v=$(mktemp -d "$ROOT/v.XXXXXX"); git -C "$w1" worktree add -q "$v/x" -b other
  mkdir -p "$v/x/node_modules/.bin" "$v/x/node_modules/.pnpm"; cp "$w1/node_modules/.bin/tsc" "$v/x/node_modules/.bin/"; cp "$w1/node_modules/.pnpm/lock.yaml" "$v/x/node_modules/.pnpm/"
  W=$v/x; srun
  check "stamps: another worktree with the same content takes everything from the stamps of the first" bash -c "[[ \$(cat '$W/rc') = 0 ]] && [[ '$(ranlog)' = '$RULES_RAN' ]]"
  echo "export const w = 3;" >"$W/apps/web/src/w.ts"; wcommit
  srun
  check "stamps: with one page source different, it misses all but the lint" test "$(ranlog)" = "$NOLINT_RAN"
  W=$w1; srun
  check "stamps: the first worktree still hits its own stamps" test "$(ranlog)" = "$RULES_RAN"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  "$t"
done
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
