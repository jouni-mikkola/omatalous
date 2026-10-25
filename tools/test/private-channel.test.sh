#!/usr/bin/env bash
# Tests for the private channel: scripts/use-private.sh (the deploy key, the remote `private`, --check, --back, the lock),
# update.sh on that channel (lib/release.sh pick_private) and the maintenance helper's check and update there
# (lib/ops-release.sh, ops-helper.sh act_update). The private repository is a bare repository on a root of its own beside
# the world's public one (tools/test/ops-world.sh), read over file:// (OPS_TEST=1): nothing here touches GitHub, SSH, a
# real container or a real registry.
#
#   tools/test/private-channel.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by ops-world.sh
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged private-channel.test.sh "$@"

# a world with a private repository whose history shares no commit with the public one, at version 0.5.0
world() {
  new_world
  git init -q --bare -b main "$W/private.git"
  mkdir -p "$W/pseed"; git -C "$W/pseed" init -q -b main
  (cd "$W/seed" && git ls-files -z | xargs -0 cp --parents -t "$W/pseed")
  echo 'export const APP_VERSION = "0.5.0";' >"$W/pseed/apps/server/src/version.ts"
  git -C "$W/pseed" add -A && git -C "$W/pseed" commit -qm "private 0.5.0"
  git -C "$W/pseed" push -q "file://$W/private.git" main 2>/dev/null
  PRIV=file://$W/private.git
}
priv_commit() { # a commit on the private main
  echo "p$RANDOM" >>"$W/pseed/CHANGES"
  git -C "$W/pseed" add -A; git -C "$W/pseed" commit -qm "private change $RANDOM"
  git -C "$W/pseed" push -q "file://$W/private.git" HEAD:main 2>/dev/null
}
priv_head() { git -C "$W/pseed" rev-parse HEAD; }
# use-private.sh in the clone as a person runs it: the output in OUT, the status in RC
up() {
  : >"$S/calls.log"
  OUT=$(cd "$CL" && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/use-private.sh "$@" </dev/null 2>&1); RC=$?
}
by_hand() {
  : >"$S/calls.log"
  OUT=$(cd "$CL" && env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/update.sh --yes </dev/null 2>&1); RC=$?
}
rolled_back() {
  : >"$S/calls.log"
  OUT=$(cd "$CL" && env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/update.sh --rollback --yes </dev/null 2>&1); RC=$?
}
has() { [[ $OUT == *"$1"* ]]; }
chan() { grep -E "^$1=" "$CL/ops/channel" 2>/dev/null | cut -d= -f2-; }
KEY_OF() { printf '%s/home/.config/omatalous/%s/deploy_key' "$W" "${1:-banking-app}"; }
mode() { stat -c %a "$1"; }
built_with() { calls | grep '^docker compose build' | tail -1 | grep -oE 'PRIVATE_BUILD=[a-z]+' || true; }
curls() { calls | grep '^curl ' || true; }
# the clone's state that the switch must leave alone: .env, the docker calls (volumes, containers), origin and the tags
fingerprint() { { sha256sum <"$CL/.env"; git -C "$CL" remote get-url origin; git -C "$CL" for-each-ref refs/tags refs/remotes/origin; } | sha256sum; }
switched() { up --repo "$PRIV" && up --check "$@"; }

