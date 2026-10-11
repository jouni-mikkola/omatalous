#!/usr/bin/env bash
# Tests for tools/ci/wait.sh with a stub `gh`: the stub answers with the files in $STUB/answers in order (the last one
# again after that). An answer is JSON, or "FAIL <exit code>" and then the text gh would print. Nothing here touches the
# network.
#
#   tools/test/wait.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WAIT=$(cd "$HERE/../ci" && pwd)/wait.sh
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
STUB=$TMP/stub
mkdir -p "$STUB"
cat >"$STUB/gh" <<'STUB_GH'
#!/usr/bin/env bash
# the stub: counts its calls, records its arguments and plays the next answer
dir=$(dirname "$0")
n=$(($(cat "$dir/count" 2>/dev/null || echo 0) + 1))
echo "$n" >"$dir/count"
echo "$*" >>"$dir/calls"
f=$dir/answers/$n
[[ -e $f ]] || f=$dir/answers/$(ls "$dir/answers" | sort -n | tail -1)
if [[ $(head -c 4 "$f") == FAIL ]]; then
  rc=$(head -1 "$f" | cut -d' ' -f2)
  tail -n +2 "$f" >&2
  exit "$rc"
fi
cat "$f"
STUB_GH
chmod +x "$STUB/gh"

SHA=0123456789abcdef0123456789abcdef01234567
reset() { rm -rf "$STUB/answers" "$STUB/count" "$STUB/calls"; mkdir -p "$STUB/answers"; }
put() { printf '%s\n' "$2" >"$STUB/answers/$1"; }
# one check run as JSON: name, status, conclusion (empty for none), id
run_json() { printf '{"id":%s,"name":"%s","status":"%s","conclusion":%s,"html_url":"https://github.com/o/r/runs/%s"}' "$4" "$1" "$2" "$([[ -n $3 ]] && printf '"%s"' "$3" || printf null)" "$4"; }
doc() { local IFS=,; printf '{"total_count":%s,"check_runs":[%s]}' "$#" "$*"; }
wait_sh() { PATH="$STUB:$PATH" bash "$WAIT" --repo o/r --interval 0 "$@" 2>&1; }
calls() { cat "$STUB/count"; }

reset
put 1 "$(doc "$(run_json ci-ok completed success 11)" "$(run_json upgrade-ok completed success 12)" "$(run_json lint completed failure 13)")"
out=$(wait_sh "$SHA" ci-ok upgrade-ok); rc=$?
check "exit 0 when every named check succeeded" test $rc -eq 0
[[ $out == *"ok ci-ok upgrade-ok on 0123456"* ]] && pass "names what it waited for" || fail "names what it waited for" "$out"
check "a check nobody asked for does not matter and one call was enough" test "$(calls)" -eq 1
grep -q "repos/o/r/commits/$SHA/check-runs" "$STUB/calls" && pass "asks GitHub for the check runs of that sha" || fail "asks GitHub for the check runs of that sha" "$(cat "$STUB/calls")"

reset
put 1 "$(doc "$(run_json ci-ok in_progress '' 11)")"
put 2 "$(doc "$(run_json ci-ok completed success 11)" "$(run_json upgrade-ok queued '' 12)")"
put 3 "$(doc "$(run_json ci-ok completed success 11)" "$(run_json upgrade-ok completed success 12)")"
out=$(wait_sh "$SHA" ci-ok upgrade-ok); rc=$?
check "polls until both have completed" test $rc -eq 0 -a "$(calls)" -eq 3

reset
put 1 "$(doc "$(run_json ci-ok completed failure 11)" "$(run_json upgrade-ok in_progress '' 12)")"
out=$(wait_sh "$SHA" ci-ok upgrade-ok); rc=$?
check "exit 1 as soon as a named check fails" test $rc -eq 1 -a "$(calls)" -eq 1
[[ $out == *"FAILED ci-ok: failure https://github.com/o/r/runs/11"* ]] && pass "names the failed check and its address" || fail "names the failed check and its address" "$out"
[[ $out == *"not finished: upgrade-ok(in_progress)"* ]] && pass "names what was still running" || fail "names what was still running" "$out"

