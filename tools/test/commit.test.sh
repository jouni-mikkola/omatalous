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

echo "$PASS passed, $FAILED failed"
((FAILED == 0))
