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
echo "$*" >>"$CURL_LOG.args"
echo "${GITHUB_TOKEN:-none} ${GH_TOKEN:-none}" >>"$CURL_LOG.env" # what the environment of a program the script starts holds
out=
head=
while (($#)); do
  [[ $1 == -o ]] && out=$2
  [[ $1 == -D ]] && head=$2
  [[ $1 == --config ]] && cat >>"$CURL_LOG"
  [[ $1 == Authorization:* ]] && echo "$1" >>"$CURL_LOG"
  [[ $1 == -H && ${2:-} == Authorization:* ]] && echo "$2" >>"$CURL_LOG"
  shift
done
case $CURL_MODE in
  down) exit 6 ;;
esac
# the GitHub API: the release list is $RELEASES, and there is no latest release. Modes: limited refuses twice with the
# rate-limit header and then answers, limited-always refuses every time that way, refused is a 403 without the header.
if [[ $url == https://api.github.com/* ]]; then
  [[ $url == *"/releases?per_page=1" ]] || exit 22
  n=$(($(cat "$CURL_LOG.n" 2>/dev/null || echo 0) + 1)); echo "$n" >"$CURL_LOG.n"
  code=200
  case $CURL_MODE in
    limited) ((n > 2)) || code=403 ;;
    limited-always | refused) code=403 ;;
  esac
  { printf 'HTTP/2 %s\r\n' "$code"; [[ $CURL_MODE == refused || $code == 200 ]] || printf 'x-ratelimit-remaining: 0\r\n'; } >"$head"
  printf '%s' "$RELEASES" >"$out"; printf '%s' "$code"; exit 0
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
first() {
  rm -f "$CURL_LOG.n" "$CURL_LOG.args" "$CURL_LOG.env"; : >"$CURL_LOG"
  CURL_MODE=$1 RELEASES=$2 PATH="$TMP/bin:$PATH" env -u GITHUB_TOKEN -u GH_TOKEN VERIFY_RELEASE_RETRY_WAIT=0 "${@:3}" bash "$SCRIPT" 2>&1
}
out=$(first ok '[]' VERIFY_RELEASE_FIRST=1); rc=$?
check "exit 0 on the first release of a new root" test $rc -eq 0
[[ $out == *"No release in jouni-mikkola/omatalous yet"* ]] && pass "says there is none to verify" || fail "says there is none to verify" "$out"
out=$(first ok '[]' VERIFY_RELEASE_FIRST=); rc=$?
check "an empty repo fails without --new-root" test $rc -ne 0 -a "${out#*yet (the first}" = "$out"
out=$(first ok '[{"tag_name":"v0.1.0"}]' VERIFY_RELEASE_FIRST=1); rc=$?
check "a repo with a release is verified on a new root too" test $rc -ne 0 -a "${out#*yet (the first}" = "$out"
out=$(first down '[]' VERIFY_RELEASE_FIRST=1); rc=$?
check "a failed request is no empty list" test $rc -ne 0 -a "${out#*yet (the first}" = "$out"

# the token: sent when there is one, never on the command line, and the plain request stays as it was
out=$(first ok '[]' VERIFY_RELEASE_FIRST=1 GITHUB_TOKEN=tok-abc123); rc=$?
check "a token does not change the answer" test $rc -eq 0
grep -q 'Authorization: Bearer tok-abc123' "$CURL_LOG" && pass "sends GITHUB_TOKEN to api.github.com" || fail "sends GITHUB_TOKEN to api.github.com"
grep -q 'tok-abc123' "$CURL_LOG.args" && fail "keeps the token off the command line" || pass "keeps the token off the command line"
[[ $out == *tok-abc123* ]] && fail "never prints the token" || pass "never prints the token"
[[ $(sort -u "$CURL_LOG.env") == "none none" ]] && pass "keeps the token out of the environment of the programs it starts" || fail "keeps the token out of the environment of the programs it starts" "$(cat "$CURL_LOG.env")"
out=$(CURL_MODE=ok RELEASES='[]' PATH="$TMP/bin:$PATH" GITHUB_TOKEN=tok-trace VERIFY_RELEASE_FIRST=1 bash -x "$SCRIPT" 2>&1); rc=$?
check "a traced run still works" test $rc -eq 0
[[ $out == *tok-trace* ]] && fail "a trace never prints the token" || pass "a trace never prints the token"
out=$(first ok '[]' VERIFY_RELEASE_FIRST=1 GH_TOKEN=tok-def456); rc=$?
grep -q 'Authorization: Bearer tok-def456' "$CURL_LOG" && pass "sends GH_TOKEN when there is no GITHUB_TOKEN" || fail "sends GH_TOKEN when there is no GITHUB_TOKEN"
out=$(first ok '[]' VERIFY_RELEASE_FIRST=1); rc=$?
check "works without a token" test $rc -eq 0
grep -q 'Authorization' "$CURL_LOG" && fail "sends no header without a token" || pass "sends no header without a token"

# a refusal that says the limit is reached is asked again, twice at most (the empty list ends the run at "No release found")
out=$(first limited '[]' VERIFY_RELEASE_FIRST=); rc=$?
[[ $out == *"No release found"* && $out != *"returned error"* ]] && pass "two rate-limit refusals are retried" || fail "two rate-limit refusals are retried" "$out"
[[ $(cat "$CURL_LOG.n") == 3 ]] && pass "asks three times in all" || fail "asks three times in all" "$(cat "$CURL_LOG.n")"
out=$(first limited-always '[]' VERIFY_RELEASE_FIRST=); rc=$?
check "a limit that stays fails" test $rc -ne 0
[[ $(cat "$CURL_LOG.n") == 3 ]] && pass "stops after three tries" || fail "stops after three tries" "$(cat "$CURL_LOG.n")"
[[ $out == *"returned error: 403"* ]] && pass "says the 403" || fail "says the 403" "$out"
out=$(first refused '[]' VERIFY_RELEASE_FIRST=); rc=$?
check "a 403 without the rate-limit header fails at once" test $rc -ne 0
[[ $(cat "$CURL_LOG.n") == 1 ]] && pass "asks once" || fail "asks once" "$(cat "$CURL_LOG.n")"

# GitHub has no latest release while the only release is a pre-release: the newest one is checked
out=$(first ok '[{"tag_name":"v0.1.0","prerelease":true}]' VERIFY_RELEASE_FIRST=); rc=$?
[[ $out == *"only pre-releases): checking the newest, v0.1.0."* ]] && pass "falls back to the newest release" || fail "falls back to the newest release" "$out"
grep -q 'releases?per_page=1' "$CURL_LOG" && pass "asks for the release list" || fail "asks for the release list"
out=$(first ok '[]' VERIFY_RELEASE_FIRST=); rc=$?
check "no release at all still fails" test $rc -ne 0 -a "${out#*only pre-releases}" = "$out"
[[ $out == *"No release found"* ]] && pass "says no release was found" || fail "says no release was found" "$out"

# the helper both this script and drill 10 of tools/ci/drills.sh take the fallback from
# shellcheck source=tools/lib/newest-release.sh
. "$HERE/../lib/newest-release.sh"
tag=$(printf '%s' '[{"tag_name":"v0.2.0","prerelease":true},{"tag_name":"v0.1.0","prerelease":true}]' | newest_release_tag)
[[ $tag == v0.2.0 ]] && pass "newest_release_tag takes the first release of the list, a pre-release too" || fail "newest_release_tag takes the first release of the list, a pre-release too" "$tag"
tag=$(printf '%s' '[]' | newest_release_tag)
[[ -z $tag ]] && pass "newest_release_tag finds nothing in an empty list" || fail "newest_release_tag finds nothing in an empty list" "$tag"
note=$(no_latest_note the-repo v0.2.0)
[[ $note == "the-repo has no latest release (only pre-releases): checking the newest, v0.2.0." ]] && pass "no_latest_note names the repository and the tag" || fail "no_latest_note names the repository and the tag" "$note"

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
