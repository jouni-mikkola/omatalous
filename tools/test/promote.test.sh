#!/usr/bin/env bash
# Tests for tools/ci/promote-release.sh and the files around it. A stub `gh` plays GitHub (the release list, the latest
# release, the commit of a tag, the edit) and a stub `cosign` plays the signature check; both record their calls. The
# clock is a fixed number (PROMOTE_NOW), so nothing here waits or depends on the time. Nothing touches the network.
#
#   tools/test/promote.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
SCRIPT=$SRC/tools/ci/promote-release.sh
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
# said NAME TEXT: the output of the last run holds TEXT
said() { if [[ $out == *"$2"* ]]; then pass "$1"; else fail "$1" "wanted \"$2\" in: $out"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
S=$TMP/state
mkdir -p "$TMP/bin"
cat >"$TMP/bin/gh" <<'STUB_GH'
#!/usr/bin/env bash
# the stub GitHub: $STUB_DIR holds its world (releases.json, latest, commit.TAG, and the flags list_fail, latest_fail,
# edit_fail); every call is recorded, and every edit in edits.log
S=$STUB_DIR
echo "$*" >>"$S/gh.log"
notfound() { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
case $1 in
  api)
    path=${*: -1}
    case $path in
      "repos/o/r/releases?per_page=100")
        [[ ! -e $S/list_fail ]] || { echo "gh: HTTP 502: Bad Gateway" >&2; exit 1; }
        cat "$S/releases.json" ;;
      repos/o/r/releases/latest)
        [[ ! -e $S/latest_fail ]] || { echo "gh: HTTP 500: Server Error" >&2; exit 1; }
        [[ -s $S/latest ]] || notfound
        jq -nc --arg t "$(cat "$S/latest")" '{tag_name: $t}' ;;
      repos/o/r/commits/*)
        [[ -s $S/commit.${path##*/} ]] || notfound
        cat "$S/commit.${path##*/}" ;;
      repos/o/r/releases/tags/*)
        # a draft has no release by tag
        r=$(jq -c --arg t "${path##*/}" '.[] | select(.tag_name == $t and .draft == false)' "$S/releases.json")
        [[ -n $r ]] || notfound
        echo "$r" ;;
      *) echo "stub gh: unexpected api path $path" >&2; exit 2 ;;
    esac ;;
  release)
    echo "$*" >>"$S/edits.log"
    [[ ! -e $S/edit_fail ]] || { echo "gh: HTTP 403: Resource not accessible by integration" >&2; exit 1; } ;;
  *) echo "stub gh: unexpected call $*" >&2; exit 2 ;;
esac
STUB_GH
cat >"$TMP/bin/cosign" <<'STUB_COSIGN'
#!/usr/bin/env bash
# the stub signature check: an image passes when signed.VERSION holds the commit the caller asks about. A file
# hold_during names a release that is made a draft while the image is being checked (the owner holds it meanwhile).
S=$STUB_DIR
echo "$*" >>"$S/cosign.log"
if [[ -s $S/hold_during && ! -e $S/held ]]; then
  jq --arg t "$(cat "$S/hold_during")" 'map(if .tag_name == $t then .draft = true else . end)' "$S/releases.json" >"$S/releases.new"
  mv "$S/releases.new" "$S/releases.json"
  touch "$S/held"
