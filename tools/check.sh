#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2154 # cpus, JOBS and floor come from jobs_split, seen goes to weights_write by name (tools/check/weights.sh)
# The gate before handing work back: what CI runs, with the output cut to what a failure needs.
#   tools/check.sh [--changed [base]] [types] [tests] [lint] [sh]     (pnpm check; no argument runs all four steps)
# types = tsc in every package, tests = vitest, lint = tools/ci/shell-lint.sh, sh = the shell suites in tools/test/.
# A suite whose scenarios are t_ functions behind a `want` filter (install, backup, ops-helper, ...) runs one job per
# scenario, the other suites one job each, CHECK_JOBS of them at a time (default the CPUs less 8, at least 4, so vitest keeps cores).
# --changed [base] is for the loop while working: tsc runs incrementally, vitest runs with its own --changed (the test files
# that import a changed file), and the shell steps only when the change touches shell: the lint for a changed script, and
# the suites of the touched folders, which are the suites that name a file in the folder of a changed file (a changed
# suite runs itself, a changed file at the root the suites that name it). The base defaults to the commit that
# .git/worker-base holds, else origin/main. CI and a plain `pnpm check` run everything, except that the self-tests of the developer and release tools
# (tools/check/tooling.txt) run only when the change touches tools/, .github/ or scripts/ since that base: always in CI
# (CHECK_LIGHT=1, set by the light tier of ci.yml, applies the rule there too), with CHECK_FRESH (the release gate sets
# it) or CHECK_TOOLING=1, never with CHECK_TOOLING=0.
# The steps run side by side, their lines printed in the order above; CHECK_SERIAL=1 runs them one after the other, for
# a small machine.
# Unless CUT_LOCK_HELD or CI is set, a run holds a shared lock on $(git rev-parse --git-common-dir)/cut.lock, which a
# release holds exclusively while it cuts: the check then waits (up to CUT_LOCK_WAIT, the name the release and the page tests use too; CHECK_CUT_WAIT still works; default 1800 s) and runs later,
# behind a cut that is already waiting (cut.wait, below).
# Stamps: a step (types, lint, tests: core, web, server and each other test file under tools/, each shell suite) that ran
# green on exactly the same tracked content is not run again; see "stamps" below and tools/check/key.sh. They are read
# and written only on a clean tree, and not with --changed or CI. CHECK_FRESH=<anything> reads none (and still writes),
# CHECK_STAMPS_DIR moves them from <git common dir>/check-stamps, which every worktree shares.
# --rerun [DIR] [--e2e-log FILE] decides flake or real: it runs again, once and alone, at nice 10, with the environment the
# red run recorded in DIR (the folder a red run keeps, named on its last line), every failed vitest file, shell job and, from
# the output of a red `pnpm e2e` in FILE, page spec, and prints FLAKE (passes alone), REAL (fails alone) or NOT RUN (the rerun selected no test) for each with the
# number of kept red runs (check.* beside DIR) it failed in. Exit 1 when one is REAL (tools/check/rerun.mjs).
# CHECK_SHARD=<i>/<n> runs part i of n of the test files: the tests step passes it to vitest as --shard, which cuts the
# files it would run (with --changed too) into n parts that add up to all of them. ci.yml runs two on two runners. The
# other steps do not read it, and neither does a rerun, which names its files.
# One line per step. A failing step adds the failing names and the first lines of each failure. The tests step also
# names the three slowest tests over 2 s (tools/check/report.mjs), so one near vitest's 5 s timeout shows before it
# fails. The full logs of a failing run stay in a temp directory named at the end. Exit code 1 when any step fails.
set -uo pipefail

SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")
ROOT=$(cd "$(dirname "$SELF")/.." && pwd)
cd "$ROOT" || exit 1
# pnpm -s sets npm_config_reporter=silent, which would also hide the tsc errors this script prints
unset npm_config_loglevel npm_config_reporter
# One shell suite, or one scenario of the helper suite, started by xargs below. Always exits 0: the result is in
# the .rc file, so one failing scenario cannot stop the others.
if [[ ${1:-} == __job ]]; then
  id=$2; shift 2
  t0=${EPOCHREALTIME/./}
  bash "$@" >"$CHECK_LOG/sh-$id.log" 2>&1
  echo $? >"$CHECK_LOG/sh-$id.rc"
  echo $(((${EPOCHREALTIME/./} - t0) / 1000)) >"$CHECK_LOG/sh-$id.ms"
  # the CPU ms of the job (`times` of its children, to a file: in a pipe it runs in a subshell that has none); a busy machine stretches the wall time, never this
  times >"$CHECK_LOG/sh-$id.t"; awk 'NR == 2 { for (i = 1; i <= 2; i++) { split($i, a, "m"); t += a[1] * 60 + a[2] } printf "%d\n", t * 1000 }' "$CHECK_LOG/sh-$id.t" >"$CHECK_LOG/sh-$id.cpu"
  exit 0
fi

ALL=(types tests lint sh)
ORIG=("$@")
CHANGED=0 BASE="" RERUN=0 RERUN_ARGS=()
steps=()
while (($#)); do
  case $1 in
    --changed) CHANGED=1; if [[ -n ${2:-} && $2 != -* && " ${ALL[*]} " != *" $2 "* ]]; then BASE=$2; shift; fi ;;
    --rerun) RERUN=1; if [[ -n ${2:-} && $2 != -* ]]; then RERUN_ARGS+=("$2"); shift; fi ;;
    --e2e-log) RERUN=1; RERUN_ARGS+=("$1" "${2:-}"); shift ;;
    *) steps+=("$1") ;;
  esac
  shift
