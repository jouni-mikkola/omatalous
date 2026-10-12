#!/usr/bin/env bash
# Tests for which release an install follows: scripts/lib/release.sh (release_mode, release_pick, release_from_api,
# choose_release), the helper's fetch_release (lib/ops-release.sh) and update.sh run by hand. Also for the schedule of the
# helper, which a rollback puts back as an update does. Against the stub world of tools/test/ops-world.sh with a curl that
# plays the Releases API from files: nothing here touches GitHub, a real container or a real registry.
#
#   tools/test/channel.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged channel.test.sh "$@"

API=https://api.github.com/repos/jouni-mikkola/omatalous/releases
# The world's curl answers /releases/latest from release.json and release.status. This one also answers the list that
# the newest mode asks for, from list.json and list.status, and any other address with no answer.
api_stub() {
  cat >"$S/bin/curl" <<'EOF'
#!/usr/bin/env bash
S=$OPS_STUB_DIR; out=""; url=""
while (($#)); do case $1 in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done
printf 'curl %s\n' "$url" >>"$S/calls.log"
case $url in
  https://api.github.com/repos/jouni-mikkola/omatalous/releases/latest) f=release ;;
  'https://api.github.com/repos/jouni-mikkola/omatalous/releases?per_page=20') f=list ;;
  *) printf 000; exit 1 ;;
esac
code=$(cat "$S/$f.status" 2>/dev/null || echo 200)
[[ $code != 200 ]] || cp "$S/$f.json" "$out"
printf '%s' "$code"
EOF
  chmod +x "$S/bin/curl"
}
# One release as the API prints it. The author and the file carry keys with the names of the release's own (a draft, a tag),
# which are not the release's.
rel() { # rel TAG DRAFT PRERELEASE [BODY, JSON-escaped]
  printf '  {\n    "url": "https://api.github.com/repos/o/r/releases/1",\n    "author": {\n      "login": "someone",\n      "draft": true\n    },\n    "tag_name": "%s",\n    "name": "%s",\n    "draft": %s,\n    "prerelease": %s,\n    "assets": [\n      {\n        "name": "x.zip",\n        "tag_name": "v9.9.9",\n        "draft": true\n      }\n    ],\n    "body": "%s"\n  }' "$1" "$1" "$2" "$3" "${4:-Notes for $1}"
}
list() { # list REL...: the answer to the list, in this order
  local r sep=""
  printf '[\n' >"$S/list.json"
  for r in "$@"; do printf '%s%s' "$sep" "$r" >>"$S/list.json"; sep=$',\n'; done
  printf '\n]\n' >>"$S/list.json"
}
# a release in the repository and the registry that /releases/latest does not name: GitHub holds it back as a pre-release
prerelease() { local keep; keep=$(cat "$S/release.json"); release "$1"; printf '%s\n' "$keep" >"$S/release.json"; }
world() { new_world; api_stub; }
# the version a fresh daily check offers, as the heartbeat tells the page
offered() { rm -f "$S/state.last" "$CL/ops/boot_id" "$CL/ops/last-check" "$CL/ops/check.frag"; : >"$S/calls.log"; tick; jq -r '.latest_version // empty' "$S/state.last" 2>/dev/null; }
curls() { calls | grep '^curl ' || true; }
# update.sh --yes in the clone as a person runs it, with extra VAR=value for its environment: the output in OUT, the status in RC
by_hand() {
  : >"$S/calls.log"
  OUT=$(cd "$CL" && env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" "$@" ./scripts/update.sh --yes </dev/null 2>&1); RC=$?
}
# the same with --rollback
rolled_back() {
  : >"$S/calls.log"
  OUT=$(cd "$CL" && env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/update.sh --rollback --yes </dev/null 2>&1); RC=$?
}
in_out() { grep -n "$1" <<<"$OUT" | head -1 | cut -d: -f1; } # the number of the first line of OUT that has the text
# nothing was pulled, built, tagged or started
untouched() { test "$(n_calls '^docker (pull|image tag|compose (up|build))')" = 0; }
quiet() { test "$(curls)" = "" && untouched; }
at_tag() { test "$(head_commit)" = "$(git -C "$W/seed" rev-parse "v$1")" -a "$(cver)" = "$1"; }

# ── the helper: the daily check and the Päivitä button ──────────────────────
t_latest_only_without_key() {
  local key
  for key in "" "TALOUS_PRERELEASE=no"; do
    world; release 0.2.0; prerelease 0.3.0
    list "$(rel v0.3.0 false true)" "$(rel v0.2.0 false false)"
    [[ -z $key ]] || setenv "$key"
    check "latest (${key:-no key}): the check offers the release GitHub calls the latest" test "$(offered)" = 0.2.0
    check "latest (${key:-no key}): one call, to /releases/latest and no other" test "$(curls)" = "curl $API/latest"
    poll update; tick
    check "latest (${key:-no key}): the Päivitä button installs 0.2.0, not the newer tag" at_tag 0.2.0
    check "latest (${key:-no key}): the pre-release's image was not pulled" test "$(n_calls "^docker pull $REG:0.3.0")" = 0
  done
  # a lower release than the pre-release in the repository: the tags say 0.3.0, GitHub says 0.2.0, and nothing is on offer to 0.2.0
  world; release 0.2.0; prerelease 0.3.0; echo 0.2.0 >"$S/cver"
  check "latest: running the latest release, nothing is on offer though a newer tag exists" test "$(offered)" = 0.2.0
  check "latest: and the page is told so" test "$(jq -r .update_available "$S/state.last")" = false
}
t_prerelease_newest() {
  world; release 0.2.0; prerelease 0.3.0; setenv TALOUS_PRERELEASE=yes
  list "$(rel v0.3.0 false true 'Third \"quoted\" {braces} [x]\nline two')" "$(rel v0.2.0 false false)"
  check "newest: the check offers the pre-release" test "$(offered)" = 0.3.0
  check "newest: one call, to the list of 20, and /releases/latest was not asked" test "$(curls)" = "curl $API?per_page=20"
  check "newest: the notes are the pre-release's own, unescaped" test "$(jq -r .release_notes "$S/state.last")" = $'Third "quoted" {braces} [x]\nline two'
  poll update; tick
  check "newest: the Päivitä button installs the pre-release" at_tag 0.3.0
  check "newest: and the page then has nothing on offer" test "$(offered)" = 0.3.0 -a "$(jq -r .update_available "$S/state.last")" = false
  # the order is by number, not by text or by position in the list
  list "$(rel v0.9.0 false true)" "$(rel v0.10.0 false true)" "$(rel v0.2.0 false false)" "$(rel v0.9.12 false true)"
  check "newest: 0.10.0 is above 0.9.12 and 0.9.0 wherever it stands in the list" test "$(offered)" = 0.10.0
  list "$(rel v0.2.0 false false)" "$(rel v0.3.0 false true)"
  check "newest: the highest, not the first or the last" test "$(offered)" = 0.3.0
  list "$(rel v0.2.0 false false)"
  check "newest: with no pre-release waiting it is the latest release" test "$(offered)" = 0.2.0
}
t_prerelease_draft_ignored() {
  world; release 0.2.0; prerelease 0.3.0; prerelease 0.4.0; setenv TALOUS_PRERELEASE=yes
  list "$(rel v0.4.0 true false)" "$(rel v0.3.0 false true)" "$(rel v0.2.0 false false)"
  check "draft: the newest release is a draft that is held back, so 0.3.0 is on offer" test "$(offered)" = 0.3.0
  poll update; tick
  check "draft: the button installs 0.3.0 though the tag v0.4.0 is in the repository" at_tag 0.3.0
  check "draft: the draft's image was not pulled" test "$(n_calls "^docker pull $REG:0.4.0")" = 0
  list "$(rel v0.4.0 true false)" "$(rel v0.4.1 true true)"
  check "draft: only drafts: no release counts, the check fails" test "$(offered)" = ""
  poll check-update "$ID2"; tick
  check "draft: and it says so" reported failed
}
t_prerelease_bad_tag_ignored() {
  world; release 0.2.0; prerelease 0.3.0; setenv TALOUS_PRERELEASE=yes
  list "$(rel v0.5 false true)" "$(rel v1.0.0-rc1 false true)" "$(rel nightly false true)" "$(rel v0.4.0.1 false true)" "$(rel V0.4.0 false true)" \
    "$(rel v0.3.0 false true)" "$(rel v0.2.0 false false)"
  check "bad tag: only a tag of the form vX.Y.Z counts" test "$(offered)" = 0.3.0
  poll update; tick
  check "bad tag: and the button installs it" at_tag 0.3.0
  list "$(rel v0.5 false true)" "$(rel nightly false false)"
  check "bad tag: a list with nothing but such tags offers nothing" test "$(offered)" = ""
  poll check-update "$ID2"; tick
  check "bad tag: and the check fails, it does not fall to the source" reported failed
  # the latest answer is held to the same form, and to not being a pre-release
  rm -f "$CL/.env"; printf '{"tag_name": "main", "prerelease": false}\n' >"$S/release.json"
  check "bad tag: /releases/latest naming main offers nothing" test "$(offered)" = ""
  printf '{"tag_name": "v0.4.0", "prerelease": true}\n' >"$S/release.json"
  check "bad tag: /releases/latest naming a pre-release offers nothing, GitHub never does that" test "$(offered)" = ""
}
t_prerelease_none_yet() {
  # no release at all: an empty list, or a 404 for the latest. The install follows the source, as an install before the first release does.
  world; setenv TALOUS_PRERELEASE=yes; src_commit; printf '[]\n' >"$S/list.json"
  check "none yet: an empty list is no release, not an error" test "$(offered)" = "" -a "$(jq -r '.behind_commits | length' "$S/state.last")" = 1
  world; src_commit; echo 404 >"$S/release.status"
  check "none yet: a 404 for the latest is the same" test "$(offered)" = "" -a "$(jq -r '.behind_commits | length' "$S/state.last")" = 1
  world; setenv TALOUS_PRERELEASE=yes; src_commit; printf '[]\n' >"$S/list.json"
  by_hand
  check "none yet: update.sh by hand builds the source" bash -c "[[ $RC == 0 && \$1 == *'Source: '* ]]" x "$OUT"
  check "none yet: and asked the list once" test "$(curls)" = "curl $API?per_page=20"
}

# ── update.sh run by hand ───────────────────────────────────────────────────
t_update_manual_follows_api() {
  check "by hand: update.sh no longer reads the newest git tag" bash -c "! grep -q 'latest_release' '$SRC/scripts/update.sh'"
  world; release 0.2.0; prerelease 0.3.0
  list "$(rel v0.3.0 false true)" "$(rel v0.2.0 false false)"
  by_hand
  check "by hand: installs the release GitHub names, though v0.3.0 is the newest tag" bash -c "[[ $RC == 0 && \$1 == *'Channel: release v0.2.0'* ]]" x "$OUT"
  check "by hand: it is at v0.2.0" at_tag 0.2.0
  check "by hand: one call, to /releases/latest" test "$(curls)" = "curl $API/latest"
  world; release 0.2.0; prerelease 0.3.0; setenv TALOUS_PRERELEASE=yes
  list "$(rel v0.3.0 false true)" "$(rel v0.2.0 false false)"
  by_hand
  check "by hand, key yes: installs the newest release" bash -c "[[ $RC == 0 && \$1 == *'Channel: release v0.3.0'* ]]" x "$OUT"
  check "by hand, key yes: it is at v0.3.0" at_tag 0.3.0
  check "by hand, key yes: one call, to the list" test "$(curls)" = "curl $API?per_page=20"
  world; release 0.2.0; prerelease 0.3.0; setenv TALOUS_PRERELEASE=no
  by_hand
  check "by hand, key no: as without the key" at_tag 0.2.0
  # the source channel and a release the helper named ask nothing
  world; release 0.2.0; setenv TALOUS_CHANNEL=source; src_commit; by_hand
  check "by hand, source: GitHub is not asked" test "$(curls)" = ""
  world; release 0.2.0; prerelease 0.3.0; by_hand TALOUS_RELEASE=v0.3.0
  check "by hand, TALOUS_RELEASE: the named release is taken and GitHub is not asked" bash -c "[[ \$1 == *'Channel: release v0.3.0'* ]]" x "$OUT"
  check "by hand, TALOUS_RELEASE: no call" test "$(curls)" = ""
  # a release that GitHub names and the folder does not have
  world; release 0.2.0; printf '{\n  "tag_name": "v0.9.0",\n  "body": "x"\n}\n' >"$S/release.json"; by_hand
  check "by hand: a release the folder has no tag for stops the run" bash -c "[[ $RC != 0 && \$1 == *'Release v0.9.0 is not in this folder. Nothing was changed.'* ]]" x "$OUT"
  check "by hand: and nothing was changed" untouched
}
t_update_api_down_changes_nothing() {
  local answer code body key all='503| 403| 000| 200|<html>no</html> 200| 200|{"tag_name":"main"}'
  # v0.3.0 is the newest tag and an install that fell back to the tags would take it. An empty list is "no release yet" in
  # the newest mode only (the source, as before the first release): for /releases/latest it is no answer.
  for key in "" "TALOUS_PRERELEASE=yes"; do
    for answer in $all '200|[]' '200|{"tag_name":"v0.3.0","prerelease":true}'; do
      code=${answer%%|*}; body=${answer#*|}
      [[ $key == *yes && ( $body == '[]' || $body == *prerelease* ) ]] && continue
      world; release 0.2.0; prerelease 0.3.0; [[ -z $key ]] || setenv "$key"
      echo "$code" >"$S/release.status"; echo "$code" >"$S/list.status"; printf '%s\n' "$body" >"$S/release.json"; printf '%s\n' "$body" >"$S/list.json"
      by_hand
      check "api down (${key:-no key}, $code ${body:0:22}): update.sh stops and says so" bash -c "[[ $RC != 0 && \$1 == *'Could not ask GitHub for the latest release. Nothing was changed.'* ]]" x "$OUT"
      check "api down (${key:-no key}, $code ${body:0:22}): nothing was pulled, built, tagged or started" untouched
      check "api down (${key:-no key}, $code ${body:0:22}): the checkout and the running version are as they were" test "$(head_commit)" = "$C1" -a "$(cver)" = 0.1.0
    done
  done
}

# ── an install on a pre-release the key no longer follows ───────────────────
# 0.2.0 is the latest release, 0.3.0 a pre-release that was installed under TALOUS_PRERELEASE=yes, the key is gone and 0.4.0 is
# a pre-release on main. The checkout is at v0.3.0, above the release GitHub names: it stays, says so and builds nothing.
t_stays_on_prerelease() {
  local setting
  for setting in "" TALOUS_CHANNEL=release; do
    world; release 0.2.0; prerelease 0.3.0; setenv TALOUS_PRERELEASE=yes
    list "$(rel v0.3.0 false true)" "$(rel v0.2.0 false false)"
    poll update; tick
    setenv "$setting"; prerelease 0.4.0
    by_hand
    check "stays (${setting:-no channel}): says it is on v0.3.0, newer than the latest release, and names the key" bash -c "[[ $RC == 0 && \$1 == *'Already on v0.3.0, newer than the latest release (v0.2.0).'* && \$1 == *'TALOUS_PRERELEASE=yes in .env follows releases during their first two days.'* ]]" x "$OUT"
    check "stays (${setting:-no channel}): no word of the source channel, no channel chosen" bash -c '[[ $1 != *"ource"* && $1 != *"Channel:"* ]]' x "$OUT"
    check "stays (${setting:-no channel}): GitHub was asked once, for the latest" test "$(curls)" = "curl $API/latest"
    check "stays (${setting:-no channel}): nothing was pulled, built, tagged or started" untouched
    check "stays (${setting:-no channel}): the checkout and the running version are still 0.3.0" at_tag 0.3.0
  done
  # the key is on, so the newest release is followed, and v0.4.0 is a draft that is held back: no advice about the key
  world; release 0.2.0; prerelease 0.3.0; prerelease 0.4.0; setenv TALOUS_PRERELEASE=yes
  list "$(rel v0.4.0 false true)" "$(rel v0.3.0 false true)" "$(rel v0.2.0 false false)"
  poll update; tick
  list "$(rel v0.4.0 true false)" "$(rel v0.3.0 false true)" "$(rel v0.2.0 false false)"
  by_hand
  check "stays, key yes: on a held v0.4.0 it says so, without advice about the key" bash -c "[[ $RC == 0 && \$1 == *'Already on v0.4.0, newer than the newest release (v0.3.0). Nothing was changed.'* && \$1 != *'follows releases'* ]]" x "$OUT"
  check "stays, key yes: and changes nothing" test "$(n_calls '^docker (pull|image tag|compose (up|build))')" = 0 -a "$(cver)" = 0.4.0
  # a checkout at no release tag keeps the source: its own commits ahead of the latest release
  world; release 0.2.0; src_commit; git -C "$CL" pull -q 2>/dev/null; by_hand
  check "source kept: a checkout at no release tag, ahead of the latest release, builds the source" bash -c "[[ $RC == 0 && \$1 != *'Already on'* && \$1 != *'Channel: release'* ]]" x "$OUT"
  check "source kept: the image was built here, none was pulled" test "$(n_calls '^docker compose build')" -ge 1 -a "$(n_calls '^docker pull')" = 0
}
# "no release" from GitHub (404, or an empty list) while the folder holds release tags is no answer: it is not the source channel
t_no_release_with_tags_is_no_answer() {
  local mode
  for mode in "" TALOUS_PRERELEASE=yes; do
    world; release 0.2.0; [[ -z $mode ]] || setenv "$mode"
    if [[ -z $mode ]]; then echo 404 >"$S/release.status"; else printf '[]\n' >"$S/list.json"; fi
    check "no release, no tag here (${mode:-no key}): the source channel, as before the first release" test "$(offered)" = "" -a "$(jq -r '.behind_commits | length' "$S/state.last")" = 1
    git -C "$CL" fetch -q --tags 2>/dev/null
    check "no release, a release tag here (${mode:-no key}): the check offers nothing, not even the source" test "$(offered)" = "" -a "$(jq -r '.behind_commits | length' "$S/state.last")" = 0
    poll check-update "$ID2"; tick
    check "no release, a release tag here (${mode:-no key}): the check fails as for an API error" reported failed
    by_hand
    check "no release, a release tag here (${mode:-no key}): update.sh stops and says it could not ask" bash -c "[[ $RC != 0 && \$1 == *'Could not ask GitHub for the latest release. Nothing was changed.'* ]]" x "$OUT"
    check "no release, a release tag here (${mode:-no key}): nothing was pulled, built, tagged or started" untouched
    check "no release, a release tag here (${mode:-no key}): the checkout and the running version are as they were" test "$(head_commit)" = "$C1" -a "$(cver)" = 0.1.0
  done
}

# ── the key ─────────────────────────────────────────────────────────────────
t_bad_key_value_refused() {
  local v
  world; release 0.2.0; list "$(rel v0.2.0 false false)"
  for v in maybe Yes YES true 1 '"yes"' 'yes ' ' no' 'yes,no'; do
    setenv "TALOUS_PRERELEASE=$v"
    : >"$S/calls.log"; tick
    check "bad key '$v': the helper does not run, and says why" bash -c "[[ $TICK_RC == 1 ]] && grep -q '\.env is invalid: TALOUS_PRERELEASE is invalid' '$W/tick.out'"
    check "bad key '$v': GitHub is not asked" test "$(curls)" = ""
    OUT=$(cd "$CL" && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/ops-helper.sh --self-test 2>&1)
    check "bad key '$v': the self-test fails with the same reason" test "$OUT" = "self-test failed: .env is invalid: TALOUS_PRERELEASE is invalid"
    by_hand
    check "bad key '$v': update.sh refuses" bash -c "[[ $RC != 0 && \$1 == *'TALOUS_PRERELEASE in .env is invalid. Allowed: yes, no. Nothing was changed.'* ]]" x "$OUT"
    check "bad key '$v': GitHub is not asked, nothing is pulled or started" quiet
    printf 'TALOUS_CHANNEL=source\nTALOUS_PRERELEASE=%s\n' "$v" >"$CL/.env"; by_hand
    check "bad key '$v': also on the source channel, where the key is not used" bash -c "[[ $RC != 0 && \$1 == *'TALOUS_PRERELEASE in .env is invalid'* ]]" x "$OUT"
  done
  setenv TALOUS_PRERELEASE=maybe; by_hand
  check "bad key: update.sh does not print the value" bash -c '[[ $1 != 0 && $2 != *maybe* ]]' x "$RC" "$OUT"
  for v in yes no; do
    setenv "TALOUS_PRERELEASE=$v"
    OUT=$(cd "$CL" && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/ops-helper.sh --self-test 2>&1)
    check "good key '$v': the self-test passes" test "$OUT" = "self-test ok"
  done
  setenv 'TALOUS_PRERELEASE='
  check "no value is the same as no key" test "$(offered)" = 0.2.0 -a "$(curls)" = "curl $API/latest"
}
t_address_is_fixed() {
  local mode
  for mode in "" "TALOUS_PRERELEASE=yes"; do
    world; release 0.2.0; list "$(rel v0.2.0 false false)"; [[ -z $mode ]] || setenv "$mode"
    by_hand OPS_TEST=1 RELEASES_API=https://example.fi/x API_URL=https://example.fi/y OPS_API_URL=https://example.fi/z TALOUS_API=https://example.fi/w GITHUB_API_URL=https://example.fi/v
    check "address (${mode:-no key}): update.sh asks the API of the project, whatever the environment says" test "$(curls | grep -vcE "^curl $API(/latest|\?per_page=20)\$")" = 0 -a "$(curls | wc -l)" = 1
    : >"$S/calls.log"; tick OPS_TEST=1 API_URL=https://example.fi/y TALOUS_API=https://example.fi/w
    check "address (${mode:-no key}): so does the helper" test "$(curls | grep -vcE "^curl $API(/latest|\?per_page=20)\$")" = 0 -a "$(curls | wc -l)" -ge 1
  done
}

# ── the schedule after a rollback ───────────────────────────────────────────
t_rollback_renews_helper() {
  local stale
  world; release 0.2.0; stale=$(printf '* * * * * cd %s && ./scripts/ops-helper.sh >/dev/null 2>&1 # talous-ops:banking-app\n' "$CL")
  printf '%s\n' "$stale" >"$S/crontab"
  poll update; tick
  printf '%s\n' "$stale" >"$S/crontab"
  poll rollback "$ID2"; tick
  check "rollback: the previous version is back" test "$(cver)" = 0.1.0
  check "rollback: the helper's schedule is renewed as after an update" grep -q 'Maintenance helper renewed' "$S/reports/2.json"
  check "rollback: the stale line was replaced by the launcher's, one line for this instance" bash -c "[[ \$(grep -c '# talous-ops:banking-app\$' '$S/crontab') = 1 ]] && grep -q ' $W/home/.local/share/omatalous/banking-app/launcher.sh $CL >/dev/null' '$S/crontab'"
  # by hand: the schedule is renewed after the previous version answers, and before the line that says it runs
  world; release 0.2.0; by_hand
  printf '%s\n' "$stale" >"$S/crontab"; rolled_back
  check "rollback by hand: renewed" test "$RC" = 0 -a -n "$(in_out 'Maintenance helper renewed')"
  check "rollback by hand: after the previous version was started" test "$(grep -n '^docker compose up' "$S/calls.log" | tail -1 | cut -d: -f1)" -gt 0 -a "$(in_out 'Maintenance helper renewed')" -lt "$(in_out 'Running: ')"
  # an install without the helper's schedule is not given one
  world; release 0.2.0; by_hand; rolled_back
  check "rollback: an install that left the helper out stays without" bash -c "[[ $RC == 0 && ! -e '$S/crontab' && \$1 != *'Maintenance helper renewed'* ]]" x "$OUT"
  # a previous version that does not start: the rollback fails and the schedule is left alone
  world; release 0.2.0; by_hand; printf '%s\n' "$stale" >"$S/crontab"; touch "$S/bad_0.1.0"; rolled_back
  check "rollback: a previous version that does not start fails the rollback and renews nothing" bash -c "[[ $RC != 0 && \$1 != *'Maintenance helper renewed'* ]] && [[ \$(cat '$S/crontab') == \$2 ]]" x "$OUT" "$stale"
}

# ── the switch on the maintenance page: the requests prerelease-on and prerelease-off ──
# 0.2.0 is the latest release and 0.3.0 a pre-release, so the check that follows a write tells which one is on offer.
switch_world() { world; release 0.2.0; prerelease 0.3.0; list "$(rel v0.3.0 false true)" "$(rel v0.2.0 false false)"; }
# One request of the switch. ENV is a printf format, so a last line can lack its newline. The file as it was before the
# tick is env.before, the report is REP.
# shellcheck disable=SC2059
flip() { # flip on|off [ENV]
  [[ $# -lt 2 ]] || { printf "$2" >"$CL/.env"; chmod 600 "$CL/.env"; }
  cp -p "$CL/.env" "$W/env.before"; rm -f "$S/reports"/* "$CL/ops/journal"/*; : >"$S/calls.log"
  poll "prerelease-$1"; tick; REP=$(report)
}
# shellcheck disable=SC2059
env_is() { printf "$1" | cmp -s - "$CL/.env"; } # .env to the byte
env_kept() { cmp -s "$CL/.env" "$W/env.before" && [[ ! -e $CL/.env.new && ! -L $CL/.env.new ]]; } # as before the tick, and no .env.new
said() { jq -r "$1" <<<"$REP" 2>/dev/null; } # a field of the report

t_switch_changes_one_line() {
  switch_world
  flip on 'HOST_PORT=8081\n# a note\n'
  check "on, no key: the line is added last and the rest is as it was" env_is 'HOST_PORT=8081\n# a note\nTALOUS_PRERELEASE=yes\n'
  check "on: reported ok, with the position and the channel" test "$(said '.status + " " + .state.prerelease + " " + .state.channel')" = "ok yes release"
  check "on: the check that follows asks for the newest and offers the pre-release" bash -c "[[ \$1 == 0.3.0 && \$2 == 'curl $API?per_page=20' ]]" x "$(said .state.latest_version)" "$(curls)"
  check "on: the summary says what is offered now" test "$(said .summary)" = "Uudet versiot tarjotaan heti. Uusi versio on saatavilla."
  flip off
  check "off from yes: the line changes where it stood" env_is 'HOST_PORT=8081\n# a note\nTALOUS_PRERELEASE=no\n'
  check "off: reported, and the check asks /releases/latest alone and offers the release" bash -c "[[ \$1 == 'ok no 0.2.0' && \$2 == 'curl $API/latest' ]]" x "$(said '.status + " " + .state.prerelease + " " + .state.latest_version')" "$(curls)"
  flip on 'A=1\nTALOUS_PRERELEASE=no\nB=2\n'
  check "on from no: the line changes in its place" env_is 'A=1\nTALOUS_PRERELEASE=yes\nB=2\n'
  flip off 'TALOUS_PRERELEASE=yes\nA=1\nTALOUS_PRERELEASE=yes\nB=2\n'
  check "the key twice: once in the result, where the last one stood" env_is 'A=1\nTALOUS_PRERELEASE=no\nB=2\n'
  flip on '# keep  this\n\nA=1 # x\nTALOUS_PRERELEASE=no\nLAST=1'
  check "a comment, an empty line and no final newline: every other byte stays" env_is '# keep  this\n\nA=1 # x\nTALOUS_PRERELEASE=yes\nLAST=1'
  flip on 'A=1\nTALOUS_PRERELEASE=no'
  check "the key on a last line without a newline: still without one" env_is 'A=1\nTALOUS_PRERELEASE=yes'
  flip on 'A=1\n# end'
  check "no key and no final newline: the key gets a line of its own" env_is 'A=1\n# end\nTALOUS_PRERELEASE=yes\n'
  check "no .env.new is left after any of them" test ! -e "$CL/.env.new"
}
t_switch_keeps_the_file() {
  local ino
  switch_world
  printf 'A=1\n' >"$CL/.env"; chmod 640 "$CL/.env"; flip on
  check "the mode of .env is kept" test "$(stat -c %a "$CL/.env")" = 640
  ino=$(stat -c %i "$CL/.env"); flip on
  check "a file that says so already is not rewritten, and the request is ok" bash -c "[[ \$1 == '$ino' && \$2 == 'ok yes' ]]" x "$(stat -c %i "$CL/.env")" "$(said '.status + " " + .state.prerelease')"
  echo keep >"$W/victim"; ln -s "$W/victim" "$CL/.env.new"; flip off 'TALOUS_PRERELEASE=yes\n'
  check "a link left as .env.new: its target is not written and the link is gone" bash -c "[[ \$(cat '$W/victim') == keep && ! -e '$CL/.env.new' && ! -L '$CL/.env.new' ]]"
  check "and the setting is saved" env_is 'TALOUS_PRERELEASE=no\n'
  printf '#!/bin/sh\nexit 1\n' >"$S/bin/chown"; chmod +x "$S/bin/chown"; flip on 'A=1\n'; rm -f "$S/bin/chown"
  check "a write that fails half way: reported failed with the reason" test "$(said '.status + " " + .state.prerelease + " " + .summary')" = "failed no Tiedostoa .env ei voitu kirjoittaa. Mitään ei muutettu."
  check "and .env is as it was, with no .env.new" env_kept
  echo 500 >"$S/list.status"; touch "$CL/ops/last-check"; flip on 'A=1\n'
  check "no answer to the check after the write: the setting stands and the summary says both" test "$(said '.status + " " + .summary')" = "ok Uudet versiot tarjotaan heti. Uutta versiota ei voitu tarkistaa."
  check "and the daily check is due again" bash -c "[[ ! -e '$CL/ops/last-check' ]] && grep -qx 'TALOUS_PRERELEASE=yes' '$CL/.env'"
}
t_switch_refusals() {
  local bad
  switch_world
  # a .env the helper refuses stops the tick before the poll: the request is not picked up, so there is no report either
  for bad in 'a key that redirects Docker|TALOUS_PRERELEASE=no\nDOCKER_HOST=tcp://198.51.100.7:2375\n' 'a CR at the line end|TALOUS_PRERELEASE=no\r\n' 'a value that is not yes or no|TALOUS_PRERELEASE=maybe\n'; do
    flip on "${bad#*|}"
    check "a .env the helper refuses (${bad%%|*}): nothing is run or reported" bash -c "[[ $TICK_RC != 0 && -z \$1 && \$(grep -c . '$S/calls.log') == 0 ]]" x "$REP"
    check "and the file is as it was" env_kept
  done
  flip on 'TALOUS_CHANNEL=source\n'
  check "a source install: refused with the reason, and the page is told the channel" bash -c "[[ \$1 == 'failed source' && \$2 == *lähdekoodista* && -z \$3 ]]" x "$(said '.status + " " + .state.channel')" "$(said .summary)" "$(curls)"
  check "and nothing is written" env_kept
  exec 9<"$CL"; flock -n 9; flip on 'A=1\n'; exec 9<&-
  check "an install or an update holds the lock: refused with the reason" bash -c "[[ \$1 == failed && \$2 == *'asennus tai päivitys kesken'* ]]" x "$(said .status)" "$(said .summary)"
  check "and nothing is written" env_kept
}
t_switch_says_done_only_when_the_host_reads_it() {
  switch_world
  # grep reads nothing from a file with a NUL byte in it, so the daily check would not see the line the switch wrote
  flip on 'A=1\n# x\0y\n'
  check "a .env the daily check cannot read: reported failed with the reason, and the position stays off" test "$(said '.status + " " + .state.prerelease + " " + .summary')" = "failed no Asetus kirjoitettiin tiedostoon .env, mutta apuri ei saa sitä sieltä luettua. Tarkista tiedosto palvelimella."
  check "and no check for a new version was made" test -z "$(curls)"
}
t_switch_asks_the_file_again_before_the_write() {
  switch_world
  # the docker stub answers the poll, and a line the helper refuses appears in .env as it does
  mv "$S/bin/docker" "$S/bin/docker.real"
  printf '#!/usr/bin/env bash\n[[ $* == *"ops poll"* ]] && echo DOCKER_HOST=tcp://198.51.100.7:2375 >>"%s"\nexec "$OPS_STUB_DIR/bin/docker.real" "$@"\n' "$CL/.env" >"$S/bin/docker"
  chmod +x "$S/bin/docker"; flip on 'A=1\n'
  check "a .env that turned invalid after the poll: reported failed with the reason" test "$(said '.status + " " + .summary')" = "failed Tiedosto .env ei ole kelvollinen. Mitään ei muutettu."
  check "and the setting is not written" env_is 'A=1\nDOCKER_HOST=tcp://198.51.100.7:2375\n'
}
t_switch_position_reaches_the_page() {
  switch_world; setenv 'TALOUS_PRERELEASE=yes'
  rm -f "$S/state.last"; tick
  check "a snapshot tells the position and the channel" test "$(jq -r '.prerelease + " " + .channel' "$S/state.last")" = "yes release"
  rm -f "$S/state.last"; tick
  check "the tick after it sends none" test ! -e "$S/state.last"
  # what an older helper left as its mark of the boot names no helper version
  cat /proc/sys/kernel/random/boot_id >"$CL/ops/boot_id" 2>/dev/null || echo none >"$CL/ops/boot_id"; tick
  check "the first tick of a renewed helper sends one, so the switch shows at once" test "$(jq -r .prerelease "$S/state.last" 2>/dev/null)" = yes
  rm -f "$CL/.env" "$CL/ops/boot_id" "$S/state.last"; tick
  check "an install with no .env says its channel and no position, so the page has no switch" test "$(jq -r '(.prerelease // "none") + " " + .channel' "$S/state.last" 2>/dev/null)" = "none release"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