# ── use-private.sh ──────────────────────────────────────────────────────────
t_key_made_once() {
  world; setenv INSTANCE_NAME=talous2 TZ=Europe/Helsinki
  local before key sum; before=$(fingerprint); key=$(KEY_OF talous2)
  up --repo "$PRIV"
  check "repo: ends well" test "$RC" = 0
  check "repo: the key is made under ~/.config/omatalous/<instance>, mode 600 in a folder of mode 700" test -f "$key" -a "$(mode "$key")" = 600 -a "$(mode "$(dirname "$key")")" = 700
  check "repo: the public key is printed" has "$(cat "$key.pub")"
  check "repo: and the next step is --check" has "use-private.sh --check"
  check "repo: the remote private is the repository" test "$(git -C "$CL" remote get-url private)" = "$PRIV"
  check "repo: core.sshCommand names the key and the pinned host key" bash -c "[[ \$1 == *\"-i '$key'\"* && \$1 == *StrictHostKeyChecking=yes* && \$1 == *IdentitiesOnly=yes* && \$1 == *'-F /dev/null'* ]]" x "$(git -C "$CL" config core.sshCommand)"
  check "repo: the known_hosts holds GitHub's key alone" test "$(cut -d' ' -f1,2 "$(dirname "$key")/known_hosts")" = "github.com ssh-ed25519"
  check "repo: no channel yet" test ! -e "$CL/ops/channel"
  check "repo: .env, origin and the tags untouched, and no docker call" test "$(fingerprint)" = "$before" -a "$(n_calls '^docker')" = 0
  sum=$(sha256sum <"$key")
  up --repo "$PRIV"
  check "repo again: the key is kept, not made anew" test "$RC" = 0 -a "$(sha256sum <"$key")" = "$sum"
  check "repo again: and says so" has "already there"
  check "repo again: one remote private" test "$(git -C "$CL" remote | grep -cx private)" = 1
  up --repo https://example.com/x.git
  check "repo: an address that is not SSH on GitHub is refused" test "$RC" != 0 -a "$(git -C "$CL" remote get-url private)" = "$PRIV"
}
t_check_fails_without_access() {
  world; local before; before=$(fingerprint)
  up --repo "file://$W/nowhere.git"; up --check
  check "no access: --check fails" test "$RC" != 0
  check "no access: and says what to do" has "did not let this key read"
  check "no access: no channel is written" test ! -e "$CL/ops/channel"
  check "no access: .env, origin and the tags untouched" test "$(fingerprint)" = "$before"
  world
  up --check
  check "no remote: --check names the first step" test "$RC" != 0 && check "no remote: the message" has "--repo"
}
t_check_switches() {
  world; local before head; before=$(fingerprint); head=$(head_commit)
  switched
  check "check: ends well" test "$RC" = 0
  check "check: ops/channel names the private channel, main, and the commit the folder is at" test "$(chan CHANNEL) $(chan FOLLOW) $(chan SINCE)" = "private main $head"
  check "check: ops/channel is mode 600" test "$(mode "$CL/ops/channel")" = 600
  check "check: the private main is fetched beside origin" test "$(git -C "$CL" rev-parse refs/remotes/private/main)" = "$(priv_head)"
  check "check: the folder has not moved" test "$(head_commit)" = "$head"
  check "check: .env, origin and the tags untouched, and no docker call" test "$(fingerprint)" = "$before" -a "$(n_calls '^docker')" = 0
  check "check: the next step is update.sh" has "./scripts/update.sh"
  up --check --follow nosuch
  check "check: a branch the repository has not is refused, the channel kept" test "$RC" != 0 -a "$(chan FOLLOW)" = main
  check "check: re-run keeps SINCE" test "$(chan SINCE)" = "$head"
}
t_lock() {
  world; up --repo "$PRIV"
  flock "$CL" sleep 30 & local holder=$!
  local i; for ((i = 0; i < 50; i++)); do flock -n "$CL" true || break; sleep 0.1; done
  up --check
  kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null
  check "lock: --check refuses while an install or update runs" test "$RC" != 0
  check "lock: and says so" has "install or update is running"
  check "lock: nothing written" test ! -e "$CL/ops/channel"
}

