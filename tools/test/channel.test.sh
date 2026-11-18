#!/usr/bin/env bash
# Tests for which release an install follows: scripts/lib/release.sh (release_pick, release_from_api,
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
# The world's curl answers /releases/latest from release.json and release.status. This one answers any other address with
# no answer, so a call to the list of releases fails the run.
api_stub() {
  cat >"$S/bin/curl" <<'EOF'
#!/usr/bin/env bash
S=$OPS_STUB_DIR; out=""; url=""
while (($#)); do case $1 in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done
printf 'curl %s\n' "$url" >>"$S/calls.log"
case $url in
  https://api.github.com/repos/jouni-mikkola/omatalous/releases/latest) f=release ;;
  *) printf 000; exit 1 ;;
esac
code=$(cat "$S/$f.status" 2>/dev/null || echo 200)
[[ $code != 200 ]] || cp "$S/$f.json" "$out"
printf '%s' "$code"
EOF
  chmod +x "$S/bin/curl"
}
# a release in the repository and the registry that /releases/latest does not name: GitHub holds it back as a pre-release
prerelease() { local keep; keep=$(cat "$S/release.json"); release "$1"; printf '%s\n' "$keep" >"$S/release.json"; }
world() { new_world; api_stub; }
# the version a fresh daily check offers, as the heartbeat tells the page
offered() { rm -f "$S/state.last" "$CL/ops/boot_id" "$CL/ops/last-check" "$CL/ops/check.frag"; : >"$S/calls.log"; tick; jq -r '.latest_version // empty' "$S/state.last" 2>/dev/null; }
# the next daily check over the frag the last one left, which offered() clears
recheck() { rm -f "$S/state.last" "$CL/ops/boot_id" "$CL/ops/last-check"; tick; }
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
# A TALOUS_PRERELEASE line that an older version wrote to .env is not read: whatever it says, the install asks for the latest.
t_latest_only() {
  local key
  for key in "" "TALOUS_PRERELEASE=no" "TALOUS_PRERELEASE=yes"; do
    world; release 0.2.0; prerelease 0.3.0
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
# Only the keys of the release itself count, not those of its author or its files; the notes come unescaped.
t_latest_notes_unescaped() {
  world; release 0.2.0
  printf '{\n  "author": {\n    "login": "someone",\n    "draft": true\n  },\n  "tag_name": "v0.2.0",\n  "draft": false,\n  "prerelease": false,\n  "assets": [\n    {\n      "name": "x.zip",\n      "tag_name": "v9.9.9",\n      "prerelease": true\n    }\n  ],\n  "body": "Second \\"quoted\\" {braces} [x]\\nline two"\n}\n' >"$S/release.json"
  check "notes: the check offers the release, not the tag of its file" test "$(offered)" = 0.2.0
  check "notes: one call, to /releases/latest" test "$(curls)" = "curl $API/latest"
  check "notes: they are the release's own, unescaped" test "$(jq -r .release_notes "$S/state.last")" = $'Second "quoted" {braces} [x]\nline two'
}
# The answer of /releases/latest is held to the form of a release: a tag vX.Y.Z that is no draft and no pre-release. GitHub
# sends no other, so this is a second lock.
t_latest_answer_held_to_the_form() {
  local answer n=0 id
  world; release 0.2.0; prerelease 0.3.0
  for answer in '{"tag_name": "main", "prerelease": false}' '{"tag_name": "v0.5", "prerelease": false}' \
    '{"tag_name": "v1.0.0-rc1", "prerelease": false}' '{"tag_name": "v0.4.0", "prerelease": true}' \
    '{"tag_name": "v0.4.0", "draft": true, "prerelease": false}' '{"tag_name": "v0.4.0", "draft": true, "prerelease": true}'; do
    n=$((n + 1)); printf -v id 'op_%016x' "$n"
    printf '%s\n' "$answer" >"$S/release.json"
    check "latest answer $answer: nothing is offered" test "$(offered)" = ""
    poll check-update "$id"; tick
    check "latest answer $answer: the check fails, it does not fall to the source" reported failed
  done
}
t_none_yet() {
  # no release at all: a 404 for the latest. The install follows the source, as an install before the first release does.
  world; src_commit; echo 404 >"$S/release.status"
  check "none yet: a 404 for the latest is no release, not an error" test "$(offered)" = "" -a "$(jq -r '.behind_commits | length' "$S/state.last")" = 1
  world; setenv TALOUS_PRERELEASE=yes; src_commit; echo 404 >"$S/release.status"
  by_hand
  check "none yet: update.sh by hand builds the source" bash -c "[[ $RC == 0 && \$1 == *'Source: '* ]]" x "$OUT"
  check "none yet: and asked /releases/latest once" test "$(curls)" = "curl $API/latest"
}

# ── update.sh run by hand ───────────────────────────────────────────────────
t_update_manual_follows_api() {
  check "by hand: update.sh no longer reads the newest git tag" bash -c "! grep -q 'latest_release' '$SRC/scripts/update.sh'"
  world; release 0.2.0; prerelease 0.3.0
  by_hand
  check "by hand: installs the release GitHub names, though v0.3.0 is the newest tag" bash -c "[[ $RC == 0 && \$1 == *'Channel: release v0.2.0'* ]]" x "$OUT"
  check "by hand: it is at v0.2.0" at_tag 0.2.0
  check "by hand: one call, to /releases/latest" test "$(curls)" = "curl $API/latest"
  world; release 0.2.0; prerelease 0.3.0; setenv TALOUS_PRERELEASE=yes
  by_hand
  check "by hand, key yes: not read, installs the latest release" bash -c "[[ $RC == 0 && \$1 == *'Channel: release v0.2.0'* ]]" x "$OUT"
  check "by hand, key yes: it is at v0.2.0" at_tag 0.2.0
  check "by hand, key yes: one call, to /releases/latest" test "$(curls)" = "curl $API/latest"
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
  local answer code body key all='503| 000| 200|<html>no</html> 200| 200|{"tag_name":"main"}'
  # v0.3.0 is the newest tag and an install that fell back to the tags would take it. An empty list and a pre-release are no
  # answer for /releases/latest either.
  for key in "" "TALOUS_PRERELEASE=yes"; do
    for answer in $all '200|[]' '200|{"tag_name":"v0.3.0","prerelease":true}'; do
      code=${answer%%|*}; body=${answer#*|}
      world; release 0.2.0; prerelease 0.3.0; [[ -z $key ]] || setenv "$key"
      echo "$code" >"$S/release.status"; printf '%s\n' "$body" >"$S/release.json"
      by_hand
      check "api down (${key:-no key}, $code ${body:0:22}): update.sh stops and says so" bash -c "[[ $RC != 0 && \$1 == *'Could not ask GitHub for the latest release. Nothing was changed.'* ]]" x "$OUT"
      check "api down (${key:-no key}, $code ${body:0:22}): nothing was pulled, built, tagged or started" untouched
      check "api down (${key:-no key}, $code ${body:0:22}): the checkout and the running version are as they were" test "$(head_commit)" = "$C1" -a "$(cver)" = 0.1.0
    done
  done
}

# GitHub says 403 or 429 when the limit of requests is met (60 an hour for an address without a key): the run says so, and that an
# hour's wait cures it. Another error (a 502) keeps the plain words, so the hint is not given where it does not hold.
t_update_rate_limit_says_so() {
  local code key
  for key in "" "TALOUS_PRERELEASE=yes"; do
    for code in 403 429 502; do
      world; release 0.2.0; [[ -z $key ]] || setenv "$key"
      echo "$code" >"$S/release.status"
      by_hand
      if [[ $code == 502 ]]; then
        check "limit ($code, ${key:-no key}): another error keeps the plain words, with no word of the limit" bash -c "[[ $RC != 0 && \$1 == *'Could not ask GitHub for the latest release. Nothing was changed.'* && \$1 != *limit* && \$1 != *'an hour'* ]]" x "$OUT"
      else
        check "limit ($code, ${key:-no key}): update.sh says the limit of requests was met and that an hour's wait cures it" bash -c "[[ $RC != 0 && \$1 == *'GitHub turned the request down: the limit of requests for this address was met. Nothing was changed. Wait an hour and run this again.'* ]]" x "$OUT"
      fi
      check "limit ($code, ${key:-no key}): GitHub was asked once, with no second try" test "$(curls | wc -l)" = 1
      check "limit ($code, ${key:-no key}): nothing was pulled, built, tagged or started" untouched
      check "limit ($code, ${key:-no key}): the checkout and the running version are as they were" test "$(head_commit)" = "$C1" -a "$(cver)" = 0.1.0
    done
  done
  world; release 0.2.0; by_hand
  check "no limit: the same run goes through to 0.2.0" bash -c "[[ $RC == 0 && \$1 != *limit* ]]" x "$OUT"
}
# The image of the instance is tagged by the id the pull gave, not by the registry digest or tag, which another instance on the
# same Docker may remove first (image-tags.test.sh runs that race).
t_update_tags_by_image_id() {
  world; release 0.2.0; by_hand
  check "tag: the update went through" at_tag 0.2.0
  check "tag: banking-app:latest is made from the image's id" test "$(n_calls '^docker image tag id-0.2.0 banking-app:latest *$')" = 1
  check "tag: and no tag is made from the registry's tag or digest" test "$(n_calls '^docker image tag ghcr.io')" = 0
}

# ── an install on a pre-release of an earlier version ───────────────────────
# 0.2.0 is the latest release, 0.3.0 a pre-release that was installed before releases were published at once and 0.4.0 is
# a pre-release on main. The checkout is at v0.3.0, above the release GitHub names: it stays, says so and builds nothing.
# The folder sits at the release tag of VERSION, as after an update made while that was the newest release.
sit_at() { git -C "$CL" fetch -q --tags origin 2>/dev/null; git -C "$CL" checkout -q "v$1"; echo "$1" >"$S/cver"; }
t_stays_on_prerelease() {
  local setting
  for setting in "" TALOUS_CHANNEL=release; do
    world; release 0.2.0; prerelease 0.3.0; sit_at 0.3.0
    setenv "$setting"; prerelease 0.4.0
    by_hand
    check "stays (${setting:-no channel}): says it is on v0.3.0, newer than the latest release" bash -c "[[ $RC == 0 && \$1 == *'Already on v0.3.0, newer than the latest release (v0.2.0). Nothing was changed.'* && \$1 != *TALOUS_PRERELEASE* ]]" x "$OUT"
    check "stays (${setting:-no channel}): no word of the source channel, no channel chosen" bash -c '[[ $1 != *"ource"* && $1 != *"Channel:"* ]]' x "$OUT"
    check "stays (${setting:-no channel}): GitHub was asked once, for the latest" test "$(curls)" = "curl $API/latest"
    check "stays (${setting:-no channel}): nothing was pulled, built, tagged or started" untouched
    check "stays (${setting:-no channel}): the checkout and the running version are still 0.3.0" at_tag 0.3.0
  done
  # a checkout at no release tag keeps the source: its own commits ahead of the latest release
  world; release 0.2.0; src_commit; git -C "$CL" pull -q 2>/dev/null; by_hand
  check "source kept: a checkout at no release tag, ahead of the latest release, builds the source" bash -c "[[ $RC == 0 && \$1 != *'Already on'* && \$1 != *'Channel: release'* ]]" x "$OUT"
  check "source kept: the image was built here, none was pulled" test "$(n_calls '^docker compose build')" -ge 1 -a "$(n_calls '^docker pull')" = 0
}
# a check writes the whole frag: the release of a release answer is not carried into a source answer, nor the commits of a
# source answer into a release one, whichever comes after the other
t_check_frag_replaces_the_answer_before() {
  world; release 0.2.0
  check "frag: a release check names the release" test "$(offered)" = 0.2.0 -a "$(jq -r '.behind_commits // "none"' "$S/state.last")" = none
  setenv TALOUS_CHANNEL=source; src_commit; recheck
  check "frag: the source check after it carries no release" test "$(jq -r '.latest_version // "none"' "$S/state.last")" = none -a "$(grep -c latest_version "$CL/ops/check.frag")" = 0
  check "frag: it offers the commits" test "$(jq -r .update_available "$S/state.last")" = true -a "$(jq -r '.behind_commits | length' "$S/state.last")" -ge 1
  : >"$CL/.env"; recheck
  check "frag: the release check after it carries no commits" test "$(jq -r .latest_version "$S/state.last")" = 0.2.0 -a "$(jq -r '.behind_commits // "none"' "$S/state.last")" = none
}
# "no release" from GitHub (a 404) while the folder holds release tags is no answer: it is not the source channel
t_no_release_with_tags_is_no_answer() {
  local mode
  for mode in "" TALOUS_PRERELEASE=yes; do
    world; release 0.2.0; [[ -z $mode ]] || setenv "$mode"
    echo 404 >"$S/release.status"
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
# The TALOUS_PRERELEASE line of an earlier version is not read: whatever it says, the helper and update.sh run as without it
# and ask for the latest release.
t_old_key_value_is_ignored() {
  local v
  for v in yes no maybe Yes 1 '"yes"' 'yes ' ' no' ''; do
    world; release 0.2.0; prerelease 0.3.0; setenv "TALOUS_PRERELEASE=$v"
    check "old key '$v': the check offers the latest release, from /releases/latest alone" test "$(offered)" = 0.2.0 -a "$(curls)" = "curl $API/latest"
    check "old key '$v': the helper runs" test "$TICK_RC" = 0
    OUT=$(cd "$CL" && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/ops-helper.sh --self-test 2>&1)
    check "old key '$v': the self-test passes" test "$OUT" = "self-test ok"
    by_hand
    check "old key '$v': update.sh installs the latest release with no complaint" bash -c "[[ $RC == 0 && \$1 == *'Channel: release v0.2.0'* && \$1 != *TALOUS_PRERELEASE* ]]" x "$OUT"
    check "old key '$v': it is at v0.2.0" at_tag 0.2.0
  done
}
t_address_is_fixed() {
  local mode
  for mode in "" "TALOUS_PRERELEASE=yes"; do
    world; release 0.2.0; [[ -z $mode ]] || setenv "$mode"
    by_hand OPS_TEST=1 RELEASES_API=https://example.fi/x API_URL=https://example.fi/y OPS_API_URL=https://example.fi/z TALOUS_API=https://example.fi/w GITHUB_API_URL=https://example.fi/v
    check "address (${mode:-no key}): update.sh asks the API of the project, whatever the environment says" test "$(curls | grep -vcE "^curl $API/latest\$")" = 0 -a "$(curls | wc -l)" = 1
    : >"$S/calls.log"; tick OPS_TEST=1 API_URL=https://example.fi/y TALOUS_API=https://example.fi/w
    check "address (${mode:-no key}): so does the helper" test "$(curls | grep -vcE "^curl $API/latest\$")" = 0 -a "$(curls | wc -l)" -ge 1
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

# ── the switch for pre-releases is gone: the requests prerelease-on and prerelease-off ──
# An old page may still queue one. The helper does not know the names, so the request ends as failed and .env stays as it was.
t_retired_switch_changes_nothing() {
  local a n=0 id
  world; release 0.2.0
  printf 'HOST_PORT=8081\nTALOUS_PRERELEASE=yes\n' >"$CL/.env"; chmod 600 "$CL/.env"; cp -p "$CL/.env" "$W/env.before"
  for a in prerelease-on prerelease-off; do
    n=$((n + 1)); printf -v id 'op_%016x' "$n"
    rm -f "$S/reports"/*; : >"$S/calls.log"
    poll "$a" "$id"; tick
    check "$a: reported failed as an unknown action" test "$(report | jq -r '.status + " " + .summary')" = "failed Tuntematon toiminto."
    check "$a: .env is as it was, with no .env.new" bash -c "cmp -s '$CL/.env' '$W/env.before' && [[ ! -e '$CL/.env.new' ]]"
    check "$a: GitHub was not asked" test "$(curls)" = ""
  done
}
# The snapshot the page reads has the channel and no position of a switch, whatever .env holds.
t_snapshot_has_no_switch_position() {
  world; release 0.2.0; setenv 'TALOUS_PRERELEASE=yes'
  rm -f "$S/state.last"; tick
  check "a snapshot tells the channel and no position of a switch" test "$(jq -r '(.prerelease // "none") + " " + .channel' "$S/state.last")" = "none release"
  rm -f "$S/state.last"; tick
  check "the tick after it sends none" test ! -e "$S/state.last"
  # what an older helper left as its mark of the boot names no helper version
  cat /proc/sys/kernel/random/boot_id >"$CL/ops/boot_id" 2>/dev/null || echo none >"$CL/ops/boot_id"; tick
  check "the first tick of a renewed helper sends one, still with no position" test "$(jq -r '(.prerelease // "none") + " " + .channel' "$S/state.last" 2>/dev/null)" = "none release"
}

# ── the private build (Dockerfile PRIVATE_BUILD, from TALOUS_PRIVATE_BUILD=yes in .env) ─
built_with() { calls | grep '^docker compose build' | tail -1 | grep -oE 'PRIVATE_BUILD=[a-z]+' || true; }
t_private_build_only_on_source_with_key() {
  local sum
  world; release 0.2.0; setenv TALOUS_CHANNEL=source; src_commit; sum=$(sha256sum <"$CL/.env"); by_hand
  check "private, no key: the source is built public" test "$RC" = 0 -a "$(built_with)" = PRIVATE_BUILD=false
  check "private, no key: .env is not written" test "$(sha256sum <"$CL/.env")" = "$sum"
  world; release 0.2.0; setenv TALOUS_CHANNEL=source TALOUS_PRIVATE_BUILD=yes; src_commit; by_hand
  check "private, key yes on source: the build gets PRIVATE_BUILD=true" test "$RC" = 0 -a "$(built_with)" = PRIVATE_BUILD=true
  world; release 0.2.0; setenv TALOUS_CHANNEL=source TALOUS_PRIVATE_BUILD=no; src_commit; by_hand
  check "private, key no: the build is public" test "$(built_with)" = PRIVATE_BUILD=false
  # the release channel pulls the signed public image: the key changes nothing there and says so
  world; release 0.2.0; setenv TALOUS_PRIVATE_BUILD=yes; sum=$(sha256sum <"$CL/.env"); by_hand
  check "private, key yes on release: the release image, nothing built" bash -c "[[ $RC == 0 && \$1 == *'read only on the source channel'* ]]" x "$OUT"
  check "private, key yes on release: nothing built, at the release, .env as it was" test "$(n_calls '^docker compose build')" = 0 -a "$(sha256sum <"$CL/.env")" = "$sum"
  check "private, key yes on release: at v0.2.0" at_tag 0.2.0
}
# the public repository holds the source, so a clone of it that asks for the source channel builds the newest main
t_source_builds_on_public_origin() {
  local url real
  for url in https://github.com/jouni-mikkola/omatalous.git git@github.com:jouni-mikkola/omatalous; do
    world; release 0.2.0; setenv TALOUS_CHANNEL=source; src_commit
    # The clone names the public repository as an install does. The world's git reads its own remote under that name
    # when it fetches, and still tells the name as it stands (`remote get-url` would print the rewritten one).
    real=$(git -C "$CL" remote get-url origin); git -C "$CL" remote set-url origin "$url"
    printf '#!/usr/bin/env bash\n[[ " $* " == *" get-url "* ]] && exec %q "$@"\nexec %q -c %q "$@"\n' "$(command -v git)" "$(command -v git)" "url.$real.insteadOf=$url" >"$S/bin/git"
    chmod +x "$S/bin/git"; by_hand
    check "public origin ($url): the folder names the public repository" test "$(git -C "$CL" remote get-url origin)" = "$url"
    check "public origin ($url): the source is built" test "$RC" = 0 -a "$(n_calls '^docker compose build')" -ge 1
    check "public origin ($url): the public build, no release image pulled" test "$(built_with)" = PRIVATE_BUILD=false -a "$(n_calls '^docker pull')" = 0
    check "public origin ($url): the folder is at the newest main" test "$(git -C "$CL" rev-parse HEAD)" = "$(git -C "$W/seed" rev-parse HEAD)"
  done
}
# back from the private build to the signed release (OWNER-SWITCH.md step 7): the folder at the release tag, no keys
t_private_build_back_to_release() {
  world; release 0.2.0; setenv TALOUS_CHANNEL=source TALOUS_PRIVATE_BUILD=yes; src_commit; by_hand
  check "back: first the private build" test "$(built_with)" = PRIVATE_BUILD=true
  git -C "$CL" reset -q --hard v0.2.0; setenv; by_hand
  check "back: the release image is pulled, nothing built" test "$RC" = 0 -a "$(n_calls '^docker pull')" -ge 1 -a "$(n_calls '^docker compose build')" = 0
  check "back: at v0.2.0, the image not private" test "$(cver)" = 0.2.0 -a "$(cut -d'|' -f4 "$S/images/banking-app_latest")" != true
}
# switching at the same commit is a whole update (a copy, :previous), so --rollback leads back to the other build
t_private_build_switch_same_commit() {
  world; release 0.2.0; setenv TALOUS_CHANNEL=source; src_commit; by_hand
  check "switch: first the public build" test "$(built_with)" = PRIVATE_BUILD=false
  setenv TALOUS_CHANNEL=source TALOUS_PRIVATE_BUILD=yes; by_hand
  check "switch on: the same commit is built again with PRIVATE_BUILD=true" bash -c "[[ $RC == 0 && \$1 == *'building the private build'* && \$1 != *'Already current'* ]]" x "$OUT"
  check "switch on: built private, after a copy, with the public image kept as :previous" test "$(built_with)" = PRIVATE_BUILD=true -a "$(n_calls '^SNAPSHOT')" -ge 1 -a "$(n_calls '^docker image tag .*:previous')" -ge 1
  by_hand
  check "switch on, run again: already current, nothing built" bash -c "[[ $RC == 0 && \$1 == *'Already current'* ]]" x "$OUT"
  check "switch on, run again: no build" test "$(n_calls '^docker compose build')" = 0
  rolled_back
  check "switch on, rollback: back to the public image of the same commit" test "$RC" = 0 -a "$(cut -d'|' -f4 "$S/images/banking-app_latest")" = false
  setenv TALOUS_CHANNEL=source TALOUS_PRIVATE_BUILD=yes; by_hand
  check "switch on again: built private" test "$(built_with)" = PRIVATE_BUILD=true
  setenv TALOUS_CHANNEL=source; by_hand
  check "switch off: the key gone, the public build again" bash -c "[[ $RC == 0 && \$1 == *'installing the public one'* ]]" x "$OUT"
  check "switch off: PRIVATE_BUILD=false" test "$(built_with)" = PRIVATE_BUILD=false
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
