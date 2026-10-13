#!/usr/bin/env bash
# The gate before handing work back: what CI runs, with the output cut to what a failure needs.
#   tools/check.sh [--changed [base]] [types] [tests] [lint] [sh]     (pnpm check; no argument runs all four steps)
# types = tsc in every package, tests = vitest, lint = tools/ci/shell-lint.sh, sh = the shell suites in tools/test/.
# A suite whose scenarios are t_ functions behind a `want` filter (install, backup, ops-helper, ...) runs one job per
# scenario, the other suites one job each, CHECK_JOBS of them at a time (default the CPUs less 8, at least 4, so vitest keeps cores).
# --changed [base] is for the loop while working: tsc runs incrementally, vitest only on the packages the diff touches
# and on the files that name a changed script (tools/check/scope.mjs says which), and the shell steps only when it
# touches shell: then only the suites that name the changed script, or a script that sources it. A changed script that
# nothing names runs everything. The base defaults to the commit that .git/worker-base holds, else origin/main. CI and
# a plain `pnpm check` run everything.
# The steps run side by side, their lines printed in the order above; CHECK_SERIAL=1 runs them one after the other, for
# a small machine. CHECK_SLOTS (default 2) checks run at a time per clone and its worktrees: tools/slots.sh holds the slot.
# Unless CUT_LOCK_HELD or CI is set, a run holds a shared lock on $(git rev-parse --git-common-dir)/cut.lock, which a
# release holds exclusively while it cuts: the check then waits (up to CUT_LOCK_WAIT, the name the release and the page tests use too; CHECK_CUT_WAIT still works; default 1800 s) and runs later,
# behind a cut that is already waiting (cut.wait, below).
# Stamps: a step (types, lint, tests: core, web, server and each other test file under tools/, each shell suite) that ran
# green on exactly the same tracked content is not run again; see "stamps" below and tools/check/key.sh. They are read
# and written only on a clean tree, and not with --changed or CI. CHECK_FRESH=<anything> reads none (and still writes),
# CHECK_STAMPS_DIR moves them from <git common dir>/check-stamps, which every worktree shares.
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
  exit 0
fi

ALL=(types tests lint sh)
ORIG=("$@")
CHANGED=0 BASE=""
steps=()
while (($#)); do
  case $1 in
    --changed) CHANGED=1; if [[ -n ${2:-} && $2 != -* && " ${ALL[*]} " != *" $2 "* ]]; then BASE=$2; shift; fi ;;
    *) steps+=("$1") ;;
  esac
  shift
