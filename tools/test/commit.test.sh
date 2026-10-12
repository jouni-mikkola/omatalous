#!/usr/bin/env bash
# Tests for tools/commit.sh with a fake signing program that answers 503, 403 or signs. Throwaway repo, no network.
#
#   tools/test/commit.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
COMMIT_SH=$HERE/../commit.sh
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=$TMP/gitconfig GIT_CONFIG_SYSTEM=/dev/null
git config --global user.name t; git config --global user.email t@example.com
export SIGN_DIR=$TMP/sign REPO=$TMP/repo COMMIT_BACKOFF="0 0 0"
mkdir -p "$SIGN_DIR"

# the fake signer: what call number N does comes from line N of $SIGN_DIR/script (default: sign)
cat >"$TMP/signer" <<'EOF'
#!/usr/bin/env bash
n=$(cat "$SIGN_DIR/n" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" >"$SIGN_DIR/n"
mode=$(sed -n "${n}p" "$SIGN_DIR/script"); mode=${mode:-ok}
case $mode in
  503) echo "error: signing server answered HTTP 503 Service Unavailable" >&2; exit 1 ;;
  status503) echo "error: signing failed, status 503" >&2; exit 1 ;;
  bare503) echo "error: 503 files checked, hook failed" >&2; exit 1 ;;
  403) echo "error: signing server answered HTTP 403 Forbidden" >&2; exit 1 ;;
  stage503) (sleep 0.3; git -C "$REPO" add extra.txt) >/dev/null 2>&1 & echo "HTTP 503" >&2; exit 1 ;;
esac
printf -- '-----BEGIN SSH SIGNATURE-----\nZmFrZQ==\n-----END SSH SIGNATURE-----\n' >"${*: -1}.sig"
EOF
chmod +x "$TMP/signer"

git init -q -b main "$REPO"
git -C "$REPO" config gpg.format ssh
git -C "$REPO" config gpg.ssh.program "$TMP/signer"
git -C "$REPO" config user.signingkey "$TMP/key.pub"
git -C "$REPO" config commit.gpgsign true
echo 1 >"$REPO/a.txt"; git -C "$REPO" add a.txt

script() { printf '%s\n' "$@" >"$SIGN_DIR/script"; rm -f "$SIGN_DIR/n"; }
calls() { cat "$SIGN_DIR/n" 2>/dev/null || echo 0; }
commit() { (cd "$REPO" && bash "$COMMIT_SH" "$@" 2>&1); }
heads() { git -C "$REPO" rev-list --count HEAD 2>/dev/null || echo 0; }

script ok
out=$(commit -m one); rc=$?
check "a signing server that answers commits once" test $rc -eq 0 -a "$(calls)" = 1 -a "$(heads)" = 1
check "the commit carries a signature" git -C "$REPO" cat-file commit HEAD | grep -q '^gpgsig'

echo 2 >>"$REPO/a.txt"; git -C "$REPO" add a.txt
script 503 503 ok
out=$(commit -m two); rc=$?
check "two 503s then success: committed after three calls" test $rc -eq 0 -a "$(calls)" = 3 -a "$(heads)" = 2
[[ $out == *"retry 1 of 3"* && $out == *"retry 2 of 3"* ]] && pass "says what it is waiting for" || fail "says what it is waiting for" "$out"

echo 3 >>"$REPO/a.txt"; git -C "$REPO" add a.txt
script 403
out=$(commit -m three); rc=$?
check "a 403 is not retried and commits nothing" test $rc -ne 0 -a "$(calls)" = 1 -a "$(heads)" = 2
[[ $out == *403* ]] && pass "shows git's own message" || fail "shows git's own message" "$out"

script 503 503 503 503 503
out=$(commit -m three); rc=$?
check "a signer that stays down: first try plus three retries, then gives up" test $rc -ne 0 -a "$(calls)" = 4 -a "$(heads)" = 2
[[ $out == *"gave up after 3 retries"* ]] && pass "says it gave up" || fail "says it gave up" "$out"

script ok
out=$(commit --no-gpg-sign -m three); rc=$?
check "refuses --no-gpg-sign without calling anything" test $rc -ne 0 -a "$(calls)" = 0 -a "$(heads)" = 2
for flag in --no-gpg --no-g "-c commit.gpgsign=false" "-ccommit.gpgsign=FALSE"; do
  # shellcheck disable=SC2086
  out=$(commit $flag -m three); rc=$?
  check "refuses $flag without calling anything" test $rc -ne 0 -a "$(calls)" = 0 -a "$(heads)" = 2
done
script status503 ok
echo y >>"$REPO/a.txt"; git -C "$REPO" add a.txt
out=$(commit -m four); rc=$?
check "a signer's status 503 is retried" test $rc -eq 0 -a "$(calls)" = 2
script bare503 ok
echo z >>"$REPO/a.txt"; git -C "$REPO" add a.txt
out=$(commit -m five); rc=$?
check "a bare 503 in other output is not retried" test $rc -ne 0 -a "$(calls)" = 1
git -C "$REPO" reset -q --hard HEAD
script ok
git -C "$REPO" config commit.gpgsign false
out=$(commit -m three); rc=$?
check "refuses when commit.gpgsign is off" test $rc -ne 0 -a "$(calls)" = 0 -a "$(heads)" = 3
[[ $out == *unsigned* ]] && pass "says it would be unsigned" || fail "says it would be unsigned" "$out"
git -C "$REPO" config commit.gpgsign true

