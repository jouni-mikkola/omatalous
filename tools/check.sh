#!/usr/bin/env bash
# The gate before handing work back: what CI runs, with the output cut to what a failure needs.
#   tools/check.sh [types] [tests] [lint] [sh]     (pnpm check; no argument runs all four steps)
# types = tsc in every package, tests = vitest, lint = tools/ci/shell-lint.sh, sh = the shell suites in tools/test/
# with the maintenance helper's scenarios run CHECK_JOBS (default 4) at a time.
# One line per step. A failing step adds the failing names and the first lines of each failure. The full logs of a
# failing run stay in a temp directory named at the end. Exit code 1 when any step fails.
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
  bash "$@" >"$CHECK_LOG/sh-$id.log" 2>&1
  echo $? >"$CHECK_LOG/sh-$id.rc"
  exit 0
fi

ALL=(types tests lint sh)
steps=("$@")
((${#steps[@]})) || steps=("${ALL[@]}")
for s in "${steps[@]}"; do
  [[ " ${ALL[*]} " == *" $s "* ]] || { echo "Unknown step: $s (steps: ${ALL[*]})" >&2; exit 2; }
done
# lint and sh need no node, so the CI shell job runs them before any install
if [[ " ${steps[*]} " == *" types "* || " ${steps[*]} " == *" tests "* ]]; then
  [[ -d node_modules ]] || { echo "check: node_modules is missing, run pnpm install first" >&2; exit 1; }
fi

CHECK_LOG=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
export CHECK_LOG
JOBS=${CHECK_JOBS:-4}
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

step_types() {
  local log=$CHECK_LOG/types.log n
  pnpm typecheck >"$log" 2>&1
  if (($? == 0)); then finish types 0 "tsc in each package"; return; fi
  n=$(strip <"$log" | grep -c 'error TS')
  finish types 1 "$n errors"
  if ((n > 0)); then
    strip <"$log" | grep 'error TS' | head -n 12 | indent
    ((n <= 12)) || echo "  ... and $((n - 12)) more"
  else
    strip <"$log" | tail -n 8 | indent
  fi
}

step_tests() {
  local json=$CHECK_LOG/vitest.json log=$CHECK_LOG/vitest.log rc out
  pnpm exec vitest run --reporter=json --outputFile="$json" >"$log" 2>&1
  rc=$?
  # The JSON result gives test names and messages without the progress output. Line 1 of the output is the
  # summary, the rest the failures.
  out=$(node - "$json" <<'JS'
const fs = require("node:fs");
let r;
try { r = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { process.exit(2); }
const clean = (s) => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
const cwd = process.cwd() + "/";
const fails = [];
for (const f of r.testResults) {
  const file = f.name.replace(cwd, "");
  const bad = (f.assertionResults || []).filter((a) => a.status === "failed");
  for (const a of bad) fails.push({ file, name: a.fullName || a.title, msg: (a.failureMessages || []).join("\n") });
  if (f.status === "failed" && bad.length === 0) fails.push({ file, name: "(file did not run)", msg: f.message || "" });
}
const skipped = r.numPendingTests ? `, ${r.numPendingTests} skipped` : "";
console.log(fails.length
  ? `${r.numFailedTests || fails.length} of ${r.numTotalTests} tests failed${skipped}`
  : `${r.numTotalTests} tests in ${r.testResults.length} files${skipped}`);
for (const f of fails.slice(0, 10)) {
  console.log(`  FAIL ${f.file} > ${f.name}`);
  const lines = clean(f.msg).split("\n").filter((l) => l.trim());
  lines.filter((l) => !/^\s+at /.test(l)).slice(0, 5).forEach((l) => console.log(`    ${l.slice(0, 160)}`));
  // the first stack frame outside node_modules says where
  const at = lines.find((l) => /^\s+at /.test(l) && !l.includes("node_modules"));
  if (at) console.log(`    ${at.trim().replace(/\((.*)\)$/, "$1").replace(cwd, "").slice(0, 160)}`);
}
if (fails.length > 10) console.log(`  ... and ${fails.length - 10} more`);
if (fails.length) console.log("  rerun one file: pnpm test " + [...new Set(fails.map((f) => f.file))].slice(0, 3).join(" "));
JS
  )
  if [[ -z $out ]]; then
    # no result file: vitest did not start (config or import error)
    finish tests 1 "vitest did not produce a result"
    strip <"$log" | tail -n 12 | indent
  elif ((rc != 0)) && [[ $out != *FAIL* ]]; then
    # every test passed but vitest failed, for example on an unhandled error
    finish tests 1 "$(head -n 1 <<<"$out"), run failed"
    strip <"$log" | grep -v '^$' | tail -n 12 | indent
  else
    finish tests "$rc" "$(head -n 1 <<<"$out")"
    tail -n +2 <<<"$out"
  fi
}

step_lint() {
  local log=$CHECK_LOG/lint.log rc
  # gcc format gives one line per finding
  SHELLCHECK_OPTS="-f gcc" bash tools/ci/shell-lint.sh >"$log" 2>&1
  rc=$?
  if ((rc == 0)); then finish lint 0 "$(tail -n 1 "$log")"; return; fi
  finish lint 1 "shell-lint.sh"
  strip <"$log" | head -n 15 | indent
}

step_sh() {
  local dir=tools/test suites=() list=() n=0 id f j name line scen=0 bad=0 rc
  [[ -d $dir ]] || { finish sh 0 "no tools/test"; return; }
  # The helper suite is 42 scenarios that share nothing, so each one is a job of its own. The other suites are one
  # job each. An xargs pool keeps CHECK_JOBS of them running.
  for f in "$dir"/*.test.sh; do
    [[ -e $f ]] || continue
    names=()
    [[ ${f##*/} == ops-helper.test.sh ]] && mapfile -t names < <(grep -oE '^t_[A-Za-z0-9_]+[[:space:]]*\(\)' "$f" | tr -d '() \t')
    # a scenario written another way would be skipped by the shards, so then the suite runs whole in one job
    if ((${#names[@]})) && [[ ${#names[@]} == $(grep -cE '^[[:space:]]*(function[[:space:]]+)?t_[A-Za-z0-9_]+' "$f") ]]; then
      for name in "${names[@]}"; do
        n=$((n + 1)); scen=$((scen + 1))
        printf -v id '%02d' "$n"; list+=("$id $f $name")
      done
    else
      n=$((n + 1)); printf -v id '%02d' "$n"
      list+=("$id $f"); suites+=("$f")
    fi
  done
  ((${#list[@]})) && printf '%s\n' "${list[@]}" | xargs -P "$JOBS" -L1 bash "$SELF" __job
  for line in "${list[@]}"; do
    id=${line%% *}
    rc=$(cat "$CHECK_LOG/sh-$id.rc" 2>/dev/null || echo 1)
    if ((rc != 0)); then
      bad=$((bad + 1))
      if ((bad <= 8)); then
        j=$(awk '/^FAIL/ { print; if ((getline nxt) > 0 && nxt ~ /^[[:space:]]/) print nxt }' "$CHECK_LOG/sh-$id.log" | head -n 6 | indent)
        [[ -n $j ]] || j=$(strip <"$CHECK_LOG/sh-$id.log" | tail -n 5 | indent)
        failed_lines+=("  ${line#* }" "$j")
      fi
    fi
  done
  if ((bad == 0)); then
    finish sh 0 "$scen helper scenarios, ${#suites[@]} other suites, $JOBS at a time"
  else
    finish sh 1 "$bad of ${#list[@]} jobs failed"
    printf '%s\n' "${failed_lines[@]}"
    echo "  rerun one: bash tools/test/<suite>.test.sh [scenario name]"
  fi
}

failed_lines=()
for s in "${steps[@]}"; do "step_$s"; done

if ((${#failed[@]})); then
  echo "check: ${#failed[@]} of ${#steps[@]} steps failed (${failed[*]}). Logs: $CHECK_LOG"
  exit 1
fi
echo "check: all ${#steps[@]} steps ok in ${SECONDS}s"