# a push to the private repository leaves a skipped ci-ok; the dispatched run of the same commit is the answer
reset
put 1 "$(doc "$(run_json ci-ok completed skipped 11)")"
out=$(PATH="$STUB:$PATH" bash "$WAIT" --repo o/r --interval 0 --timeout 0 "$SHA" ci-ok 2>&1); rc=$?
check "a skipped check is no answer: it is pending, never green and never red" test $rc -eq 2
[[ $out == *"still waiting for: ci-ok(skipped)"* && $out == *"workflow_dispatch"* ]] && pass "says only a skipped run exists and what starts the real one" || fail "says only a skipped run exists and what starts the real one" "$out"
reset
put 1 "$(doc "$(run_json ci-ok completed skipped 11)")"
put 2 "$(doc "$(run_json ci-ok completed skipped 11)" "$(run_json ci-ok queued '' 15)")"
put 3 "$(doc "$(run_json ci-ok completed skipped 11)" "$(run_json ci-ok completed success 15)")"
out=$(wait_sh "$SHA" ci-ok); rc=$?
check "it polls past the skipped run until the dispatched one has completed" test $rc -eq 0 -a "$(calls)" -eq 3
reset
put 1 "$(doc "$(run_json ci-ok completed success 11)" "$(run_json ci-ok completed skipped 15)")"
out=$(wait_sh "$SHA" ci-ok); rc=$?
check "a skipped run newer than a green one does not take its place" test $rc -eq 0
reset
put 1 "$(doc "$(run_json ci-ok completed skipped 11)" "$(run_json ci-ok completed failure 15)")"
out=$(wait_sh "$SHA" ci-ok); rc=$?
check "a dispatched run that failed is red beside a skipped one" test $rc -eq 1
reset
put 1 "$(doc "$(run_json ci-ok completed cancelled 11)" "$(run_json upgrade-ok completed skipped 12)")"
out=$(wait_sh "$SHA" ci-ok upgrade-ok); rc=$?
check "a cancelled check beside a skipped one is exit 3" test $rc -eq 3
[[ $out == *"CANCELLED ci-ok https://github.com/o/r/runs/11 (superseded by a newer run?)"* && $out == *"not finished: upgrade-ok(skipped)"* ]] && pass "names the cancelled check and the skipped one" || fail "names the cancelled check and the skipped one" "$out"

reset
put 1 "$(doc "$(run_json ci-ok completed cancelled 11)" "$(run_json upgrade-ok completed success 12)")"
out=$(wait_sh "$SHA" ci-ok upgrade-ok); rc=$?
check "a cancelled check alone is exit 3, not a failure" test $rc -eq 3
[[ $out == *"CANCELLED ci-ok"* && $out != *"FAILED"* ]] && pass "says CANCELLED, not FAILED" || fail "says CANCELLED, not FAILED" "$out"

reset
put 1 "$(doc "$(run_json ci-ok completed success 11)")"
out=$(PATH="$STUB:$PATH" bash "$WAIT" --repo o/r --interval 0 --timeout 0 "$SHA" ci-ok upgrade-ok 2>&1); rc=$?
check "a check that has not appeared is not green: the timeout gives exit 2" test $rc -eq 2
[[ $out == *"timed out after 0s, still waiting for: upgrade-ok(missing)"* ]] && pass "says which check never showed" || fail "says which check never showed" "$out"

reset
put 1 "$(doc "$(run_json ci-ok completed failure 11)" "$(run_json ci-ok completed success 15)")"
out=$(wait_sh "$SHA" ci-ok); rc=$?
check "of two runs with one name the newest decides (a rerun that passed)" test $rc -eq 0
reset
put 1 "$(doc "$(run_json ci-ok completed success 11)" "$(run_json ci-ok completed failure 15)")"
out=$(wait_sh "$SHA" ci-ok); rc=$?
check "and a rerun that failed counts" test $rc -eq 1

reset
put 1 "$(doc "$(run_json lint completed success 1)")$(doc "$(run_json ci-ok completed success 2)")"
out=$(wait_sh "$SHA" ci-ok); rc=$?
check "reads a second page of check runs" test $rc -eq 0

reset
put 1 "FAIL 1
gh: HTTP 401: Bad credentials (https://api.github.com/repos/o/r/commits/x/check-runs)"
out=$(wait_sh "$SHA" ci-ok); rc=$?
check "exit 2 when gh is not signed in" test $rc -eq 2
[[ $out == *"cannot read CI: gh is not signed in"* ]] && pass "says why" || fail "says why" "$out"

reset
put 1 "FAIL 1
gh: Not Found (HTTP 404)"
out=$(wait_sh "$SHA" ci-ok); rc=$?
check "exit 2 when GitHub does not know the commit" test $rc -eq 2
[[ $out == *"Push it first"* ]] && pass "tells the caller to push" || fail "tells the caller to push" "$out"

reset
put 1 "FAIL 1
error connecting to api.github.com"
out=$(wait_sh "$SHA" ci-ok); rc=$?
check "exit 2 after three failed calls in a row, not at the first" test $rc -eq 2 -a "$(calls)" -eq 3
reset
put 1 "FAIL 1
error connecting to api.github.com"
put 2 "$(doc "$(run_json ci-ok completed success 11)")"
out=$(wait_sh "$SHA" ci-ok); rc=$?
check "one failed call between good ones is ignored" test $rc -eq 0

out=$(wait_sh notasha ci-ok); rc=$?
check "exit 2 on a sha that is not one" test $rc -eq 2
out=$(wait_sh "$SHA"); rc=$?
check "exit 2 without a check name" test $rc -eq 2

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
