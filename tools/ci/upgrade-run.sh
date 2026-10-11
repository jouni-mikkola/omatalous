#!/usr/bin/env bash
# Upgrade rehearsal in Docker, used by the upgrade workflow and runnable by hand:
#
#   tools/ci/upgrade-run.sh <baseline-ref>
#
# Installs the baseline version (a release tag or commit) as a real git clone, loads data through its API,
# updates it to the current checkout the way a user of that version would, then rehearses what the next release
# needs from this checkout's update.sh: update, rollback, update again, a failing build, a failing migration.
# Needs Docker, git, curl, node. The ports are fixed (8080), so run it on a machine where that is free (CI).
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
JAR=$WORK/jar
URL=http://127.0.0.1:8080
NODE=(node --disable-warning=ExperimentalWarning)
export GIT_AUTHOR_NAME=ci GIT_AUTHOR_EMAIL=ci@example.invalid GIT_COMMITTER_NAME=ci GIT_COMMITTER_EMAIL=ci@example.invalid
PASS='ci-salasana-123456'

log()  { printf '\n== %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
# argument "baseline": the shim is about the checkout as it is; otherwise about the version the next update pulls
# (branch ci of the remote)
shim() { if [[ -n ${UPGRADE_BUILD_SHIM:-} ]]; then (cd "$DIR" && "$UPGRADE_BUILD_SHIM" "${1:-next}"); fi; }
dc()   { (cd "$DIR" && docker compose "$@"); }
api()  { curl -fsS -b "$JAR" -c "$JAR" -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' "$@"; }
cleanup() {
  local rc=$?
  if ((rc != 0)) && [[ -d $DIR ]]; then dc logs --tail 80 banking >&2 || true; fi
  [[ -d $DIR ]] && dc down -v >/dev/null 2>&1 || true
  [[ -n ${UPGRADE_WORK:-} ]] || rm -rf "$WORK"
  return "$rc"
}
trap cleanup EXIT
wait_up() { for _ in $(seq 1 90); do dc exec -T banking wget -qO- http://127.0.0.1:8080/api/health >/dev/null 2>&1 && return 0; sleep 2; done; fail "the app did not come up"; }
app_version() { dc exec -T banking "${NODE[@]}" dist/node.js version 2>/dev/null | tail -1 | awk '{print $1}' || echo unknown; }
head_version() { sed -n 's/^export const APP_VERSION = "\(.*\)";$/\1/p' "$SRC/apps/server/src/version.ts"; }
# facts that must survive an update: rows, sums, user-set categories, settings. Migration names are separate.
golden() {
  dc exec -T banking "${NODE[@]}" -e '
    const d = new (require("node:sqlite").DatabaseSync)("/data/banking.db");
    const p = (...a) => console.log(a.join(" "));
    for (const r of d.prepare("SELECT u.username AS u, count(t.id) AS n, coalesce(sum(t.amount_cents),0) AS s FROM users u LEFT JOIN transactions t ON t.user_id = u.id GROUP BY u.id ORDER BY u.username").all()) p("tx", r.u, r.n, r.s);
    p("accounts", d.prepare("SELECT count(*) AS n FROM accounts").get().n);
    p("rules", d.prepare("SELECT count(*) AS n FROM category_rules").get().n);
    // tables of 0.7.0 and 0.8.0: a baseline without them counts 0, which is what a new empty table counts too
    const has = (t) => d.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = \x27table\x27 AND name = ?").get(t) !== undefined;
    for (const t of ["user_marks", "expected_bills", "optimise_inputs", "optimise_states", "optimise_snapshots"]) for (const r of d.prepare("SELECT u.username AS u, " + (has(t) ? "(SELECT count(*) FROM " + t + " x WHERE x.user_id = u.id)" : "0") + " AS n FROM users u ORDER BY u.username").all()) p(t, r.u, r.n);
    for (const r of d.prepare("SELECT id, category FROM transactions WHERE category_source = \x27user\x27 ORDER BY id").all()) p("user-row", r.id, r.category);
    for (const r of d.prepare("SELECT key, value FROM settings WHERE key = \x27instance_settings\x27").all()) p("setting", r.key, r.value);' | sort
}
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
migrations() { dc exec -T banking "${NODE[@]}" -e 'const d = new (require("node:sqlite").DatabaseSync)("/data/banking.db"); for (const r of d.prepare("SELECT name FROM _migrations ORDER BY name").all()) console.log(r.name);'; }
expect_equal() { diff <(printf '%s\n' "$2") <(printf '%s\n' "$3") >&2 || fail "$1 changed (diff above: expected, then actual)"; }
logged_in() { api "$URL/api/auth/state" | grep '"username":"ci-admin"' >/dev/null || fail "the old session no longer works"; }
login_works() { curl -fsS -c "$WORK/jar2" -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' -d "{\"username\":\"ci-admin\",\"password\":\"$PASS\"}" "$URL/api/auth/login" >/dev/null || fail "password login fails"; }
# a commit on top of the remote branch, made in a separate clone
push_commit() { # message, then a shell snippet run in the dev clone
  git -C "$DEV" pull -q --ff-only origin ci
  (cd "$DEV" && eval "$2")
  git -C "$DEV" add -A
  if ! git -C "$DEV" diff --cached --quiet; then git -C "$DEV" commit -q -m "$1"; fi
  git -C "$DEV" push -q origin HEAD:ci
}
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

log "baseline $B as a git install"
git init -q --bare "$REMOTE"
git -C "$SRC" push -q "$REMOTE" HEAD:refs/heads/ci
git clone -q --branch ci "$REMOTE" "$DIR"
git clone -q --branch ci "$REMOTE" "$DEV"
git -C "$DIR" reset -q --hard "$B"
OLD_COMMIT=$(git -C "$DIR" rev-parse HEAD)
printf 'SETUP_CODE=ci-setup-code-12345\n' >"$DIR/.env"
shim baseline
dc up -d --build
wait_up
OLD_VERSION=$(app_version)
echo "installed version $OLD_VERSION"

log "load data through the API"
api -d '{"code":"ci-setup-code-12345","username":"ci-admin","displayName":"CI","password":"'"$PASS"'"}' "$URL/api/auth/setup" >/dev/null
api -X POST "$URL/api/demo" >/dev/null
api -d '{"username":"ci-member","displayName":"Member"}' "$URL/api/users" >/dev/null
# a category the user chose by hand
dc exec -T banking "${NODE[@]}" -e 'const d = new (require("node:sqlite").DatabaseSync)("/data/banking.db"); d.exec("UPDATE transactions SET category = \x27gifts\x27, category_source = \x27user\x27 WHERE id = (SELECT id FROM transactions ORDER BY id LIMIT 1)");'
seed_choices # does nothing for a baseline without the tables
GOLD0=$(golden)
echo "$GOLD0"
[[ $GOLD0 == *"user-row"* && $GOLD0 == *"tx ci-admin"* ]] || fail "the data was not loaded"

log "update from $B to $(git -C "$SRC" rev-parse --short HEAD) the way a user of that version does"
if [[ -f $DIR/scripts/update.sh ]]; then run_update >/dev/null # the baseline's own script, as it is
else shim; (cd "$DIR" && git pull -q --ff-only && docker compose up -d --build); fi
wait_up
NEW_VERSION=$(app_version)
[[ $NEW_VERSION == "$(head_version)" ]] || fail "version is $NEW_VERSION, expected $(head_version)"
expect_equal "the data" "$GOLD0" "$(golden)"
logged_in
login_works
[[ $(dc exec -T banking ls /data/backups | grep -c '^pre-') -ge 1 ]] || fail "no database copy was made"
migrations | grep '^0004_' >/dev/null || fail "migrations did not run"
docker image inspect banking-app:latest >/dev/null || fail "image name changed"
docker ps --format '{{.Names}}' | grep -x banking-app >/dev/null || fail "container name changed"
docker volume ls -q | grep -x talous_banking-data >/dev/null || fail "volume name changed"
! grep -q '^INSTANCE_NAME=' "$DIR/.env" || fail "INSTANCE_NAME was written into .env"
git -C "$DIR" diff --quiet || fail "the working tree is dirty"

if [[ -f $DIR/backups/.last-update ]]; then
  log "rollback with this checkout's update.sh, then update again with the old one"
  (cd "$DIR" && ./scripts/update.sh --rollback --yes)
  wait_up
  [[ $(app_version) == "$OLD_VERSION" ]] || fail "rollback did not bring back $OLD_VERSION"
  [[ $(git -C "$DIR" rev-parse HEAD) == "$OLD_COMMIT" ]] || fail "rollback did not return the source"
  expect_equal "the data after rollback" "$GOLD0" "$(golden)"
  login_works
  run_update >/dev/null # back at the baseline, so its own script again
  wait_up
  [[ $(app_version) == "$(head_version)" ]] || fail "second update did not reach $(head_version)"
  expect_equal "the data after the second update" "$GOLD0" "$(golden)"
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
printf 'TALOUS_CHANNEL=source\n' >>"$DIR/.env"
run_update --yes >/dev/null
said 'already current\|Updated\|Running\|jo käytössä\|Päivitetty\|Käynnissä' || fail "no outcome line"
wait_up
run_update --yes >/dev/null
said 'already current\|jo käytössä' || fail "a second run on the same version should say it is current"
HEAD_COMMIT=$(git -C "$DIR" rev-parse HEAD)

push_commit "ci: next release" '
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
push_commit "ci: broken build" 'sed -i "s/^RUN mkdir \/data/RUN false \&\& mkdir \/data/" Dockerfile'
if run_update --yes >/dev/null; then fail "a broken build must not succeed"; fi
wait_up
[[ $(app_version) == 9999.0.0 ]] || fail "the old version stopped"
run_update --yes >/dev/null || true
if said 'already current\|jo käytössä'; then fail "a failed update was reported as current"; fi
push_commit "ci: repair build" 'git revert --no-edit HEAD >/dev/null'
run_update --yes >/dev/null
said 'Updated\|Päivitetty' || fail "update after the repair failed"
wait_up

log "a migration that fails is rolled back by itself"
GOLD1=$(golden)
push_commit "ci: broken migration" 'echo "SELECT * FROM table_that_does_not_exist;" >apps/server/migrations/9998_ci_bad.sql'
if run_update --yes >/dev/null; then fail "a failing migration must not succeed"; fi
wait_up
[[ $(app_version) == 9999.0.0 ]] || fail "rollback after the failed migration did not bring the old version back"
expect_equal "the data after the failed migration" "$GOLD1" "$(golden)"
echo
echo "upgrade rehearsal from $B passed"
