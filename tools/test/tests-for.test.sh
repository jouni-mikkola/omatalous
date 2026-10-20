#!/usr/bin/env bash
# Tests for tools/check/tests-for.sh in a small throwaway repository: a changed stylesheet brings the pictures tests
# and the test that reads it as text, a changed sentence brings the e2e spec that holds it, a changed class the spec
# that names it, a changed script its suite, and an unrelated change brings none of those.
#
#   tools/test/tests-for.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
W=$TMP/repo
git_() { git -C "$W" -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false "$@"; }

# the repository: three packages, a stylesheet, a page, a script with its suite, tests that read files as text, two specs
world() {
  rm -rf "$W"
  mkdir -p "$W/tools/check" "$W/tools/test" "$W/scripts" "$W/e2e" "$W/apps/web/src/styles" "$W/apps/web/src/pages" \
    "$W/apps/web/test" "$W/apps/server/src" "$W/apps/server/test" "$W/packages/core/src"
  cp "$SRC/tools/check/scope.mjs" "$SRC/tools/check/tests-for.sh" "$W/tools/check/"
  local p
  for p in apps/web apps/server packages/core; do echo "{\"name\":\"@t/${p##*/}\"}" >"$W/$p/package.json"; done
  echo '.bill-row { display: flex; }' >"$W/apps/web/src/styles/tokens.css"
  printf '%s\n' 'export const Bills = () => <h2 className="bill-row">Tulevat maksut</h2>;' >"$W/apps/web/src/pages/Bills.tsx"
  echo 'export const cents = 1;' >"$W/packages/core/src/money.ts"
  echo 'echo backup' >"$W/scripts/backup.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'bash scripts/backup.sh' >"$W/tools/test/backup.test.sh"
  echo 'readFileSync("apps/web/src/styles/tokens.css")' >"$W/tools/css-lint.test.ts"
  echo 'run("pnpm shots overview")' >"$W/tools/shots-a.test.ts"
  echo 'run("pnpm shots overview")' >"$W/tools/shots-b.test.ts"
  echo 'expect(1).toBe(1)' >"$W/apps/server/test/money.test.ts"
  printf '%s\n' 'import { go } from "./helpers";' 'await page.locator(".bill-row").click(); // Tulevat maksut' >"$W/e2e/bills.spec.ts"
  printf '%s\n' 'import { go } from "./helpers";' 'await page.getByText("Asetukset").click();' >"$W/e2e/settings.spec.ts"
  echo 'export const go = 1;' >"$W/e2e/helpers.ts"
  git_ init -q -b main
  git_ add -A
  git_ commit -q -m base
  git_ checkout -q -b work
}
run_for() { (cd "$W" && bash tools/check/tests-for.sh main 2>&1); }
line() { printf '%s\n' "$out" | grep -- "^$1:" | head -1 | cut -c$((${#1} + 2))- | sed 's/^ *//'; }
has() { [[ " $(line "$1") " == *" $2 "* ]]; }

world
echo '.bill-row { display: grid; }' >"$W/apps/web/src/styles/tokens.css"
out=$(run_for)
check "css: the pictures tests run" has vitest tools/shots-a.test.ts
check "css: all of them" has vitest tools/shots-b.test.ts
check "css: the test that reads the stylesheet as text runs" has vitest tools/css-lint.test.ts
check "css: the repo rules and the sentence suite run" has vitest tools/repo-rules
check "css: the spec that names the changed class runs" has e2e e2e/bills.spec.ts
check "css: the other spec does not" bash -c '! [[ " $(printf "%s\n" "$0" | grep "^e2e:") " == *settings.spec* ]]' "$out"
check "css: no shell suite" test "$(line sh)" = ""
check "css: the changed source is named for vitest related" has related apps/web/src/styles/tokens.css

world
sed -i 's/Tulevat maksut/Erapaivat/' "$W/apps/web/src/pages/Bills.tsx"
out=$(run_for)
check "string: the spec that holds the old sentence runs" has e2e e2e/bills.spec.ts
check "string: the spec that does not does not" bash -c '! [[ "$0" == *settings.spec* ]]' "$out"
check "string: a web sentence brings the pictures tests" has vitest tools/shots-b.test.ts

world
echo 'export const cents = 2;' >"$W/packages/core/src/money.ts"
out=$(run_for)
check "unrelated: no pictures test" bash -c '! [[ "$0" == *shots-* ]]' "$out"
check "unrelated: no e2e spec" test "$(line e2e)" = ""
check "unrelated: no shell suite" test "$(line sh)" = ""
check "unrelated: the lint is not due" test "$(line lint:sh)" = "no"
check "unrelated: vitest related gets the source" has related packages/core/src/money.ts

world
echo '# edit' >>"$W/scripts/backup.sh"
out=$(run_for)
check "script: its suite runs" has sh tools/test/backup.test.sh
check "script: and the lint is due" test "$(line lint:sh)" = "yes"
check "script: no pictures test" bash -c '! [[ "$0" == *shots-* ]]' "$out"

world
echo 'export const go = 2;' >"$W/e2e/helpers.ts"
out=$(run_for)
check "helper: the specs that import it run" bash -c '[[ "$0" == *e2e/bills.spec.ts* && "$0" == *e2e/settings.spec.ts* ]]' "$(line e2e)"

world
echo 'x' >"$W/Dockerfile"
out=$(run_for)
check "unknown file: vitest runs everything and says why" bash -c '[[ "$0" == *"vitest: everything (Dockerfile is read by tests in several places)"* ]]' "$out"

world
out=$(cd "$W" && bash tools/check/tests-for.sh no-such-base 2>&1); rc=$?
check "an unknown base is refused" test $rc -eq 2
out=$(cd "$W" && bash tools/check/tests-for.sh 2>&1); rc=$?
check "no base is refused" test $rc -eq 2

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