fi
ref=${*: -1}
sha=
for ((i = 1; i <= $#; i++)); do
  if [[ ${!i} == --certificate-github-workflow-sha ]]; then j=$((i + 1)); sha=${!j}; fi
done
[[ -s $S/signed.${ref##*:} && $(cat "$S/signed.${ref##*:}") == "$sha" ]]
STUB_COSIGN
chmod +x "$TMP/bin/gh" "$TMP/bin/cosign"

NOW=1800000000
H=3600
IMAGE=ghcr.io/jouni-mikkola/omatalous

reset() { rm -rf "$S"; mkdir -p "$S"; : >"$S/gh.log"; : >"$S/cosign.log"; }
# rel TAG DRAFT PRERELEASE AGE_IN_SECONDS: one release as the API lists it
rel() {
  jq -nc --arg t "$1" --argjson d "$2" --argjson p "$3" --argjson id "$(printf '%s' "$1" | cksum | cut -d' ' -f1)" --argjson pub "$((NOW - $4))" \
    '{id: $id, tag_name: $t, draft: $d, prerelease: $p, published_at: ($pub | todate)}'
}
world() { printf '%s\n' "$@" | jq -s . >"$S/releases.json"; }
sha_of() { printf '%s' "$1" | sha1sum | cut -d' ' -f1; }
# signed X.Y.Z...: the tag vX.Y.Z names a commit and the image was signed for that commit
signed() { local v; for v in "$@"; do sha_of "$v" >"$S/commit.v$v"; sha_of "$v" >"$S/signed.$v"; done; }
latest() { printf 'v%s' "$1" >"$S/latest"; }
run() { out=$(env PATH="$TMP/bin:$PATH" GH_REPO=o/r PROMOTE_NOW=$NOW STUB_DIR=$S GITHUB_ACTIONS= "$@" bash "$SCRIPT" 2>&1); rc=$?; }
lines() { if [[ -f $1 ]]; then wc -l <"$1" | tr -d ' '; else echo 0; fi; }
edits() { cat "$S/edits.log" 2>/dev/null; }
no_edit() { [[ ! -s $S/edits.log ]]; }
# nothing_done RC: the last run ended with RC and edited nothing
nothing_done() { [[ $rc -eq $1 ]] && no_edit; }

# 1. nothing waits: one call to GitHub, no signature check
reset; world "$(rel v0.9.0 false false $((200 * H)))" "$(rel v0.9.1 true true $((100 * H)))"; latest 0.9.0
run
check "a list with no pre-release is not an error" test $rc -eq 0
said "says nothing waits" "no pre-release waits"
check "and makes no edit" no_edit
check "and costs one call to GitHub and no signature check" test "$(lines "$S/gh.log")" -eq 1 -a "$(lines "$S/cosign.log")" -eq 0

# 2. a release younger than 48 hours waits, one that is 48 hours old goes
reset; world "$(rel v0.9.1 false true $((48 * H - 1)))"; latest 0.9.0; signed 0.9.1
run
check "47 hours and 59 minutes waits" test $rc -eq 0
said "says how long" "waits until it is 48 hours old (about 1 h more)"
check "and is not edited" no_edit
check "and its image is not checked" test "$(lines "$S/cosign.log")" -eq 0
reset; world "$(rel v0.9.1 false true $((48 * H)))"; latest 0.9.0; signed 0.9.1
run
check "exactly 48 hours is promoted" test "$(edits)" = "release edit v0.9.1 --prerelease=false --latest"

# 3. the line, the image and the commit it is checked against
reset; world "$(rel v0.9.1 false true $((49 * H)))" "$(rel v0.9.0 false false $((300 * H)))"; latest 0.9.0; signed 0.9.1
run
check "a pre-release over 48 hours old and above latest is promoted" test $rc -eq 0
check "with exactly one edit, the line gh release edit TAG --prerelease=false --latest" test "$(lines "$S/edits.log")" -eq 1 -a "$(edits)" = "release edit v0.9.1 --prerelease=false --latest"
said "says what it did" "promoted v0.9.1"
check "the signature is asked for the image of the version, without the v" grep -qF " $IMAGE:0.9.1" "$S/cosign.log"
check "and for the commit the tag names" grep -qF -e "--certificate-github-workflow-sha $(sha_of 0.9.1)" "$S/cosign.log"
check "the tag's commit is read from GitHub" grep -qF "repos/o/r/commits/v0.9.1" "$S/gh.log"
check "no release is made a draft, deleted or created" bash -c '! grep -E "draft|delete|create" "$1/edits.log"' _ "$S"

# 4. a draft is held, is never promoted, and holds the line: a hold on the newest does not free an older pre-release
reset; world "$(rel v0.9.1 true true $((100 * H)))" "$(rel v0.9.0 false true $((60 * H)))"; latest 0.8.7; signed 0.9.0 0.9.1
run
check "a pre-release under a held (draft) release is not promoted in its place" nothing_done 0
said "and the line says which release holds the line" "v0.9.1 is held (a draft) and holds the line"
check "and no image is checked" test "$(lines "$S/cosign.log")" -eq 0
reset; world "$(rel v0.9.0 false true $((60 * H)))" "$(rel v0.9.1 true true $((100 * H)))"; latest 0.8.7; signed 0.9.0 0.9.1
run
check "the order of the list does not matter for a hold" nothing_done 0
reset; world "$(rel v0.9.2 false true $((60 * H)))" "$(rel v0.9.1 true true $((100 * H)))"; latest 0.9.0; signed 0.9.1 0.9.2
run
check "a draft below the newest pre-release does not stop the newest" test "$(edits)" = "release edit v0.9.2 --prerelease=false --latest"
reset; world "$(rel v0.9.1 false false $((60 * H)))" "$(rel v0.9.0 false true $((100 * H)))"; latest 0.9.1; signed 0.9.0 0.9.1
run
check "a pre-release under a promoted release is left alone" nothing_done 0
said "and the line says the highest release is promoted already" "the highest release, v0.9.1, is promoted already"
reset; world "$(rel v0.9.2 true true $((100 * H)))"; latest 0.9.0; signed 0.9.2
run
check "a draft alone is not promoted" nothing_done 0
said "and nothing waits" "no pre-release waits"

# 5. a version that is not above the latest release is stale
reset; world "$(rel v0.9.3 false true $((100 * H)))"; latest 0.9.5; signed 0.9.3
run
check "a pre-release below latest is not promoted" nothing_done 0
said "says it is not above" "is not above the latest release v0.9.5"
check "and is not checked" test "$(lines "$S/cosign.log")" -eq 0
reset; world "$(rel v0.9.5 false true $((100 * H)))"; latest 0.9.5; signed 0.9.5
run
check "the version that is latest already is not edited" nothing_done 0
reset; world "$(rel v0.10.0 false true $((100 * H)))"; latest 0.9.9; signed 0.10.0
run
check "0.10.0 is above 0.9.9" test "$(edits)" = "release edit v0.10.0 --prerelease=false --latest"
reset; world "$(rel v0.9.9 false true $((100 * H)))"; latest 0.10.0; signed 0.9.9
run
check "0.9.9 is below 0.10.0" nothing_done 0
reset; world "$(rel v0.9.1 false true $((100 * H)))"; signed 0.9.1
run
check "with no release marked latest the first one is promoted" test "$(edits)" = "release edit v0.9.1 --prerelease=false --latest"

# 6. an image that does not verify is skipped, with an annotation on a GitHub run
reset; world "$(rel v0.9.1 false true $((100 * H)))"; latest 0.9.0
sha_of 0.9.1 >"$S/commit.v0.9.1"
run GITHUB_ACTIONS=true
check "an image with no signature is not promoted" nothing_done 0
said "says why" "v0.9.1 is not promoted: $IMAGE:0.9.1 does not verify"
said "and annotates the run" "::warning::promote: v0.9.1 is not promoted"
reset; world "$(rel v0.9.1 false true $((100 * H)))"; latest 0.9.0
sha_of 0.9.1 >"$S/commit.v0.9.1"; sha_of other >"$S/signed.0.9.1"
run
check "an image signed for another commit is not promoted" nothing_done 0
said "and the check is for the commit of the tag" "for commit $(sha_of 0.9.1 | cut -c1-7)"

# 7. the newest of two is taken; the older one is left for later
reset; world "$(rel v0.9.2 false true $((60 * H)))" "$(rel v0.9.1 false true $((80 * H)))"; latest 0.9.0; signed 0.9.1 0.9.2
run
check "the newest of two is promoted" test "$(edits)" = "release edit v0.9.2 --prerelease=false --latest"
check "and exactly one edit is made" test "$(lines "$S/edits.log")" -eq 1
check "and only its image is checked" bash -c '! grep -qF ":0.9.1" "$1/cosign.log"' _ "$S"
reset; world "$(rel v0.9.1 false true $((80 * H)))" "$(rel v0.9.2 false true $((60 * H)))"; latest 0.9.0; signed 0.9.1 0.9.2
run
check "the order of the list does not matter" test "$(edits)" = "release edit v0.9.2 --prerelease=false --latest"
reset; world "$(rel v0.9.9 false true $((80 * H)))" "$(rel v0.10.0 false true $((60 * H)))"; latest 0.9.8; signed 0.9.9 0.10.0
run
check "versions are compared as numbers: 0.10.0 is newer than 0.9.9" test "$(edits)" = "release edit v0.10.0 --prerelease=false --latest"
reset; world "$(rel v0.9.1 false true $((80 * H)))" "$(rel v0.9.2 false true $((10 * H)))"; latest 0.9.0; signed 0.9.1 0.9.2
run
check "when the newest still waits, the older one is not taken in its place" nothing_done 0

# 8. tags that are not vX.Y.Z are not releases of this project
reset; world "$(rel v0.9.1-rc1 false true $((100 * H)))" "$(rel nightly false true $((100 * H)))"; latest 0.9.0
run
check "other tags are ignored" nothing_done 0
said "and nothing waits" "no pre-release waits"

# 9. a hold that comes while the image is checked wins
reset; world "$(rel v0.9.1 false true $((100 * H)))"; latest 0.9.0; signed 0.9.1; printf v0.9.1 >"$S/hold_during"
run
check "a release held while its image was checked is not promoted" nothing_done 0
said "and says it was held, pulled or promoted" "no longer a waiting pre-release"

# 10. what the script cannot read is a failure, not a silent skip
reset; world "$(rel v0.9.1 false true $((100 * H)))"; latest 0.9.0; signed 0.9.1; : >"$S/list_fail"
run
check "a list GitHub does not answer fails the run" nothing_done 1
said "and says so" "cannot list the releases of o/r"
reset; world "$(rel v0.9.1 false true $((100 * H)))"; latest 0.9.0; signed 0.9.1; : >"$S/latest_fail"
run
check "a latest release GitHub does not answer fails the run" nothing_done 1
reset; world "$(rel v0.9.1 false true $((100 * H)))"; latest 0.9.0; signed 0.9.1; rm "$S/commit.v0.9.1"
run
check "a tag with no commit fails the run" nothing_done 1
reset; world "$(rel v0.9.1 false true $((100 * H)))"; latest 0.9.0; signed 0.9.1; : >"$S/edit_fail"
run
check "an edit GitHub refuses fails the run" test $rc -eq 1
said "and says which release" "cannot promote v0.9.1"

# 11. the workflows
WF=$SRC/.github/workflows
has() { grep -qE -e "$2" "$1"; }
lacks() { ! grep -qE -e "$2" "$1"; }
creates=$(grep -c 'gh release create' "$WF/release.yml")
check "release.yml creates the release" test "$creates" -ge 1
check "and every release it creates is a pre-release" test "$(grep -c 'gh release create .*--prerelease' "$WF/release.yml")" -eq "$creates"
check "release.yml never promotes" lacks "$WF/release.yml" 'gh release edit|--latest|prerelease=false'
check "promote.yml runs only in the public repository" has "$WF/promote.yml" "^    if: github\.repository == 'jouni-mikkola/omatalous'\$"
check "promote.yml runs on a schedule" has "$WF/promote.yml" '^  schedule:'
check "and by hand" has "$WF/promote.yml" '^  workflow_dispatch:'
check "and on no push, release or pull request" lacks "$WF/promote.yml" '^  (push|pull_request|pull_request_target|release):'
check "the workflow itself has no rights" has "$WF/promote.yml" '^permissions: \{\}$'
check "and the job has contents write alone" test "$(grep -E '^ +[a-z-]+: (read|write)' "$WF/promote.yml" | sed 's/ #.*//; s/^ *//')" = "contents: write"
check "its runner is a named image" has "$WF/promote.yml" '^    runs-on: ubuntu-24\.04$'
unpinned=$(grep -E '^ *- uses:' "$WF/promote.yml" | grep -vE '@[0-9a-f]{40} # v' || true)
check "every action is pinned by commit" test -z "$unpinned"
check "the checkout and the script wait for the look at the releases" test "$(grep -c "steps.look.outputs.waiting == 'true'" "$WF/promote.yml")" -eq 2
check "the job runs this script" has "$WF/promote.yml" 'bash tools/ci/promote-release\.sh$'

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