# the index changes while it waits: refuse rather than commit something else
script stage503 ok
echo w >>"$REPO/a.txt"; git -C "$REPO" add a.txt
echo x >"$REPO/extra.txt"
COMMIT_BACKOFF="1 1 1" out=$(commit -m three); rc=$?
check "refuses when the index changed between tries" test $rc -ne 0 -a "$(calls)" = 1 -a "$(heads)" = 3
[[ $out == *"index changed"* ]] && pass "says so" || fail "says so" "$out"

# the text rules on the Markdown the commit takes. The forms come from tools/repo-rules/em-dash-forms.mjs, so the dash is
# written here as bytes and the other forms are built from parts: this file holds none of them.
git -C "$REPO" reset -q --hard HEAD; git -C "$REPO" clean -fdq
script ok
DASH=$(printf '\342\200\224')
ENTITY=$(printf '&%s;' mdash)
base=$(heads)
mkdir -p "$REPO/docs" "$REPO/.claude/audit/research"
md() { printf '%b' "$2" >"$REPO/$1"; git -C "$REPO" add "$1"; }
md docs/plan.md "fine\nsecond $DASH line\n"
out=$(commit -m md); rc=$?
check "refuses staged Markdown with an em dash before it asks to sign" test $rc -ne 0 -a "$(calls)" = 0 -a "$(heads)" = "$base"
[[ $out == *"docs/plan.md:2  em dash: second"* ]] && pass "names file, line and form" || fail "names file, line and form" "$out"
[[ $out == *"CLAUDE.md"* && $out == *"Nothing was committed"* ]] && pass "says how to fix it" || fail "says how to fix it" "$out"
md docs/plan.md "a $ENTITY b\n"
out=$(commit -m md); rc=$?
check "the other forms of the rule are refused too" test $rc -ne 0 -a "$(calls)" = 0
[[ $out == *"docs/plan.md:1  HTML entity"* ]] && pass "names the form" || fail "names the form" "$out"
md docs/other.md "$DASH\n"
out=$(commit -m md); rc=$?
[[ $out == *"docs/other.md:1"* && $out == *"docs/plan.md:1"* ]] && pass "lists every file" || fail "lists every file" "$out"
out=$(cd "$REPO/docs" && bash "$COMMIT_SH" -m md 2>&1); rc=$?
check "also from a folder below the root" test $rc -ne 0 -a "$(calls)" = 0
[[ $out == *"docs/other.md:1"* ]] && pass "paths are from the root" || fail "paths are from the root" "$out"
git -C "$REPO" rm -q -f --cached docs/other.md; rm -f "$REPO/docs/other.md"
md docs/plan.md "clean\n"
out=$(commit -m md); rc=$?
check "Markdown without an em dash is committed" test $rc -eq 0 -a "$(calls)" = 1 -a "$(heads)" = $((base + 1))

# the index is what the commit takes, and with -a the working tree
md docs/plan.md "bad $DASH\n"; printf 'good\n' >"$REPO/docs/plan.md"
out=$(commit -m md); rc=$?
check "a dash in the index counts although the working tree is fixed" test $rc -ne 0 -a "$(calls)" = 1 -a "$(heads)" = $((base + 1))
md docs/plan.md "staged\n"; printf 'work %s\n' "$DASH" >"$REPO/docs/plan.md"
script ok
out=$(commit -a -m md); rc=$?
check "-a refuses a dash in the working tree" test $rc -ne 0 -a "$(calls)" = 0
out=$(commit -am md); rc=$?
check "-am too" test $rc -ne 0 -a "$(calls)" = 0
out=$(commit -m md); rc=$?
check "without -a an unstaged dash is not looked at" test $rc -eq 0 -a "$(calls)" = 1 -a "$(heads)" = $((base + 2))
git -C "$REPO" checkout -q -- docs/plan.md

# what is not looked at
script ok
md notes.txt "text $DASH\n"
out=$(COMMIT_RULES_FILE=$TMP/none.mjs commit -m txt); rc=$?
check "a commit with no Markdown commits" test $rc -eq 0 -a "$(calls)" = 1
[[ $out != *"text rules"* ]] && pass "and does not even load the rule" || fail "and does not even load the rule" "$out"
md .claude/audit/research/notes.md "text $DASH\n"
out=$(commit -m research); rc=$?
check "a research note is left out, as the rule leaves it out" test $rc -eq 0 -a "$(calls)" = 2

# the rule cannot be loaded: say so and go on
script ok
md docs/plan.md "more\n"
out=$(COMMIT_RULES_FILE=$TMP/none.mjs commit -m md); rc=$?
check "a missing rule file does not stop the commit" test $rc -eq 0 -a "$(calls)" = 1
[[ $out == *"text rules are not run"* && $out == *none.mjs* ]] && pass "and says so" || fail "and says so" "$out"
echo "export {};" >"$TMP/shape.mjs"
md docs/plan.md "more again\n"
out=$(COMMIT_RULES_FILE=$TMP/shape.mjs commit -m md); rc=$?
check "a rule file of another shape does not stop the commit" test $rc -eq 0 -a "$(calls)" = 2
[[ $out == *"text rules are not run"* && $out == *"rule 4"* ]] && pass "and says what it did not find" || fail "and says what it did not find" "$out"

echo "$PASS passed, $FAILED failed"
((FAILED == 0))