# ── update.sh on the private channel ────────────────────────────────────────
t_update_by_hand() {
  world; release 0.2.0; by_hand
  check "public: at 0.2.0" test "$(cver)" = 0.2.0
  local pub; pub=$(head_commit)
  switched; by_hand
  check "switch: the update ends well" test "$RC" = 0
  check "switch: the folder is at the private main" test "$(head_commit)" = "$(priv_head)"
  check "switch: built here with PRIVATE_BUILD=true" test "$(built_with)" = PRIVATE_BUILD=true -a "$(cver)" = 0.5.0
  check "switch: no image pulled from the registry and GitHub not asked" test "$(n_calls '^docker pull')" = 0 -a "$(curls)" = ""
  check "switch: the log says the signature check does not apply" has "signature check of the release images does not apply"
  check "switch: a copy was taken first" test "$(n_calls '^SNAPSHOT')" -ge 1
  check "switch: the state file names where from" grep -qx "CROSSED_FROM=$pub" "$CL/backups/.last-update"
  priv_commit; by_hand
  check "next: an ordinary forward update to the new private commit" test "$RC" = 0 -a "$(head_commit)" = "$(priv_head)" -a "$(built_with)" = PRIVATE_BUILD=true
  rolled_back
  check "rollback: back one private commit" test "$RC" = 0 -a "$(head_commit)" = "$(git -C "$W/pseed" rev-parse HEAD~1)"
}
t_update_only_from_since() {
  world; release 0.2.0; by_hand; switched
  # the folder moved on the public history after the switch: the private one no longer continues it
  mv "$CL/ops/channel" "$W/channel"; release 0.3.0; by_hand; mv "$W/channel" "$CL/ops/channel"
  local head; head=$(head_commit)
  by_hand
  check "since: a folder not at SINCE does not move onto the private history" test "$RC" != 0 -a "$(head_commit)" = "$head"
  check "since: and says so" has "does not continue the history"
  check "since: nothing built" test "$(n_calls '^docker compose build')" = 0
}
t_follow_tags() {
  world; git -C "$W/pseed" tag v0.5.0; git -C "$W/pseed" push -q "file://$W/private.git" v0.5.0 2>/dev/null
  priv_commit
  switched --follow tags
  check "tags: the channel follows tags" test "$RC" = 0 -a "$(chan FOLLOW)" = tags
  check "tags: the folder's own tags stay the public ones" test -z "$(git -C "$CL" tag --list v0.5.0)"
  by_hand
  check "tags: the update goes to the newest tag, not the branch tip" test "$RC" = 0 -a "$(head_commit)" = "$(git -C "$W/pseed" rev-parse v0.5.0)"
}
t_back() {
  world; release 0.2.0; by_hand; switched; by_hand
  local priv; priv=$(head_commit)
  up --back
  check "back: ends well" test "$RC" = 0
  check "back: the public channel, from the private commit" test "$(chan CHANNEL) $(chan SINCE)" = "public $priv"
  check "back: the remote private and core.sshCommand are gone" test -z "$(git -C "$CL" remote | grep -x private)" -a -z "$(git -C "$CL" config core.sshCommand)"
  check "back: the key stays" test -f "$(KEY_OF)"
  release 0.3.0; by_hand
  check "back, update: at the newest public release" test "$RC" = 0 -a "$(cver)" = 0.3.0 -a "$(head_commit)" = "$(git -C "$W/seed" rev-parse v0.3.0)"
  check "back, update: the release image is pulled and verified, nothing built" test "$(n_calls '^docker pull')" -ge 1 -a "$(n_calls '^docker compose build')" = 0
  up --back
  check "back again: nothing to do" test "$RC" = 0 && check "back again: says so" has "public releases already"
}

# ── the helper ──────────────────────────────────────────────────────────────
t_helper_private() {
  world; release 0.2.0; by_hand; switched; by_hand
  priv_commit; set_clock
  poll check-update; tick
  check "helper: the check finds the new private commit" reported ok
  check "helper: the page is told the channel is private" test "$(report | jq -r .state.channel)" = private
  check "helper: and a change is on offer" test "$(report | jq -r .state.update_available)" = true
  check "helper: GitHub was not asked" test "$(curls)" = ""
  poll update "$ID2"; tick
  check "helper: the button installs the private commit" test "$(head_commit)" = "$(priv_head)"
  check "helper: built private" test "$(built_with)" = PRIVATE_BUILD=true
  rm -f "$S/reports"/* "$CL/ops/journal"/*; cp -p "$CL/.env" "$W/env.before"
  poll prerelease-on; tick
  check "helper: the switch for new versions is refused on the private channel" reported failed
  check "helper: and .env is as it was" cmp -s "$CL/.env" "$W/env.before"
}
t_helper_refuses_other_history() {
  world; release 0.2.0; by_hand; switched; by_hand
  # the private main is pushed anew on another root: the helper does not follow it
  git -C "$W/pseed" checkout -q --orphan other; git -C "$W/pseed" commit -qm "other root"
  git -C "$W/pseed" push -qf "file://$W/private.git" other:main 2>/dev/null
  local head; head=$(head_commit); set_clock
  poll update; tick
  check "helper: a private main that does not continue the folder is refused" reported failed
  check "helper: the folder stays" test "$(head_commit)" = "$head"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
