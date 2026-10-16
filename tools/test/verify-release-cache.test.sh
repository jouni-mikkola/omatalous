#!/usr/bin/env bash
# Tests for the kept verdict of tools/ci/verify-release.sh. The script runs in a stand-in repository with stubs of curl
# (a token, and the digest the registry gives the tag), of `git ls-remote` and of cosign, first in PATH. A file in the
# folder `play` changes what a stub does; every cosign run is a line in `cosign.calls`.
#
#   tools/test/verify-release-cache.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
has() { if [[ $2 == *"$3"* ]]; then pass "$1"; else fail "$1" "$2"; fi; }
lacks() { if [[ $2 != *"$3"* ]]; then pass "$1"; else fail "$1" "$2"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
R=$TMP/repo BIN=$TMP/bin PLAY=$TMP/play
mkdir -p "$R/tools/ci" "$R/scripts/lib" "$R/.github" "$BIN" "$PLAY"
cp "$REPO/tools/ci/verify-release.sh" "$R/tools/ci/"
cp "$REPO/scripts/lib/release.sh" "$R/scripts/lib/"
git -C "$R" init -q
git -C "$R" -c user.name=t -c user.email=t@t add -A
git -C "$R" -c user.name=t -c user.email=t@t commit -q -m base
BASE=$(git -C "$R" rev-parse --short HEAD)
printf '# one baseline\n%s\n' "$BASE" >"$R/.github/upgrade-from.txt"
D1=sha256:$(printf '1%.0s' {1..64}) D2=sha256:$(printf '2%.0s' {1..64})
echo "$D1" >"$PLAY/digest"

cat >"$BIN/curl" <<'STUB'
#!/usr/bin/env bash
case " $* " in
  *" -I "* | *" -fsSI "*) printf 'HTTP/2 200\r\nDocker-Content-Digest: %s\r\n\r\n' "$(cat "$PLAY/digest")" ;;
  *) echo '{"token":"t"}' ;;
esac
STUB
cat >"$BIN/git" <<'STUB'
#!/usr/bin/env bash
if [[ ${1:-} == ls-remote ]]; then printf '%s\trefs/tags/v9.9.9\n' "$(printf 'a%.0s' {1..40})"; exit 0; fi
exec /usr/bin/git "$@"
STUB
cat >"$BIN/cosign" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$PLAY/cosign.calls"
[[ ! -e $PLAY/fail-cosign ]]
STUB
chmod +x "$BIN"/*

run() { (cd "$R" && PATH="$BIN:$PATH" PLAY="$PLAY" VERIFY_RELEASE_CACHE="$TMP/cache" bash tools/ci/verify-release.sh v9.9.9 2>&1); }
runs() { { cat "$PLAY/cosign.calls" 2>/dev/null || true; } | wc -l; }

out=$(run); rc=$?
check "the first check runs cosign and passes" test $rc -eq 0 -a "$(runs)" -gt 0
lacks "the first check is not called cached" "$out" "cached:"
N=$(runs)
out=$(run); rc=$?
check "the second check passes" test $rc -eq 0
has "a hit says cached" "$out" "cached: v9.9.9"
check "a hit runs no cosign" test "$(runs)" -eq "$N"

echo "$D2" >"$PLAY/digest"
out=$(run)
lacks "a changed digest is checked in full" "$out" "cached:"
check "a changed digest runs cosign" test "$(runs)" -gt "$N"
N=$(runs)
out=$(run)
has "the new digest is kept after its check" "$out" "cached:"

sed -i "s/^SIGN_ISSUER=.*/SIGN_ISSUER='https:\/\/other.example'/" "$R/scripts/lib/release.sh"
out=$(run)
lacks "a changed identity rule is checked in full" "$out" "cached:"
check "a changed identity rule runs cosign" test "$(runs)" -gt "$N"

echo "$D1" >"$PLAY/digest"
touch "$PLAY/fail-cosign"
rm -f "$TMP/cache"
out=$(run); rc=$?
check "a failed check fails" test $rc -eq 1
N=$(runs)
out=$(run); rc=$?
check "a failed check is not kept: the next run checks again and fails" test $rc -eq 1 -a "$(runs)" -gt "$N"
lacks "a failed check is never called cached" "$out" "cached:"
rm -f "$PLAY/fail-cosign"
out=$(run); rc=$?
check "the same digest passes once the check does, in full" test $rc -eq 0
lacks "and that run was not cached" "$out" "cached:"

echo "$PASS passed, $FAILED failed"
exit $((FAILED > 0))
