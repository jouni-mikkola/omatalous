#!/usr/bin/env bash
# Tests for tools/worker-start.sh in throwaway repos: a bare origin and a clone, with a stub pnpm. No network.
#
#   tools/test/worker-start.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/.." && pwd)
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false
export WORKER_SCRATCH=$TMP/scratch PNPM_LOG=$TMP/pnpm.log
mkdir -p "$TMP/bin"
printf '#!/usr/bin/env bash\necho "pnpm $*" >>"$PNPM_LOG"\nmkdir -p node_modules\n' >"$TMP/bin/pnpm"
chmod +x "$TMP/bin/pnpm"
export PATH=$TMP/bin:$PATH

ORIGIN=$TMP/origin.git W=$TMP/w OTHER=$TMP/other
git init -q --bare -b main "$ORIGIN"
git clone -q "$ORIGIN" "$W" 2>/dev/null
mkdir -p "$W/tools" "$W/.claude/plan/0.9.0"
cp "$SRC/worker-start.sh" "$W/tools/"
echo "# brief" >"$W/.claude/plan/0.9.0/T1.md"
git -C "$W" add -A; git -C "$W" commit -q -m start; git -C "$W" push -q origin main 2>/dev/null
START=$(git -C "$W" rev-parse HEAD)

# a later commit on origin, made elsewhere
git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
echo later >"$OTHER/later.txt"; git -C "$OTHER" add -A; git -C "$OTHER" commit -q -m later; git -C "$OTHER" push -q origin main 2>/dev/null
LATER=$(git -C "$OTHER" rev-parse HEAD)

start() { (cd "$W" && bash tools/worker-start.sh "$@" 2>&1); }

echo dirty >"$W/untracked.txt"
out=$(start "$LATER" T1); rc=$?
check "refuses a tree with an untracked file" test $rc -ne 0
[[ $out == *"has changes"* && $out == *untracked.txt* ]] && pass "names the file" || fail "names the file" "$out"
check "and did not move HEAD" test "$(git -C "$W" rev-parse HEAD)" = "$START"
rm "$W/untracked.txt"
echo more >>"$W/tools/worker-start.sh"
out=$(start "$LATER" T1); rc=$?
check "refuses a modified tracked file" test $rc -ne 0
git -C "$W" checkout -q -- tools/worker-start.sh

out=$(start "$LATER" "../escape"); rc=$?
check "refuses a task name that is a path" test $rc -ne 0
out=$(start deadbeefdeadbeefdeadbeefdeadbeefdeadbeef T1); rc=$?
check "refuses an unknown base" test $rc -ne 0

out=$(start "$LATER" T1); rc=$?
check "fast-forwards to the base" test $rc -eq 0 -a "$(git -C "$W" rev-parse HEAD)" = "$LATER"
check "installs when node_modules is missing, frozen and offline" grep -qx "pnpm install --frozen-lockfile --offline" "$PNPM_LOG"
check "makes a private scratch folder" test "$(stat -c %a "$TMP/scratch/T1")" = 700
[[ $out == *"brief:   .claude/plan/0.9.0/T1.md"* ]] && pass "prints the brief" || fail "prints the brief" "$out"
check "records the base for check --changed" test "$(cat "$W/.git/worker-base")" = "$LATER"

: >"$PNPM_LOG"
out=$(start "$LATER" T1); rc=$?
check "a second run is quiet: no install with node_modules there" test $rc -eq 0 -a ! -s "$PNPM_LOG"
[[ $out == *"already"* ]] && pass "says it is on the base" || fail "says it is on the base" "$out"

out=$(start "$START" T1); rc=$?
[[ $rc -eq 0 && $out == *"already contains"* && $(git -C "$W" rev-parse HEAD) == "$LATER" ]] && pass "an older base that HEAD contains changes nothing" || fail "an older base that HEAD contains changes nothing" "$out"

# a branch with its own commit cannot fast-forward to a base that is not its descendant
git -C "$W" checkout -q -b side "$START"
echo mine >"$W/mine.txt"; git -C "$W" add -A; git -C "$W" commit -q -m mine
out=$(start "$LATER" T1); rc=$?
check "refuses a diverged branch" test $rc -ne 0
[[ $out == *diverged* ]] && pass "says diverged" || fail "says diverged" "$out"

echo "$PASS passed, $FAILED failed"
((FAILED == 0))
