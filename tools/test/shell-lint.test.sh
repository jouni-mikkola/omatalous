#!/usr/bin/env bash
# Tests for tools/ci/shell-lint.sh: a script and the file it sources are linted in one shellcheck run, however many other
# files there are and in whatever groups they fall (the files go to shellcheck in groups of six).
#
#   tools/test/shell-lint.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
if ! command -v shellcheck >/dev/null 2>&1; then
  echo "shellcheck is not installed: nothing to test"
  echo "0 passed, 0 failed"
  exit 0
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# world N: a tree with the lint script and N plain scripts. main.sh sets SELF and sources part.sh, which uses it: neither
# name ends in lib.sh and neither is under scripts/lib. Sorted, main.sh comes first and part.sh last.
world() {
  local w=$TMP/$1 i
  rm -rf "$w"
  mkdir -p "$w/tools/ci" "$w/tools/extra"
  cp "$REPO/tools/ci/shell-lint.sh" "$w/tools/ci/shell-lint.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'SELF=$PWD/main.sh' '. "$PWD/tools/zz/part.sh"' >"$w/tools/aa-main.sh"
  mkdir -p "$w/tools/zz"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "$SELF"' >"$w/tools/zz/part.sh"
  for ((i = 1; i <= $1; i++)); do printf '%s\n' '#!/usr/bin/env bash' 'echo hi' >"$w/tools/extra/f$(printf %02d "$i").sh"; done
}
lint() { (cd "$TMP/$1" && bash tools/ci/shell-lint.sh 2>&1); }

for n in 0 5 20 47; do
  world "$n"
  out=$(lint "$n"); rc=$?
  if ((rc == 0)); then pass "a variable of the script that sources a file is seen, with $n other scripts"; else fail "a variable of the script that sources a file is seen, with $n other scripts" "$out"; fi
done

# the sourced name may be followed by a semicolon
world 20
printf '%s\n' '#!/usr/bin/env bash' 'SELF=$PWD/main.sh' '. "$PWD/tools/zz/part.sh"; :' >"$TMP/20/tools/aa-main.sh"
out=$(lint 20); rc=$?
if ((rc == 0)); then pass "a sourced name followed by a semicolon is a library too"; else fail "a sourced name followed by a semicolon is a library too" "$out"; fi

# the near miss: a variable nobody reads is still a finding, so the lint was not switched off
world 20
printf '%s\n' '#!/usr/bin/env bash' 'UNUSED=1' >"$TMP/20/tools/extra/f07.sh"
out=$(lint 20); rc=$?
if ((rc != 0)) && [[ $out == *"f07.sh"*"UNUSED"* ]]; then pass "an unused variable of another script is still reported"; else fail "an unused variable of another script is still reported" "$out"; fi

# the near miss on the other side: a script that does not source the file is not given its variables
world 20
printf '%s\n' '#!/usr/bin/env bash' 'SELF=$PWD/main.sh' >"$TMP/20/tools/aa-main.sh"
out=$(lint 20); rc=$?
if ((rc != 0)) && [[ $out == *"aa-main.sh"*"SELF"* ]]; then pass "a variable no script uses is reported"; else fail "a variable no script uses is reported" "$out"; fi

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
