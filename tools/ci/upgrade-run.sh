#!/usr/bin/env bash
# Upgrade rehearsal in Docker, used by the upgrade workflow and runnable by hand:
#
#   tools/ci/upgrade-run.sh <baseline-ref>
#
# Installs the baseline version (a release tag or commit) as a real git clone, loads data through its API,
# updates it to the current checkout the way a user of that version would, then rehearses what the next release
# needs from this checkout's update.sh: update, rollback, update again, a failing build, a failing migration.
# Needs Docker, git, curl, node. The install listens on port 8080 and has the names docker-compose.yml gives without a
# key, so run it on a machine where those are free (CI), or give it a port and a name of its own:
#
# UPGRADE_PORT=<port> and UPGRADE_PROJECT=<name>: the install gets that port and is that Compose project, with its
# container and image named after it, the way a second instance on one machine is set up: HOST_PORT, INSTANCE_NAME and
# COMPOSE_PROJECT_NAME in its .env. This script carries them in its own environment too, so that a baseline script
# that lost a key could not reach the install of another rehearsal. Several rehearsals then run at once
# (tools/ci/local-proof.sh). A baseline whose docker-compose.yml reads no such key is refused before anything is
# installed.
#
# UPGRADE_UNTIL=update: the run ends after the first update to this checkout and the checks of its result (the version,
# the data, the names, a clean tree), and none of the rollbacks, next releases and broken builds that follow. With
# UPGRADE_KEEP_UP=1 that leaves the install the drills (tools/ci/drills.sh) stand on, in some 20 seconds.
#
# The baseline's image is kept after the install has come up, under proof-baseline:<the full hash of the commit the clone
# is on>, and a later run on the same commit starts from it and builds nothing (PROOF_FRESH=1 builds it anew and keeps the new
# one). The hash comes from the clone after the reset, never from the ref, and an image that does not start is removed. The
# build of the commit under proof is update.sh's own and is always done. One line a phase says where the seconds went:
# "phase baseline image: 13 s (built)", then start, data, new image, update and checks.
#
# UPGRADE_BUILD_SHIM=<script>: run in the install directory before every update or build (argument "baseline" for
# the first build, "next" before an update), for machines that need build settings that are not part of the
# repository (a proxy certificate, say). UPGRADE_WORK must be set then; the remote is $UPGRADE_WORK/remote.git.
set -euo pipefail
B=${1:?usage: upgrade-run.sh <baseline-ref>}
SRC=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
WORK=${UPGRADE_WORK:-$(mktemp -d)}
REMOTE=$WORK/remote.git
DEV=$WORK/dev
DIR=$WORK/talous # not named banking-app: names must follow the compose defaults
# shellcheck disable=SC2034 # read in lib.sh (api)
JAR=$WORK/jar
PORT=${UPGRADE_PORT:-8080}
PROJECT=${UPGRADE_PROJECT:-}
URL=http://127.0.0.1:$PORT
# what docker-compose.yml names the container, the image and the data volume: its defaults, or after the project
NAME=${PROJECT:-banking-app}
VOLUME=${PROJECT:-talous}_banking-data
# the .env lines of an install with a port or a name of its own
MOVED=()
[[ $PORT == 8080 ]] || MOVED+=("HOST_PORT=$PORT")
[[ -z $PROJECT ]] || MOVED+=("INSTANCE_NAME=$PROJECT" "COMPOSE_PROJECT_NAME=$PROJECT")
NODE=(node --disable-warning=ExperimentalWarning)
KEPT_REPO=proof-baseline
export GIT_AUTHOR_NAME=ci GIT_AUTHOR_EMAIL=ci@example.invalid GIT_COMMITTER_NAME=ci GIT_COMMITTER_EMAIL=ci@example.invalid
PASS='ci-salasana-123456'

# dc, shim, app_version, migrations, golden_rows, api, until_ok and push_release are shared with the drills
# shellcheck source=lib.sh
. "$SRC/tools/ci/lib.sh"