done
((${#steps[@]})) || steps=("${ALL[@]}")
for s in "${steps[@]}"; do
  [[ " ${ALL[*]} " == *" $s "* ]] || { echo "Unknown step: $s (steps: ${ALL[*]})" >&2; exit 2; }
done
# lint and sh need no node, so the CI shell job runs them before any install
if [[ " ${steps[*]} " == *" types "* || " ${steps[*]} " == *" tests "* ]]; then
  [[ -d node_modules ]] || { echo "check: node_modules is missing, run pnpm install first" >&2; exit 1; }
fi

# A release cuts under an exclusive lock on cut.lock; a check holds it shared, so the two never run at once. cut.wait is
# the cut's place in the queue: the release holds it exclusive while it waits for cut.lock, and a check takes it shared for
# a moment first, so a check that arrives while the cut waits stands behind it. Both waits share one limit. The run
# starts again under the lock, which every child inherits, with CUT_LOCK_HELD set for what it starts.
if [[ -z ${CUT_LOCK_HELD:-} && -z ${CI:-} ]] && lock=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
  cutwait=$lock/cut.wait lock=$lock/cut.lock limit=${CUT_LOCK_WAIT:-${CHECK_CUT_WAIT:-1800}} t0=$SECONDS rc=0
  : >>"$lock"; : >>"$cutwait" 2>/dev/null
  { flock -s -n "$lock" true && { [[ ! -w $cutwait ]] || flock -s -n "$cutwait" true; }; } || echo "check: waiting for the cut"
  if [[ -w $cutwait ]]; then flock -s -w "$limit" -E 97 "$cutwait" true; rc=$?; fi
  left=$((limit - (SECONDS - t0))); ((left > 0)) || left=0
  ((rc != 0)) || { CUT_LOCK_HELD=1 flock -s -w "$left" -E 97 "$lock" bash "$SELF" "${ORIG[@]}"; rc=$?; }
  ((rc != 97)) || { echo "check: the cut still holds $lock after $limit s, so the check did not run" >&2; rc=1; }
  exit "$rc"
fi

# wait for a free slot, so workers checking at the same time do not make each other's seeded tests time out
if [[ -z ${CHECK_SLOT_HELD:-} && -z ${CI:-} && " ${steps[*]} " != " lint " ]]; then
  CHECK_SLOT_HELD=1 exec bash "$ROOT/tools/slots.sh" --label check -- bash "$SELF" "${ORIG[@]}"
fi

# the scope of --changed: SCOPE_TESTS stays empty when vitest runs everything, SCOPE_SUITES when every shell suite runs
SCOPE_TESTS=() SCOPE_SUITES=()
if ((CHANGED)); then
  base=$BASE
  [[ -n $base ]] || base=$(cat "$(git rev-parse --git-dir 2>/dev/null)/worker-base" 2>/dev/null)
  if [[ -z $base ]]; then for b in origin/main main; do git rev-parse --verify -q "$b^{commit}" >/dev/null 2>&1 && { base=$b; break; }; done; fi
  declare -A sc=()
  if [[ -n $base ]]; then
    while IFS='=' read -r k v; do sc[$k]=$v; done < <(node tools/check/scope.mjs "$base")
  fi
  if [[ -z $base || -n ${sc[error]:-} ]]; then
    echo "check: --changed has no usable base (${sc[error]:-none found}; pass one: pnpm check --changed <base>), running everything"
    CHANGED=0
  else
    kept=()
    for st in "${steps[@]}"; do
      { [[ $st == lint && ${sc[lint]} == 0 ]] || [[ $st == sh && ${sc[sh]} == 0 ]]; } || kept+=("$st")
    done
    skipped=$((${#steps[@]} - ${#kept[@]}))
    steps=("${kept[@]}")
    [[ ${sc[full]} == 1 ]] || read -ra SCOPE_TESTS <<<"${sc[tests]}"
    [[ ${sc[suites]:-all} == all ]] || read -ra SCOPE_SUITES <<<"${sc[suites]}"
    shell=""
    if ((skipped)); then shell=", shell steps skipped"
    elif ((${#SCOPE_SUITES[@]})); then shell=", shell suites $(for s in "${SCOPE_SUITES[@]}"; do s=${s##*/}; printf '%s ' "${s%.test.sh}"; done)"; shell=${shell% }
    fi
    echo "check: scoped to ${base:0:12} (${sc[files]} files): vitest ${SCOPE_TESTS[*]:-everything}${sc[why]:+ (${sc[why]})}, types incremental$shell"
    ((${#steps[@]})) || { echo "check: nothing to run"; exit 0; }
  fi
fi

CHECK_LOG=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
export CHECK_LOG
cpus=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
JOBS=${CHECK_JOBS:-$((cpus > 12 ? cpus - 8 : 4))}
failed=()
trap '((${#failed[@]})) || rm -rf "$CHECK_LOG"' EXIT

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
      sh) for f in tools/test/*.test.sh; do [[ -e $f ]] && IDS+=("sh:${f##*/}"); done ;;
      tests)
        mapfile -t TESTFILES < <(git ls-files -- ':(glob)packages/*/test/**/*.test.ts' ':(glob)apps/*/test/**/*.test.ts' ':(glob)tools/**/*.test.ts')
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
  local -a args=("${SCOPE_TESTS[@]}") runfiles=()
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
  pnpm exec vitest run "${args[@]}" --reporter=json --outputFile="$json" >"$log" 2>&1
  rc=$?
  # The JSON result gives test names and messages without the progress output. Line 1 of the output is the
  # summary, the rest the failures and then the slowest tests over 2 s (tools/check/report.mjs).
  out=$(node tools/check/report.mjs "$json")
  if [[ -z $out ]]; then
    # no result file: vitest did not start (config or import error)
    finish tests 1 "vitest did not produce a result"
    strip <"$log" | tail -n 12 | indent
  elif ((rc != 0)) && ! grep -q "^  FAIL " <<<"$out"; then
    # every test passed but vitest failed, for example on an unhandled error
    finish tests 1 "$(head -n 1 <<<"$out"), run failed"
    strip <"$log" | grep -v '^$' | tail -n 12 | indent
  else
    finish tests "$rc" "$(head -n 1 <<<"$out")${from}"
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
  # a suite whose stamp hits is not run
  local total=0 hits=0 kept=() p q l
  declare -A sms=() sbad=() spass=() sskip=()
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
  for line in "${whole[@]}" "${scenarios[@]}"; do
    n=$((n + 1)); printf -v id '%02d' "$n"; list+=("$id $line")
  done
  ((${#list[@]})) && printf '%s\n' "${list[@]}" | xargs -P "$JOBS" -L1 bash "$SELF" __job
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

failed_lines=()
stamps_start
if ((${#steps[@]} > 1)) && [[ ${CHECK_SERIAL:-0} != 1 ]]; then
  # side by side: each step prints into a file of its own, and its seconds are its own. The lines are then printed in
  # the order of the steps, so the output reads as the serial run does.
  pids=()
  for s in "${steps[@]}"; do
    ( t0=$SECONDS; "step_$s" >"$CHECK_LOG/out-$s" 2>&1; ((${#failed[@]} == 0)) ) &
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