done
((${#steps[@]})) || steps=("${ALL[@]}")
for s in "${steps[@]}"; do
  [[ " ${ALL[*]} " == *" $s "* ]] || { echo "Unknown step: $s (steps: ${ALL[*]})" >&2; exit 2; }
done
if [[ -n ${CHECK_SHARD:-} ]]; then
  [[ $CHECK_SHARD =~ ^([1-9][0-9]*)/([1-9][0-9]*)$ ]] && ((BASH_REMATCH[1] <= BASH_REMATCH[2])) ||
    { echo "check: CHECK_SHARD is <i>/<n> with i from 1 to n, not $CHECK_SHARD" >&2; exit 2; }
fi
# lint and sh need no node, so the CI shell job runs them before any install
if ((!RERUN)) && [[ " ${steps[*]} " == *" types "* || " ${steps[*]} " == *" tests "* ]]; then
  [[ -d node_modules ]] || { echo "check: node_modules is missing, run pnpm install first" >&2; exit 1; }
fi

# The steps that run node run on the node of .npmrc, the one with TypeScript support (tools/check/pinned-node.sh)
if ((RERUN)) || [[ " ${steps[*]} " == *" types "* || " ${steps[*]} " == *" tests "* ]]; then source "$ROOT/tools/check/pinned-node.sh"; fi

# The shared cut lock (tools/check/cut-shared.sh: the queue of cut.wait, then cut.lock shared, one limit): the run starts
# again under it, with CUT_LOCK_HELD set. It is taken before the slot below, never after: see that script.
if [[ -z ${CUT_LOCK_HELD:-} && -z ${CI:-} ]] && git rev-parse --git-common-dir >/dev/null 2>&1; then
  exec bash "$ROOT/tools/check/cut-shared.sh" check -- bash "$SELF" "${ORIG[@]}"
fi

# --rerun: only the failures of an earlier red run, in the lead's slot or the workers', under the same cut lock
if ((RERUN)); then exec nice -n 10 node "$ROOT/tools/check/rerun.mjs" ${RERUN_ARGS[@]+"${RERUN_ARGS[@]}"}; fi

# base_of: the base a run compares with: the one given, else the commit .git/worker-base holds, else origin/main or main
base_of() {
  local b=$BASE
  [[ -n $b ]] || b=$(cat "$(git rev-parse --git-dir 2>/dev/null)/worker-base" 2>/dev/null)
  if [[ -z $b ]]; then for b in origin/main main ""; do [[ -n $b ]] && git rev-parse --verify -q "$b^{commit}" >/dev/null 2>&1 && break; done; fi
  echo "$b"
}

# the scope of --changed: SCOPE_SUITES holds the shell suites of the touched folders
SCOPE_SUITES=()
if ((CHANGED)); then
  base=$(base_of)
  if [[ -z $base ]] || ! mb=$(git merge-base HEAD "$base" 2>/dev/null); then
    echo "check: --changed has no usable base (${base:-none found}; pass one: pnpm check --changed <base>), running everything"
    CHANGED=0
  else
    mapfile -t files < <({ git diff --name-only --no-renames "$mb" -- && git ls-files --others --exclude-standard; } | sort -u)
    # a changed suite is its own; any other file stands for its folder, a file at the root for itself
    declare -A touched=()
    lint=0
    for f in "${files[@]}"; do
      [[ $f != *.sh && $f != scripts/* && $f != tools/ci/* ]] || lint=1
      if [[ $f == tools/test/*.test.sh ]]; then touched[$f]=1; elif [[ $f == */* ]]; then touched[${f%/*}/]=1; else touched[$f]=1; fi
    done
    for f in tools/test/*.test.sh; do
      [[ -e $f ]] || continue
      for d in "${!touched[@]}"; do
        re=$(sed 's/[][\.*^$+?(){}|]/\\&/g' <<<"$d")
        # a folder is named by a file in it, not by one of its subfolders
        [[ $d != */ ]] || re="${re}[A-Za-z0-9_.-]+([^A-Za-z0-9_./-]|\$)"
        if [[ $d == "$f" ]] || { [[ $d != tools/test/*.test.sh ]] && grep -qE "(^|[^A-Za-z0-9_.-])$re" "$f"; }; then SCOPE_SUITES+=("$f"); break; fi
      done
    done
    kept=()
    for st in "${steps[@]}"; do
      { [[ $st == lint ]] && ((!lint)); } || { [[ $st == sh ]] && ((${#SCOPE_SUITES[@]} == 0)); } || kept+=("$st")
    done
    steps=(${kept[@]+"${kept[@]}"})
    shell=", shell suites $(for s in ${SCOPE_SUITES[@]+"${SCOPE_SUITES[@]}"}; do s=${s##*/}; printf '%s ' "${s%.test.sh}"; done)"; shell=${shell% }
    ((${#SCOPE_SUITES[@]})) || shell=", no shell suite"
    echo "check: scoped to ${base:0:12} (${#files[@]} files): vitest --changed, types incremental$shell"
    ((${#steps[@]})) || { echo "check: nothing to run"; exit 0; }
  fi
fi

# The self-tests of the developer and release tools (tools/check/tooling.txt) run when the change touches tools/, .github/
# or scripts/ since the base, and always in CI (except with CHECK_LIGHT=1, the light tier of ci.yml), with CHECK_FRESH (the release gate) or CHECK_TOOLING=1. Without a base
# they run. TOOL_SUITES and TOOL_DIRS stay empty when they run, and with --changed, which picks its own tests and suites.
TOOL_SUITES=() TOOL_DIRS=()
if ((!CHANGED)) && [[ -z ${CHECK_FRESH:-} && ( -z ${CI:-} || ${CHECK_LIGHT:-} == 1 ) && ${CHECK_TOOLING:-} != 1 && -f tools/check/tooling.txt ]]; then
  tb=$(base_of)
  if [[ ${CHECK_TOOLING:-} == 0 ]] || { [[ -n $tb ]] && mb=$(git merge-base HEAD "$tb" 2>/dev/null) &&
    ! { git diff --name-only --no-renames "$mb" -- && git ls-files --others --exclude-standard; } | grep -E '^(tools|\.github|scripts)/' >/dev/null; }; then
    while IFS= read -r l; do
      case $l in '' | '#'*) ;; */) TOOL_DIRS+=("$l") ;; *) TOOL_SUITES+=("$l") ;; esac
    done <tools/check/tooling.txt
    why="nothing changed under tools/, .github/ or scripts/ since ${tb:0:12}"
    [[ ${CHECK_TOOLING:-} != 0 ]] || why="CHECK_TOOLING=0"
    echo "check: the tools' self-tests left out (${#TOOL_SUITES[@]} suites and the vitest files of ${TOOL_DIRS[*]}): $why; CHECK_TOOLING=1 runs them"
  fi
fi
# tooling FILE: whether FILE is a self-test left out by the rule above
tooling() {
  local d
  [[ " ${TOOL_SUITES[*]:-} " != *" $1 "* ]] || return 0
  for d in "${TOOL_DIRS[@]}"; do [[ $1 != "$d"* || $1 == *.sh ]] || return 0; done
  return 1
}

CHECK_LOG=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
export CHECK_LOG
# what a rerun (--rerun) has to run with as this run did
for v in CHECK_FRESH CHECK_STAMPS_DIR VITEST_MAX_WORKERS E2E_WORKERS CI TZ; do
  [[ -z ${!v:-} ]] || printf '%s=%s\n' "$v" "${!v}"
done >"$CHECK_LOG/env"
# shellcheck source=check/weights.sh
source "$ROOT/tools/check/weights.sh"
jobs_split # cpus, JOBS and floor
# On 12 CPUs or fewer the shell jobs take 4 whatever the count, and vitest's default of a worker per CPU but one beside
# them loads the machine about twice over: the budget tests then measure the crowd. With the shell suites beside the
# tests, vitest gets the CPUs the jobs leave (at least 2), unless VITEST_MAX_WORKERS says otherwise.
GIVE=0 # the cores the vitest workers hold, which the shell jobs take over when the tests step ends (sh_run)
if [[ -z ${VITEST_MAX_WORKERS:-} && ${CHECK_SERIAL:-0} != 1 && " ${steps[*]} " == *" tests "* && " ${steps[*]} " == *" sh "* ]] && ((cpus <= 12)); then
  export VITEST_MAX_WORKERS=$((cpus - JOBS > floor ? cpus - JOBS : floor))
  GIVE=$VITEST_MAX_WORKERS
fi
failed=()
trap '((${#failed[@]})) || [[ -n ${CHECK_KEEP:-} ]] || rm -rf "$CHECK_LOG"' EXIT

strip() { sed 's/\x1b\[[0-9;]*[A-Za-z]//g'; }
indent() { sed 's/^/  /' | cut -c1-170; }

# finish NAME RC SUMMARY: the one line per step
t0=$SECONDS
finish() {
  local took=$((SECONDS - t0))
  if (($2 == 0)); then
    echo "check: $1 ok ($3, ${took}s)"
  else
    echo "check: $1 FAILED ($3, ${took}s)"
    echo "$1" >>"$CHECK_LOG/failed-steps"
    failed+=("$1")
  fi
  t0=$SECONDS
}

# ── stamps ──
# A step that already ran green on exactly the same tracked content is not run again. When a stamp is read and when it is
# written is decided in tools/check/stamps.sh, which the page tests (e2e/run.mjs) use too; this file only says which ids
# a run stamps. --changed and CI use none.
TESTFILES=()
# shellcheck source=check/stamps.sh
source "$ROOT/tools/check/stamps.sh"

# part_of TESTFILE: sets PART to the stamp of the vitest part the file belongs to, or "rules" for the files that read the
# whole tree by design and always run
part_of() {
  case $1 in
    packages/*) PART=tests:core ;;
    apps/web/*) PART=tests:web ;;
    apps/server/*) PART=tests:server ;;
    tools/repo-rules/* | tools/audit/* | tools/ui-strings.test.ts | tools/where.test.ts) PART=rules ;;
    *) PART=tests:$1 ;;
  esac
}

# stamps_collect: the ids of the steps of this run (called by stamps_start once the tree is known to be clean)
stamps_collect() {
  local s f
  for s in "${steps[@]}"; do
    case $s in
      types | lint) IDS+=("$s") ;;
      sh) for f in tools/test/*.test.sh; do [[ -e $f ]] && ! tooling "$f" && IDS+=("sh:${f##*/}"); done ;;
      tests)
        mapfile -t TESTFILES < <(git ls-files -- ':(glob)packages/*/test/**/*.test.ts' ':(glob)apps/*/test/**/*.test.ts' ':(glob)tools/**/*.test.ts' | while IFS= read -r f; do tooling "$f" || [[ $f == *.perf.test.ts ]] || echo "$f"; done)
        for f in "${TESTFILES[@]}"; do part_of "$f"; [[ $PART == rules || " ${IDS[*]:-} " == *" $PART "* ]] || IDS+=("$PART"); done ;;
    esac
  done
}

step_types() {
  local log=$CHECK_LOG/types.log n d i=0 bad=0 cache=$ROOT/node_modules/.cache/tsc inc=() s0=$SECONDS
  if stamp_hit types; then finish types 0 "from a stamp of $H_AT ($H_SECS s then)"; return; fi
  # the packages and the root config in parallel; with --changed each keeps its build info outside the source folders
  if ((CHANGED)); then mkdir -p "$cache"; fi
  for d in packages/core apps/server apps/web .; do
    i=$((i + 1))
    ((CHANGED)) && inc=(--incremental --tsBuildInfoFile "$cache/$i.tsbuildinfo")
    (
      trap - INT QUIT # a Ctrl-C ends tsc too (see the steps side by side below)
      cd "$d" && "$ROOT/node_modules/.bin/tsc" -p . "${inc[@]}" 2>&1 | sed "/error TS/ s|^|${d#.}/|; s|^/||"
      echo "${PIPESTATUS[0]}" >"$log.rc$i"
    ) >"$log.$i" 2>&1 &
  done
  wait
  cat "$log".[0-9] >"$log"
  cat "$log".rc* | grep -vx 0 >/dev/null && bad=1
  if ((bad == 0)); then
    finish types 0 "tsc $( ((CHANGED)) && echo 'incremental ')in each package"
    stamp_cand types $((SECONDS - s0)) 0 0
    return
  fi
  n=$(strip <"$log" | grep -c 'error TS')
  finish types 1 "$n errors"
  if ((n > 0)); then
    strip <"$log" | grep 'error TS' | head -n 12 | indent
    ((n <= 12)) || echo "  ... and $((n - 12)) more"
  else
    strip <"$log" | tail -n 8 | indent
  fi
}

# The tests are cut into parts, each with a stamp: core, web and server, and every other test file under tools/ (the
# files in part_of's "rules" always run). The parts whose stamp hits are left out of the one vitest run; the others run
# together, and when none hit that run has no filter, so it is the one a check ran before the parts existed.
step_tests() {
  local json=$CHECK_LOG/vitest.json log=$CHECK_LOG/vitest.log rc out f id from="" nfiles=0
  local -a args=() runfiles=() exclude=(--project '!perf')
  # --changed: vitest picks the test files that import a file changed since the base, and none is no failure
  ((!CHANGED)) || args=(--changed="$base" --passWithNoTests)
  for f in "${TOOL_DIRS[@]}"; do exclude+=(--exclude "$f**"); done
  # one part of the test files (CHECK_SHARD): vitest cuts what it would run, so the parts add up to the whole run
  [[ -z ${CHECK_SHARD:-} ]] || exclude+=(--shard="$CHECK_SHARD")
  declare -A want=() hit=() P=() S=() X=() N=() T0=() T1=()
  if ((STAMP_ON)); then
    for f in "${TESTFILES[@]}"; do
      part_of "$f"; [[ $PART == rules ]] || want[$PART]=$((${want[$PART]:-0} + 1))
    done
    for id in "${!want[@]}"; do
      stamp_hit "$id" || continue
      hit[$id]="$H_AT ($H_SECS s then)"
      case $id in tests:core | tests:web | tests:server) ;; *) nfiles=$((nfiles + 1)) ;; esac
    done
    for id in tests:core tests:web tests:server; do
      [[ -z ${hit[$id]:-} ]] || from+="${from:+, }${id#tests:} from a stamp of ${hit[$id]}"
    done
    ((nfiles)) && from+="${from:+, }$nfiles tools test files from stamps"
    if ((${#hit[@]})); then
      for f in "${TESTFILES[@]}"; do part_of "$f"; [[ -n ${hit[$PART]:-} ]] || runfiles+=("$f"); done
      args=("${runfiles[@]}")
      from="; $from"
    fi
  fi
  if ((STAMP_ON && ${#hit[@]} && ${#runfiles[@]} == 0)); then
    finish tests 0 "all ${#TESTFILES[@]} test files${from}"
    return
  fi
  pnpm exec vitest run "${args[@]}" "${exclude[@]}" --reporter=json --outputFile="$json" >"$log" 2>&1
  rc=$?
  # The JSON result gives test names and messages without the progress output. Line 1 of the output is the
  # summary, the rest the failures and then the slowest tests over 2 s (tools/check/report.mjs).
  out=$(node tools/check/report.mjs "$json")
  if [[ -z $out ]] && ((CHANGED && rc == 0)); then
    finish tests 0 "no test file imports a changed file"
  elif [[ -z $out ]]; then
    # no result file: vitest did not start (config or import error)
    finish tests 1 "vitest did not produce a result"
    strip <"$log" | tail -n 12 | indent
  elif ((rc != 0)) && ! grep -q "^  FAIL " <<<"$out"; then
    # every test passed but vitest failed, for example on an unhandled error
    finish tests 1 "$(head -n 1 <<<"$out"), run failed"
    strip <"$log" | grep -v '^$' | tail -n 12 | indent
  else
    finish tests "$rc" "$(head -n 1 <<<"$out")${CHECK_SHARD:+, shard $CHECK_SHARD}${from}"
    tail -n +2 <<<"$out"
    ((STAMP_ON && rc == 0)) || return 0
    # the parts that ran: a stamp for each one whose files all ran and all passed, with no test skipped (a skip that depends on
    # the machine, a missing build or browser, would be taken by a machine that does not skip)
    local p s x a b
    while IFS=$'\t' read -r f p s x a b; do
      part_of "$f"; id=$PART
      [[ $id != rules ]] || continue
      N[$id]=$((${N[$id]:-0} + 1)); P[$id]=$((${P[$id]:-0} + p)); S[$id]=$((${S[$id]:-0} + s)); X[$id]=$((${X[$id]:-0} + x))
      [[ -n ${T0[$id]:-} ]] && ((a >= ${T0[$id]})) || T0[$id]=$a
      [[ -n ${T1[$id]:-} ]] && ((b <= ${T1[$id]})) || T1[$id]=$b
    done < <(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")),root=process.argv[2]+"/";for(const f of r.testResults){let p=0,s=0,x=0;for(const t of f.assertionResults||[]){if(t.status==="passed")p++;else if(t.status==="failed")x++;else s++}if(f.status==="failed"&&!x)x=1;console.log([f.name.replace(root,""),p,s,x,Math.round(f.startTime||0),Math.round(f.endTime||0)].join("\t"))}' "$json" "$ROOT")
    for id in "${!want[@]}"; do
      [[ -z ${hit[$id]:-} && ${N[$id]:-0} == "${want[$id]}" && ${X[$id]:-1} == 0 && ${S[$id]:-1} == 0 ]] || continue
      stamp_cand "$id" $(((${T1[$id]} - ${T0[$id]} + 999) / 1000)) "${P[$id]}" "${S[$id]}"
    done
  fi
}

step_lint() {
  local log=$CHECK_LOG/lint.log rc s0=$SECONDS
  if stamp_hit lint; then finish lint 0 "from a stamp of $H_AT ($H_SECS s then)"; return; fi
  # gcc format gives one line per finding
  SHELLCHECK_OPTS="-f gcc" bash tools/ci/shell-lint.sh >"$log" 2>&1
  rc=$?
  if ((rc == 0)); then finish lint 0 "$(tail -n 1 "$log")"; stamp_cand lint $((SECONDS - s0)) 0 0; return; fi
  finish lint 1 "shell-lint.sh"
  strip <"$log" | head -n 15 | indent
}

# shard_names SUITE: the scenario filters of a suite whose scenarios are t_ functions behind a `want` filter, one per
# line. Nothing for a suite that has to run whole.
shard_names() {
  local f=$1 names=() n m
  grep -qE '^want\(\)' "$f" && grep -qF 'FILTER=${1:-}' "$f" || return 0
  mapfile -t names < <(grep -oE '^t_[A-Za-z0-9_]+[[:space:]]*\(\)' "$f" | tr -d '() \t')
  ((${#names[@]})) || return 0
  # a scenario written another way would be skipped by the shards, so then the suite runs whole in one job
  [[ ${#names[@]} == $(grep -cE '^[[:space:]]*(function[[:space:]]+t_[A-Za-z0-9_]+|t_[A-Za-z0-9_]+[[:space:]]*\(\))' "$f") ]] || return 0
  # backup.test.sh lists its scenarios without the prefix and calls "t_$t"
  ! grep -qF '"t_$t"' "$f" || names=("${names[@]#t_}")
  # The filter is a substring match: a scenario whose name holds another's is run by that one's job, so it needs none.
  for n in "${names[@]}"; do
    for m in "${names[@]}"; do [[ $m != "$n" && $n == *"$m"* ]] && continue 2; done
    echo "$n"
  done
}

step_sh() {
  local dir=tools/test files=() list=() whole=() shards=() scenarios=() watchers=() alone=0 names n=0 id f j name line bad=0 rc ms slowest=0 slow_line=
  [[ -d $dir ]] || { finish sh 0 "no tools/test"; return; }
  if ((${#SCOPE_SUITES[@]})); then files=("${SCOPE_SUITES[@]}"); else files=("$dir"/*.test.sh); fi
  # a suite whose stamp hits is not run, nor a self-test of the tools that this run leaves out
  local total=0 hits=0 kept=() p q l cpu
  for f in "${files[@]}"; do tooling "$f" || kept+=("$f"); done
  files=(${kept[@]+"${kept[@]}"}) kept=()
  declare -A sms=() sbad=() spass=() sskip=() seen=()
  for f in "${files[@]}"; do
    [[ -e $f ]] || continue
    total=$((total + 1))
    if stamp_hit "sh:${f##*/}"; then hits=$((hits + 1)); else kept+=("$f"); fi
  done
  ((hits)) && files=("${kept[@]}")
  # A suite of independent scenarios is one job per scenario, the others one job each. An xargs pool keeps CHECK_JOBS of
  # them running. The suites that run whole come first: they cannot be split, so they should start at once.
  for f in "${files[@]}"; do
    [[ -e $f ]] || continue
    mapfile -t names < <(shard_names "$f")
    if ((${#names[@]})); then
      shards+=("$f")
      # install.test.sh greps the machine's process table for its tokens, and one scenario puts a token in an argument
      # list on purpose, so its jobs can fail by each other's processes: a failed job of such a suite is run again alone
      ! grep -qE '[[:space:]]ps -e' "$f" || watchers+=("$f")
      for name in "${names[@]}"; do scenarios+=("$f $name"); done
    else
      whole+=("$f")
    fi
  done
  sh_order ${whole[@]+"${whole[@]}"} ${scenarios[@]+"${scenarios[@]}"}
  for line in ${ORDERED[@]+"${ORDERED[@]}"}; do n=$((n + 1)); printf -v id '%02d' "$n"; list+=("$id $line"); done
  ((${#list[@]})) && sh_run "$GIVE" "$JOBS" "$SELF" "${list[@]}"
  # the jobs of this run for --rerun: id, suite, scenario filter (tab separated)
  for line in "${list[@]}"; do read -r id f name <<<"$line"; printf '%s\t%s\t%s\n' "$id" "$f" "${name:-}"; done >"$CHECK_LOG/sh-jobs"
  for line in "${list[@]}"; do
    name=""
    read -r id f name <<<"$line"
    rc=$(cat "$CHECK_LOG/sh-$id.rc" 2>/dev/null || echo 1)
    ms=$(cat "$CHECK_LOG/sh-$id.ms" 2>/dev/null || echo 0)
    ((ms > slowest)) && { slowest=$ms; slow_line=${line#* }; }
    if ((rc != 0)) && [[ -n $name && " ${watchers[*]:-} " == *" $f "* ]]; then
      bash "$f" "$name" >"$CHECK_LOG/sh-$id.log" 2>&1 && { rc=0; alone=$((alone + 1)); sbad[$f]=1; }
    fi
    # a filter that matched no scenario ends in 0 passed, 0 failed: that must not pass for a green job
    if ((rc == 0)) && [[ -n $name ]] && ! grep -qE '^(ok|FAIL) ' "$CHECK_LOG/sh-$id.log"; then
      rc=1; echo "check: the filter $name matched no scenario, so the job ran nothing" >>"$CHECK_LOG/sh-$id.log"
    fi
    echo "$rc" >"$CHECK_LOG/sh-$id.rc" # what the job finally was, for --rerun
    cpu=$(cat "$CHECK_LOG/sh-$id.cpu" 2>/dev/null || echo 0); ((cpu > 0)) || cpu=$ms; ((rc == 0 && cpu > 0)) && seen[${line#* }]=$cpu
    if ((STAMP_ON)); then
      # what a stamp of the suite says: the seconds of its jobs and the counts of their last "N passed" and "N skipped" lines
      sms[$f]=$((${sms[$f]:-0} + ms)); p=0 q=0
      while IFS= read -r l; do
        [[ $l =~ ^([0-9]+)\ passed ]] && p=${BASH_REMATCH[1]}
        [[ $l =~ ([0-9]+)\ skipped ]] && q=${BASH_REMATCH[1]}
      done <"$CHECK_LOG/sh-$id.log"
      spass[$f]=$((${spass[$f]:-0} + p)); sskip[$f]=$((${sskip[$f]:-0} + q))
      ((rc == 0)) || sbad[$f]=1
    fi
    if ((rc != 0)); then
      bad=$((bad + 1))
      if ((bad <= 8)); then
        j=$(awk '/^FAIL/ { print; detail = 1; next } detail && /^[[:space:]]/ { print } { detail = 0 }' "$CHECK_LOG/sh-$id.log" | head -n 6 | indent)
        [[ -n $j ]] || j=$(strip <"$CHECK_LOG/sh-$id.log" | tail -n 5 | indent)
        failed_lines+=("  ${line#* }" "$j")
      fi
    fi
  done
  weights_write seen
  # a suite is stamped when all its jobs passed, none needed the rerun alone and no test was skipped
  if ((STAMP_ON)); then
    for f in "${files[@]}"; do
      [[ -e $f && -z ${sbad[$f]:-} && -n ${sms[$f]:-} && ${sskip[$f]:-1} == 0 ]] && stamp_cand "sh:${f##*/}" $(((${sms[$f]} + 999) / 1000)) "${spass[$f]}" "${sskip[$f]}"
    done
  fi
  if ((bad == 0 && ${#list[@]} == 0 && hits > 0)); then
    finish sh 0 "$hits of $total suites from stamps"
  elif ((bad == 0)); then
    finish sh 0 "$( ((hits)) && echo "$hits of $total suites from stamps; ")${#scenarios[@]} scenario jobs from ${#shards[@]} suites, ${#whole[@]} suites whole, $JOBS at a time; longest job $((slowest / 1000)).$((slowest % 1000 / 100)) s: ${slow_line#tools/test/}$( ((alone)) && echo ", $alone passed when run again alone")"
  else
    finish sh 1 "$bad of ${#list[@]} jobs failed"
    printf '%s\n' "${failed_lines[@]}"
    echo "  rerun one: bash tools/test/<suite>.test.sh [scenario name]"
  fi
}

t0=$SECONDS

failed_lines=()
stamps_start
if ((${#steps[@]} > 1)) && [[ ${CHECK_SERIAL:-0} != 1 ]]; then
  # side by side: each step prints into a file of its own, and its seconds are its own. The lines are then printed in
  # the order of the steps, so the output reads as the serial run does.
  # A step in the background ignores SIGINT and SIGQUIT, and since bash 5.3 so does every program it runs: trap - gives
  # them back, so a Ctrl-C ends the steps as it ends the check, and the shell suites see the signals a terminal sends.
  pids=()
  for s in "${steps[@]}"; do
    ( trap - INT QUIT; t0=$SECONDS; "step_$s" >"$CHECK_LOG/out-$s" 2>&1; : >"$CHECK_LOG/done-$s"; ((${#failed[@]} == 0)) ) &
    pids+=($!)
  done
  for i in "${!steps[@]}"; do
    wait "${pids[$i]}" || failed+=("${steps[$i]}")
    cat "$CHECK_LOG/out-${steps[$i]}"
  done
else
  for s in "${steps[@]}"; do "step_$s"; done
fi
stamps_write

if ((${#failed[@]})); then
  echo "check: ${#failed[@]} of ${#steps[@]} steps failed (${failed[*]}). Logs: $CHECK_LOG"
  exit 1
fi
echo "check: all ${#steps[@]} steps ok in ${SECONDS}s"
