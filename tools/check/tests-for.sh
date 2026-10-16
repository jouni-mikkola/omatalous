#!/usr/bin/env bash
# tests-for.sh <base>: the tests a change needs, for a builder who runs exactly those and not the whole check.
#   vitest:   the changed test files, the test files that read a changed file as text (not only import it), the
#             pictures tests (tools/shots-*.test.ts) when the styles or markup of the web app changed, the UI sentence
#             suite when a package source changed, and the repo rules
#   related:  the changed sources, for `pnpm vitest related <files> --run`
#   sh:       the shell suites that name a changed script (tools/test/*.test.sh), or "all"; lint:sh says if the shell lint is due
#   e2e:      the specs that name a changed class, UI sentence or e2e helper (after `pnpm build`: `pnpm e2e <specs>`)
# It prints "vitest: everything (<why>)" when a changed file is read by tests in several places. The rules are in
# tools/check/scope.mjs, which `pnpm check --changed` uses as well. Run it from the checkout; the base is the lead branch.
set -euo pipefail
[[ $# -eq 1 && $1 != -* ]] || { echo "usage: tools/check/tests-for.sh <base>" >&2; exit 2; }
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
declare -A sc=()
while IFS='=' read -r k v; do sc[$k]=$v; done < <(node tools/check/scope.mjs "$1")
if [[ -n ${sc[error]:-} ]]; then echo "tests-for: ${sc[error]}" >&2; exit 2; fi

if [[ ${sc[full]} == 1 ]]; then
  echo "vitest: everything${sc[why]:+ (${sc[why]})}"
else
  files=${sc[own]:-}\ ${sc[readers]:-}
  for t in ${sc[tests]:-}; do
    case $t in tools/repo-rules | *.ts) files+=" $t" ;; esac
  done
  echo "vitest: $(printf '%s\n' $files | sort -u | paste -sd' ' -)"
fi
echo "related: ${sc[related]:-}"
if [[ ${sc[sh]} == 1 ]]; then echo "sh: ${sc[suites]:-all}"; else echo "sh:"; fi
echo "lint:sh: $([[ ${sc[lint]} == 1 ]] && echo yes || echo no)"
echo "e2e: ${sc[e2e]:-}"
