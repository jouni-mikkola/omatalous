#!/usr/bin/env bash
# Tests for `tools/ci/verify-release.sh --pull` with a stub curl that plays ghcr.io. CURL_MODE says what the registry
# answers. Nothing here touches the network; the signature part of the script needs cosign and is not run.
#
#   tools/test/verify-release.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT=$(cd "$HERE/../ci" && pwd)/verify-release.sh
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat >"$TMP/bin/curl" <<'STUB_CURL'
#!/usr/bin/env bash
# the stub registry: records the URLs and answers by CURL_MODE
url=${*: -1}
echo "$url" >>"$CURL_LOG"
out=
while (($#)); do
  [[ $1 == -o ]] && out=$2
  [[ $1 == Authorization:* ]] && echo "$1" >>"$CURL_LOG"
  [[ $1 == -H && ${2:-} == Authorization:* ]] && echo "$2" >>"$CURL_LOG"
  shift
done
case $CURL_MODE in
  down) exit 6 ;;
esac
# the GitHub API: the release list is $RELEASES, and there is no latest release
if [[ $url == https://api.github.com/* ]]; then
  [[ $url == *"/releases?per_page=1" ]] || exit 22
  printf '%s' "$RELEASES"; exit 0
fi
case $CURL_MODE in
  private) [[ $url == *"/token?"* ]] && exit 22 ;;
esac
if [[ $url == *"/token?"* ]]; then echo '{"token":"anon-token"}'; exit 0; fi
platform() { printf '{"mediaType":"application/vnd.oci.image.manifest.v1+json","platform":{"architecture":"%s","os":"%s"}}' "$1" "$2"; }
code=200
case $CURL_MODE in
  ok) body="{\"manifests\":[$(platform amd64 linux),$(platform arm64 linux),$(platform unknown unknown)]}" ;;
  noarm) body="{\"manifests\":[$(platform amd64 linux),$(platform unknown unknown)]}" ;;
  single) body='{"schemaVersion":2,"config":{},"layers":[]}' ;;
  missing) body='{"errors":[{"code":"MANIFEST_UNKNOWN"}]}'; code=404 ;;
  login) body='{"errors":[{"code":"UNAUTHORIZED"}]}'; code=401 ;;
  *) body='{}'; code=500 ;;
esac
printf '%s' "$body" >"$out"
printf '%s' "$code"
STUB_CURL
chmod +x "$TMP/bin/curl"
export CURL_LOG=$TMP/curl.log

pull() { : >"$CURL_LOG"; CURL_MODE=$1 PATH="$TMP/bin:$PATH" bash "$SCRIPT" --pull "${@:2}" 2>&1; }

out=$(pull ok 0.9.0); rc=$?
check "exit 0 when the manifest list has amd64 and arm64" test $rc -eq 0
[[ $out == *"0.9.0: jouni-mikkola/omatalous:0.9.0 pulls without a login and holds linux/amd64 linux/arm64."* ]] && pass "says what it found" || fail "says what it found" "$out"
grep -q "^https://ghcr.io/token?service=ghcr.io&scope=repository:jouni-mikkola/omatalous:pull$" "$CURL_LOG" && pass "asks ghcr for an anonymous token for the image" || fail "asks ghcr for an anonymous token for the image" "$(cat "$CURL_LOG")"
grep -q "^https://ghcr.io/v2/jouni-mikkola/omatalous/manifests/0.9.0$" "$CURL_LOG" && pass "reads the manifest of the tag" || fail "reads the manifest of the tag" "$(cat "$CURL_LOG")"
grep -q "Bearer anon-token" "$CURL_LOG" && pass "sends the token" || fail "sends the token"
out=$(pull ok v0.9.0); rc=$?
check "a leading v is fine" test $rc -eq 0

out=$(pull noarm 0.9.0); rc=$?
check "exit 1 when arm64 is missing" test $rc -eq 1
[[ $out == *"lacks linux/arm64 (has: linux/amd64)"* ]] && pass "names the missing architecture" || fail "names the missing architecture" "$out"

out=$(pull single 0.9.0); rc=$?
check "exit 1 on a single-image manifest" test $rc -eq 1
[[ $out == *"not a manifest list"* ]] && pass "says it is no manifest list" || fail "says it is no manifest list" "$out"

out=$(pull missing 0.9.0); rc=$?
check "exit 1 when the tag is not there" test $rc -eq 1
[[ $out == *"is not on ghcr.io (404)"* ]] && pass "says 404" || fail "says 404" "$out"

out=$(pull login 0.9.0); rc=$?
check "exit 1 when the package wants a login" test $rc -eq 1
[[ $out == *"wants a login"* ]] && pass "says the package is not public" || fail "says the package is not public" "$out"
out=$(pull private 0.9.0); rc=$?
check "exit 1 when ghcr gives no anonymous token" test $rc -eq 1
[[ $out == *"gave no anonymous token"* ]] && pass "says so" || fail "says so" "$out"

out=$(pull down 0.9.0); rc=$?
check "exit 1 when ghcr cannot be reached" test $rc -eq 1
out=$(pull boom 0.9.0); rc=$?
check "exit 1 on any other answer" test $rc -eq 1
[[ $out == *"answers 500, not 200"* ]] && pass "names the answer" || fail "names the answer" "$out"

out=$(pull ok 0.9); rc=$?
check "exit 1 on a version that is not x.y.z" test $rc -eq 1

# the first release of a new root: no earlier release to verify, said only by release.sh --new-root
first() { : >"$CURL_LOG"; CURL_MODE=$1 RELEASES=$2 PATH="$TMP/bin:$PATH" env "${@:3}" bash "$SCRIPT" 2>&1; }
out=$(first ok '[]' VERIFY_RELEASE_FIRST=1); rc=$?
check "exit 0 on the first release of a new root" test $rc -eq 0
[[ $out == *"No release in jouni-mikkola/omatalous yet"* ]] && pass "says there is none to verify" || fail "says there is none to verify" "$out"
out=$(first ok '[]' VERIFY_RELEASE_FIRST=); rc=$?
check "an empty repo fails without --new-root" test $rc -ne 0 -a "${out#*yet (the first}" = "$out"
out=$(first ok '[{"tag_name":"v0.1.0"}]' VERIFY_RELEASE_FIRST=1); rc=$?
check "a repo with a release is verified on a new root too" test $rc -ne 0 -a "${out#*yet (the first}" = "$out"
out=$(first down '[]' VERIFY_RELEASE_FIRST=1); rc=$?
check "a failed request is no empty list" test $rc -ne 0 -a "${out#*yet (the first}" = "$out"

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