# log and fail end the run on the spot; the drills' step and die also keep what a drill saw for its result line
log()  { printf '\n== %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
# phase NAME [SECONDS [NOTE]]: one line with the seconds since the last phase (or the given ones), so that a release is
# measured from the logs and not guessed
PH0=$SECONDS
phase() { printf 'phase %s: %d s%s\n' "$1" "${2:-$((SECONDS - PH0))}" "${3:+ ($3)}"; PH0=$SECONDS; }
# kept_is NAME: that image is here, and the hash in its name is the commit the install folder is on
kept_is() { [[ ${1#"$KEPT_REPO":} == "$(git -C "$DIR" rev-parse HEAD)" ]] && docker image inspect "$1" >/dev/null 2>&1; }
cleanup() {
  local rc=$?
  if ((rc != 0)) && [[ -d $DIR ]]; then dc logs --tail 80 banking >&2 || true; fi
  # UPGRADE_KEEP_UP=1: a run that passed leaves the install up, and UPGRADE_WORK in place, for tools/ci/drills.sh, which removes it
  if ((rc == 0)) && [[ ${UPGRADE_KEEP_UP:-} == 1 ]]; then return 0; fi
  [[ -d $DIR ]] && dc down -v >/dev/null 2>&1 || true
  [[ -n ${UPGRADE_WORK:-} ]] || rm -rf "$WORK"
  return "$rc"
}
trap cleanup EXIT
wait_up() { until_ok 180 app_ok || fail "the app did not come up"; }
head_version() { sed -n 's/^export const APP_VERSION = "\(.*\)";$/\1/p' "$SRC/apps/server/src/version.ts"; }
# facts that must survive an update: rows, sums, user-set categories, settings, a said use. Migration names are separate.
# golden_rows in lib.sh reads them, for the drills too.
golden() { golden_rows /data/banking.db; }
# marks, expected bills and Optimoi rows of every user, only where the schema has the tables (a baseline before 0.7.0
# or 0.8.0 does not).
# The keys are fixed and a row that is there is left alone, so a second call adds nothing.
seed_choices() {
  dc exec -T banking "${NODE[@]}" -e '
    const d = new (require("node:sqlite").DatabaseSync)("/data/banking.db");
    const has = (t) => d.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = \x27table\x27 AND name = ?").get(t) !== undefined;
    for (const u of d.prepare("SELECT id, username FROM users").all()) {
      if (has("user_marks")) {
        for (const [subject, mark] of [["merchant:NETFLIX.COM", "in_use"], ["merchant:SPOTIFY AB", "cancelled"], ["alert:ci-alert@52800", "dismissed"]]) d.prepare("INSERT OR IGNORE INTO user_marks (user_id, subject, mark, marked_at) VALUES (?, ?, ?, ?)").run(u.id, subject, mark, "2026-10-02T09:15:00+03:00");
      }
      if (has("expected_bills")) {
        for (const cadence of ["once", "quarterly", "semiannual", "yearly"]) d.prepare("INSERT OR IGNORE INTO expected_bills (id, user_id, name, amount_cents, due_date, cadence, category, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)").run("ci-" + u.username + "-" + cadence, u.id, "CI " + cadence, 12345, "2027-01-15", cadence, "2026-10-02T09:15:00.000Z");
      }
      if (has("optimise_inputs")) {
        for (const [key, value] of [["car_km", "14000"], ["housing_type", "\"rivitalo\""]]) d.prepare("INSERT OR IGNORE INTO optimise_inputs (user_id, key, value, as_of) VALUES (?, ?, ?, ?)").run(u.id, key, value, "2026-10-12");
        for (const [id, status, until] of [["food:eating_out", "dismissed", null], ["car:parking", "snoozed", "2027-01-15"]]) d.prepare("INSERT OR IGNORE INTO optimise_states (user_id, finding_id, status, reason, until, decided_at) VALUES (?, ?, ?, ?, ?, ?)").run(u.id, id, status, status === "dismissed" ? "need_it" : null, until, "2026-10-12T09:15:00.000Z");
        d.prepare("INSERT OR IGNORE INTO optimise_snapshots (user_id, month, data, created_at) VALUES (?, ?, ?, ?)").run(u.id, "2026-09", "[]", "2026-09-01T05:00:00.000Z");
      }
    }'
}
# A joint account of ci-admin as a baseline stores one: a bank account whose line of holders names two people. Prints
# "<account id> <admin id>", or nothing for a baseline whose accounts have no such columns. A second call adds nothing.
seed_joint() {
  dc exec -T banking "${NODE[@]}" -e '
    const d = new (require("node:sqlite").DatabaseSync)("/data/banking.db");
    const cols = d.prepare("PRAGMA table_info(accounts)").all().map((c) => c.name);
    if (!cols.includes("holder") || !cols.includes("identity")) process.exit(0);
    const admin = d.prepare("SELECT id FROM users WHERE username = \x27ci-admin\x27").get().id;
    d.prepare("INSERT OR IGNORE INTO accounts (id, user_id, provider, identity, name, created_at, holder) VALUES (?, ?, ?, ?, ?, ?, ?)").run("ci-joint", admin, "csv", "ci-joint-identity", "CI joint account", "2026-10-02T09:15:00.000Z", "MEIKALAINEN MATTI, KORHONEN ELISA");
    console.log("ci-joint", admin);'
}
# the use of the joint account as /api/meta gives it, on one line: its source, how many users, their weights (the member
# first, the user with no id last) and the part of the admin as from/to/of
joint_use() {
  api "$URL/api/meta" | node -e '
    const a = JSON.parse(require("node:fs").readFileSync(0, "utf8")).accounts.find((x) => x.id === process.argv[1]);
    if (!a || !a.use || !a.part) console.log("no use is given for the account");
    else console.log(a.use.source, a.use.users.length, a.use.users.map((u) => u.weight).join(","), [a.part.from, a.part.to, a.part.of].join("/"));' "$JOINT"
}
expect_equal() { diff <(printf '%s\n' "$2") <(printf '%s\n' "$3") >&2 || fail "$1 changed (diff above: expected, then actual)"; }
logged_in() { api "$URL/api/auth/state" | grep '"username":"ci-admin"' >/dev/null || fail "the old session no longer works"; }
# its own cookie file, so that the old session in $JAR stays what logged_in looks at (the drills' login replaces $JAR)
login_works() { curlj -c "$WORK/jar2" -d "{\"username\":\"ci-admin\",\"password\":\"$PASS\"}" "$URL/api/auth/login" >/dev/null || fail "password login fails"; }
# output goes to update.log (and the terminal); the status is update.sh's own. The checkout's script is run
# with --yes, an old baseline's script (which has no such flag) with no arguments.
run_update() {
  local rc=0
  shim
  (cd "$DIR" && ./scripts/update.sh "$@") >"$WORK/update.log" 2>&1 || rc=$?
  cat "$WORK/update.log"
  return "$rc"
}
said() { grep -qi -- "$1" "$WORK/update.log"; }

[[ -z ${UPGRADE_UNTIL:-} || $UPGRADE_UNTIL == update ]] || fail "UPGRADE_UNTIL knows only 'update' (it is '$UPGRADE_UNTIL')"

# Before the install folder exists: the cleanup of a run that failed takes down the Compose project of that folder,
# and a baseline that cannot take the keys would be the project of the defaults, which another rehearsal may be running.
if ((${#MOVED[@]})); then
  for key in HOST_PORT INSTANCE_NAME; do
    [[ $(git -C "$SRC" show "$B:docker-compose.yml" 2>/dev/null) == *"\${$key"* ]] \
      || fail "the docker-compose.yml of $B does not read $key, so this baseline runs only on port 8080 with the default names (set no UPGRADE_PORT and no UPGRADE_PROJECT)"
  done
fi

log "baseline $B as a git install"
git init -q --bare "$REMOTE"
git -C "$SRC" push -q "$REMOTE" HEAD:refs/heads/ci
git clone -q --branch ci "$REMOTE" "$DIR"
git clone -q --branch ci "$REMOTE" "$DEV"
git -C "$DIR" reset -q --hard "$B"
OLD_COMMIT=$(git -C "$DIR" rev-parse HEAD)
# The remote here holds no release tag, so the install follows the source from its first update on: a baseline that
# knows releases would ask GitHub for the newest one and stop, since that tag is not in this folder. An older
# baseline does not read the line.
printf 'SETUP_CODE=ci-setup-code-12345\nTALOUS_CHANNEL=source\n' >"$DIR/.env"
if ((${#MOVED[@]})); then
  printf '%s\n' "${MOVED[@]}" >>"$DIR/.env"
  export "${MOVED[@]}"
fi
# what docker-compose.yml names the one image of the install; anything else builds as before and keeps nothing
OLD_IMAGE=$(dc config --images 2>/dev/null) || OLD_IMAGE=''
KEEP_AS=$KEPT_REPO:$OLD_COMMIT
[[ $OLD_COMMIT =~ ^[0-9a-f]{40}$ && -n $OLD_IMAGE && $OLD_IMAGE != *$'\n'* ]] || KEEP_AS=''
IMAGE_FROM=built
if [[ -n $KEEP_AS && ${PROOF_FRESH:-} != 1 ]] && kept_is "$KEEP_AS" && docker tag "$KEEP_AS" "$OLD_IMAGE"; then IMAGE_FROM=kept; fi
if [[ $IMAGE_FROM == built ]]; then shim baseline; dc build; fi
phase "baseline image" "" "$IMAGE_FROM"
dc up -d
until_ok 180 app_ok || { [[ $IMAGE_FROM != kept ]] || docker rmi "$KEEP_AS" >/dev/null 2>&1; fail "the app did not come up"; }
OLD_VERSION=$(app_version)
echo "installed version $OLD_VERSION"
[[ $IMAGE_FROM == kept || -z $KEEP_AS ]] || docker tag "$OLD_IMAGE" "$KEEP_AS"
phase start

log "load data through the API"
api -d '{"code":"ci-setup-code-12345","username":"ci-admin","displayName":"CI","password":"'"$PASS"'"}' "$URL/api/auth/setup" >/dev/null
api -X POST "$URL/api/demo" >/dev/null
api -d '{"username":"ci-member","displayName":"Member"}' "$URL/api/users" >/dev/null
# a category the user chose by hand
dc exec -T banking "${NODE[@]}" -e 'const d = new (require("node:sqlite").DatabaseSync)("/data/banking.db"); d.exec("UPDATE transactions SET category = \x27gifts\x27, category_source = \x27user\x27 WHERE id = (SELECT id FROM transactions ORDER BY id LIMIT 1)");'
seed_choices # does nothing for a baseline without the tables
read -r JOINT ADMIN_ID <<<"$(seed_joint)" # empty for a baseline whose accounts do not carry a line of holders
GOLD0=$(golden)
echo "$GOLD0"
[[ $GOLD0 == *"user-row"* && $GOLD0 == *"tx ci-admin"* ]] || fail "the data was not loaded"
phase data

log "update from $B to $(git -C "$SRC" rev-parse --short HEAD) the way a user of that version does"
UPDATE0=$(date +%s)
if [[ -f $DIR/scripts/update.sh ]]; then run_update >/dev/null # the baseline's own script, as it is
else shim; (cd "$DIR" && git pull -q --ff-only && docker compose up -d --build); fi
wait_up
# the new image is done when its configuration was made, which the image says
BUILT_AT=$(date -d "$(docker image inspect -f '{{.Created}}' "$NAME:latest" 2>/dev/null)" +%s 2>/dev/null) || BUILT_AT=0
TOOK=$((SECONDS - PH0))
if ((BUILT_AT >= UPDATE0 && BUILT_AT - UPDATE0 <= TOOK)); then
  phase "new image" $((BUILT_AT - UPDATE0))
  phase update $((TOOK - BUILT_AT + UPDATE0))
else
  echo "phase new image: not measured (the image was made before the update began)"
  phase update
fi
NEW_VERSION=$(app_version)
[[ $NEW_VERSION == "$(head_version)" ]] || fail "version is $NEW_VERSION, expected $(head_version)"
expect_equal "the data" "$GOLD0" "$(golden)"
logged_in
login_works
[[ $(dc exec -T banking ls /data/backups | grep -c '^pre-') -ge 1 ]] || fail "no database copy was made"
migrations | grep '^0004_' >/dev/null || fail "migrations did not run"
docker image inspect "$NAME:latest" >/dev/null || fail "image name changed"
docker ps --format '{{.Names}}' | grep -x "$NAME" >/dev/null || fail "container name changed"
docker volume ls -q | grep -x "$VOLUME" >/dev/null || fail "volume name changed"
# an install with the default names has no such line; a named one was given it above
[[ -n $PROJECT ]] || ! grep -q '^INSTANCE_NAME=' "$DIR/.env" || fail "INSTANCE_NAME was written into .env"
git -C "$DIR" diff --quiet || fail "the working tree is dirty"
# UPGRADE_UNTIL=update: this is the install the drills need, so the run ends here (see the header)
if [[ ${UPGRADE_UNTIL:-} == update ]]; then phase checks "" "ended after the update, as UPGRADE_UNTIL says"; echo; exit 0; fi

# What the baseline stored of a joint account reads as one, and a use said through the route is stored as two rows
# (the member at 60000, the holders who are no member at 40000, a part of 3 of 5 for the member).
GOLD_USE=$GOLD0
USE_SAID="said 2 60000,40000 0/3/5"
if [[ -n $JOINT ]]; then
  log "the joint account of the baseline reads as joint, then a use is said through the route"
  [[ $(joint_use) == "bank 2 "* ]] || fail "the joint account of the baseline should read as joint in /api/meta (source bank, two users); it reads: $(joint_use)"
  ANSWER=$(api -X PUT -d "{\"users\":[{\"userId\":\"$ADMIN_ID\",\"weight\":60000},{\"userId\":null,\"weight\":40000}]}" "$URL/api/accounts/$JOINT/use") || ANSWER="no answer"
  [[ $ANSWER == *'"ok":true'* ]] || fail "PUT /api/accounts/$JOINT/use should answer ok; it answered: $ANSWER"
  [[ $(joint_use) == "$USE_SAID" ]] || fail "after the use is said /api/meta should read \"$USE_SAID\"; it reads: $(joint_use)"
  GOLD_USE=$(golden)
  [[ $GOLD_USE == *"account_use ci-joint-identity ci-admin 60000"* && $GOLD_USE == *"account_use ci-joint-identity - 40000"* ]] \
    || fail "the said use should be two rows of account_use (ci-admin 60000, no member 40000); the database holds: $(grep '^account_use' <<<"$GOLD_USE" | tr '\n' ';')"
fi

if [[ -f $DIR/backups/.last-update ]]; then
  log "rollback with this checkout's update.sh, then update again with the old one"
  MIGRATIONS_NEW=$(migrations)
  (cd "$DIR" && ./scripts/update.sh --rollback --yes)
  wait_up
  [[ $(app_version) == "$OLD_VERSION" ]] || fail "rollback did not bring back $OLD_VERSION"
  [[ $(git -C "$DIR" rev-parse HEAD) == "$OLD_COMMIT" ]] || fail "rollback did not return the source"
  # A baseline that opens the database as the update left it keeps it, with its migration history and the said use. Any
  # other gets the copy from before the update back, and the use is gone with it.
  if [[ $(migrations) == "$MIGRATIONS_NEW" ]]; then GOLD_BACK=$GOLD_USE; else GOLD_BACK=$GOLD0; fi
  expect_equal "the data after rollback" "$GOLD_BACK" "$(golden)"
  if [[ -n $JOINT && $GOLD_BACK == "$GOLD_USE" ]]; then
    api "$URL/api/meta" | grep "\"id\":\"$JOINT\"" >/dev/null || fail "the older version, with the table of the said use in its database, should list the joint account in /api/meta"
  fi
  login_works
  run_update >/dev/null # back at the baseline, so its own script again
  wait_up
  [[ $(app_version) == "$(head_version)" ]] || fail "second update did not reach $(head_version)"
  expect_equal "the data after the second update" "$GOLD_BACK" "$(golden)"
  if [[ -n $JOINT && $GOLD_BACK == "$GOLD_USE" ]]; then
    [[ $(joint_use) == "$USE_SAID" ]] || fail "the said use should still be there after the second update; /api/meta should read \"$USE_SAID\", it reads: $(joint_use)"
  fi
fi

# This checkout has the tables whatever the baseline was. The rollback above put back the database copy from before
# the first update (update.sh warns that changes made after it are lost), so the rows are written here, after it,
# and must survive the next release and the rollback of that.
log "marks, expected bills and Optimoi rows written at this version"
seed_choices
GOLD_HEAD=$(golden)
[[ $GOLD_HEAD == *"user_marks ci-admin 3"* && $GOLD_HEAD == *"user_marks ci-member 3"* ]] || fail "the marks were not written"
[[ $GOLD_HEAD == *"expected_bills ci-admin 4"* && $GOLD_HEAD == *"expected_bills ci-member 4"* ]] || fail "the expected bills were not written"
[[ $GOLD_HEAD == *"optimise_inputs ci-admin 2"* && $GOLD_HEAD == *"optimise_states ci-member 2"* ]] || fail "the Optimoi inputs and states were not written"
[[ $GOLD_HEAD == *"optimise_snapshots ci-admin 1"* && $GOLD_HEAD == *"optimise_snapshots ci-member 1"* ]] || fail "the Optimoi snapshots were not written"

log "this checkout's update.sh on the next release"
grep -q '^TALOUS_CHANNEL=source$' "$DIR/.env" || printf 'TALOUS_CHANNEL=source\n' >>"$DIR/.env" # an old baseline may have written .env anew
run_update --yes >/dev/null
said 'already current\|Updated\|Running\|jo käytössä\|Päivitetty\|Käynnissä' || fail "no outcome line"
wait_up
run_update --yes >/dev/null
said 'already current\|jo käytössä' || fail "a second run on the same version should say it is current"
HEAD_COMMIT=$(git -C "$DIR" rev-parse HEAD)

push_release "ci: next release" '
  sed -i "s/^export const APP_VERSION = .*/export const APP_VERSION = \"9999.0.0\";/" apps/server/src/version.ts
  echo "ALTER TABLE accounts ADD COLUMN ci_note TEXT;" >apps/server/migrations/9999_ci_next.sql'
run_update --yes >/dev/null
said 'Updated\|Päivitetty' || fail "update to the next release failed"
wait_up
[[ $(app_version) == 9999.0.0 ]] || fail "next release is not running"
expect_equal "the data after the next release" "$GOLD_HEAD" "$(golden)"
migrations | grep '^9999_ci_next' >/dev/null || fail "the next migration did not run"
(cd "$DIR" && ./scripts/update.sh --rollback --yes)
wait_up
[[ $(app_version) == "$(head_version)" ]] || fail "rollback did not bring back $(head_version)"
[[ $(git -C "$DIR" rev-parse HEAD) == "$HEAD_COMMIT" ]] || fail "rollback did not return the source"
expect_equal "the data after the second rollback" "$GOLD_HEAD" "$(golden)"
migrations | grep '^9999_' >/dev/null && fail "the rolled back database still has the next migration"
run_update --yes >/dev/null
said 'Updated\|Päivitetty' || fail "update after rollback failed"
wait_up
[[ $(app_version) == 9999.0.0 ]] || fail "next release is not running again"

log "a build that fails leaves the old version running and is not called current"
push_release "ci: broken build" 'sed -i "s/^RUN mkdir \/data/RUN false \&\& mkdir \/data/" Dockerfile'
if run_update --yes >/dev/null; then fail "a broken build must not succeed"; fi
wait_up
[[ $(app_version) == 9999.0.0 ]] || fail "the old version stopped"
run_update --yes >/dev/null || true
if said 'already current\|jo käytössä'; then fail "a failed update was reported as current"; fi
push_release "ci: repair build" 'git revert --no-edit HEAD >/dev/null'
run_update --yes >/dev/null
said 'Updated\|Päivitetty' || fail "update after the repair failed"
wait_up

log "a migration that fails is rolled back by itself"
GOLD1=$(golden)
push_release "ci: broken migration" 'echo "SELECT * FROM table_that_does_not_exist;" >apps/server/migrations/9998_ci_bad.sql'
if run_update --yes >/dev/null; then fail "a failing migration must not succeed"; fi
wait_up
[[ $(app_version) == 9999.0.0 ]] || fail "rollback after the failed migration did not bring the old version back"
expect_equal "the data after the failed migration" "$GOLD1" "$(golden)"
phase checks
echo
echo "upgrade rehearsal from $B passed"
