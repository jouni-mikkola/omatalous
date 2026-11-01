#!/usr/bin/env bash
# tools/ci/restore-drill.sh IMAGE
# The restore drill: a backup of one install comes back on a machine that holds nothing of it, bank connection included.
#
#   1. An old install (own folder, Compose project, volumes and port) gets its first user, a bank application and a
#      consent in the fake bank (e2e/fake-bank), and its sync brings the household. The drill reads the full dashboard answer.
#   2. scripts/backup.sh takes the backup; the app secret is saved as the docs tell (docker compose exec banking cat
#      /secrets/app_secret). The old install is then taken down with its volumes: only the backup file and the saved secret are left.
#   3. A clean install in another folder, project and port, with a secret of its own and an empty database, holds the
#      installer's lock: scripts/restore.sh refuses. A wrong secret is refused (the saved bank keys cannot be opened); that restore has swapped the database in,
#      so the clean install is made again, empty, before the real restore.
#   4. scripts/restore.sh <backup> --secret <saved secret>. The dashboard answer is the old one to the cent (jq -S, the
#      whole answer, not a few figures), the first user signs in with the old password, and a new consent in the fake
#      bank works: the restored database holds the bank application, sealed with the saved secret, and the sync brings the rows.
#
# The fake bank is the one of the browser specs, started inside each container (the app takes a bank API only on
# its own loopback), from files copied into its /tmp; a Compose override of the drill's folder adds the two keys that point the app to it. Nothing of the real
# install is touched: every name carries the process id, the ports are free ones, and the containers, volumes, tags and
# folders are removed at the end, also after a failure, which prints the last log lines first.
# RESTORE_DRILL_HEALTH_WAIT is the seconds the app may take to answer (60). Needs the image, Docker Compose v2, curl, jq, openssl, node, flock, pkill and tar.
# Not covered: an encrypted backup (age) and a virtual machine; the clean machine is a second Compose project.
# Exit code 0 when everything passed, 1 when a check failed, 2 for a wrong command line.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

say() { printf '%s\n' "$*"; }
fail() { printf 'restore-drill: %s\n' "$*" >&2; exit 1; }
usage() { printf '%s\nusage: restore-drill.sh IMAGE\n' "$*" >&2; exit 2; }

(($# == 1)) || usage "One argument, not $#."
IMAGE=$1
[[ -n $IMAGE ]] || usage "IMAGE is empty."
HEALTH_WAIT=${RESTORE_DRILL_HEALTH_WAIT:-60}

# Compose and backup.sh read these from the environment before .env: a caller's values would point the drill at a real install or its backups
unset INSTANCE_NAME COMPOSE_PROJECT_NAME HOST_PORT BIND_ADDRESS APP_BASE_URL COMPOSE_PROFILES COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_ENV_FILES BACKUP_DIR BACKUP_COPY_TO BACKUP_AGE_RECIPIENT KEEP_DAYS
ID=restore-drill-$$
OLD=$ID-old NEW=$ID-new
WORK=$(mktemp -d "${TMPDIR:-/tmp}/restore-drill.XXXXXX")
STARTED=$SECONDS
BANK_PORT=9911
PASS='ci-salasana-123456'
H=(-H 'Content-Type: application/json' -H 'X-Requested-With: fetch')
LOCKER=""

cleanup() {
  local rc=$? n
  trap - EXIT
  [[ $BASHPID == "$$" ]] || exit "$rc"
  [[ -z $LOCKER ]] || { pkill -P "$LOCKER" 2>/dev/null; kill "$LOCKER" 2>/dev/null; } || true
  for n in "$OLD" "$NEW"; do
    if ((rc != 0)) && docker inspect "$n" >/dev/null 2>&1; then
      say "--- the last log lines of $n"
      docker logs --tail 40 "$n" 2>&1 || true
    fi
    [[ ! -d $WORK/$n ]] || (cd "$WORK/$n" && docker compose down -v >/dev/null 2>&1) || true
    docker rmi -f "$n:latest" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

free_port() { node -e 'const s=require("node:net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
# dc NAME ARGS...: docker compose in the folder of that install
dc() { local n=$1; shift; (cd "$WORK/$n" && docker compose "$@"); }
NODE=(node --disable-warning=ExperimentalWarning dist/node.js)
wait_health() { # wait_health PORT NAME
  local from=$SECONDS
  until curl -fsS "localhost:$1/api/health" >/dev/null 2>&1; do
    ((SECONDS - from < HEALTH_WAIT)) || fail "$2: /api/health did not answer within $HEALTH_WAIT s."
    sleep 1
  done
}
# machine NAME PORT: a folder with what a clone holds that the scripts read, an .env, the override and an image tag of its own
machine() {
  local d=$WORK/$1
  mkdir -p "$d/backups"
  cp -r "$ROOT/scripts" "$ROOT/docker-compose.yml" "$d/"
  printf 'INSTANCE_NAME=%s\nCOMPOSE_PROJECT_NAME=%s\nHOST_PORT=%s\nAPP_BASE_URL=http://127.0.0.1:%s\nINDUSTRY_LOOKUP=false\nSETUP_CODE=ci-setup-code-12345\n' "$1" "$1" "$2" "$2" >"$d/.env"
  # a loopback bank API and its consent host: the app accepts nothing else for EB_API_URL
  cat >"$d/docker-compose.override.yml" <<EOF
services:
  banking:
    environment:
      EB_API_URL: http://127.0.0.1:$BANK_PORT
      EB_AUTH_HOSTS: consent.esimerkkipankki.example
EOF
  docker tag "$IMAGE" "$1:latest"
  # the names are the drill's own, whatever the caller's environment or a Compose file says
  [[ $(dc "$1" config --format json | jq -r '[.name, .services.banking.container_name, .services.banking.image] | join(" ")') == "$1 $1 $1:latest" ]] \
    || fail "$1: Compose does not resolve to the names of the drill."
  dc "$1" up -d --no-build banking >/dev/null || fail "$1 did not start."
  wait_health "$2" "$1"
}
# bank_up NAME: the fake bank inside the container, its files in /tmp; both are gone whenever the container restarts.
# Not a bind mount: docker compose cp (backup.sh) fails on a container that has one over a read-only root.
bank_up() {
  tar -c -C "$ROOT/e2e/fake-bank" --exclude=README.md . | dc "$1" exec -T banking sh -c 'mkdir -p /tmp/fake-bank && tar -x -C /tmp/fake-bank' || fail "$1: the fake bank's files did not get in."
  dc "$1" exec -d -e FAKE_BANK_PORT=$BANK_PORT banking node /tmp/fake-bank/server.mjs || fail "$1: the fake bank did not start."
  local from=$SECONDS
  until dc "$1" exec -T banking wget -qO- "http://127.0.0.1:$BANK_PORT/fake/balance-calls" >/dev/null 2>&1; do
    ((SECONDS - from < 20)) || fail "$1: the fake bank does not answer."
    sleep 1
  done
}
# api JAR ARGS...: curl as the signed-in user whose cookie is in JAR
api() { local jar=$1; shift; curl -fsS --max-time 60 -b "$jar" -c "$jar" "${H[@]}" "$@"; }
login() { api "$2" -d "{\"username\":\"ci-admin\",\"password\":\"$PASS\"}" "localhost:$1/api/auth/login" >/dev/null; }
# link NAME PORT JAR: a consent in the fake bank, the way the browser goes: start, the consent page, the return with its query
link() {
  local url asked back
  url=$(api "$3" -X POST -d '{}' "localhost:$2/api/connections/start" | jq -er .url) || fail "$1: no consent address."
  [[ $url == https://consent.esimerkkipankki.example/consent/* ]] || fail "$1: the consent is not in the fake bank: $url"
  asked=http://127.0.0.1:$BANK_PORT/consent/${url##*/consent/}
  back=$(dc "$1" exec -T banking node -e 'fetch(process.argv[1], { redirect: "manual" }).then((r) => console.log(r.headers.get("location") ?? ""))' "$asked") \
    || fail "$1: the fake bank's consent page did not answer."
  [[ $back == *code=* && $back == *state=* ]] || fail "$1: the fake bank sent the browser nowhere: $back"
  api "$3" -d "$(jq -n --arg u "$back" '{url: $u}')" "localhost:$2/api/connections/complete" | jq -e '.accounts > 0' >/dev/null \
    || fail "$1: the consent brought no accounts."
}
# synced PORT JAR: the sync after a link has finished well and every account has a balance
synced() {
  local from=$SECONDS
  until api "$2" "localhost:$1/api/meta" 2>/dev/null | jq -e '(.lastSync.finishedAt // null) != null and .lastSync.status == "ok" and (.accounts | length) > 0 and all(.accounts[]; .balanceCents != null)' >/dev/null; do
    ((SECONDS - from < 90)) || fail "the sync after the link did not finish within 90 s."
    sleep 2
  done
}

docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "This machine has no image $IMAGE."
for tool in curl jq openssl node flock pkill tar; do command -v "$tool" >/dev/null || fail "$tool is missing."; done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is missing."

# ── 1. the old install and its household ──
OLD_PORT=$(free_port)
machine "$OLD" "$OLD_PORT"
bank_up "$OLD"
code=$(dc "$OLD" exec -T banking "${NODE[@]}" setup-code | tail -1)
curl -fsS "${H[@]}" -d "{\"code\":\"$code\",\"username\":\"ci-admin\",\"displayName\":\"CI\",\"password\":\"$PASS\"}" "localhost:$OLD_PORT/api/auth/setup" >/dev/null \
  || fail "$OLD: the first user could not be made."
login "$OLD_PORT" "$WORK/old.jar"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$WORK/bank.pem" 2>/dev/null
api "$WORK/old.jar" -X PUT -d "$(jq -n --arg id "$(cat /proc/sys/kernel/random/uuid)" --rawfile k "$WORK/bank.pem" '{appId: $id, privateKeyPem: $k}')" "localhost:$OLD_PORT/api/bank/credentials" >/dev/null \
  || fail "$OLD: the bank application was not saved."
rm -f "$WORK/bank.pem"
link "$OLD" "$OLD_PORT" "$WORK/old.jar"
synced "$OLD_PORT" "$WORK/old.jar"
FROM=$(date -d '-18 months' +%F) TO=$(date +%F)
api "$WORK/old.jar" "localhost:$OLD_PORT/api/dashboard?from=$FROM&to=$TO" | jq -S . >"$WORK/old-dashboard.json"
jq -e '.holdings.accounts | length > 0' "$WORK/old-dashboard.json" >/dev/null || fail "$OLD: the dashboard has no accounts."
say "ok   old install: first user, bank application, consent in the fake bank, $(jq '.holdings.accounts | length' "$WORK/old-dashboard.json") accounts in the dashboard"

# ── 2. the backup and the saved secret, then nothing of the old install ──
(cd "$WORK/$OLD" && ./scripts/backup.sh >/dev/null) || fail "$OLD: backup.sh failed."
# the figures a second consent gives are what the old install says of itself after the backup, so that the restored one has something to equal
link "$OLD" "$OLD_PORT" "$WORK/old.jar"
synced "$OLD_PORT" "$WORK/old.jar"
api "$WORK/old.jar" "localhost:$OLD_PORT/api/dashboard?from=$FROM&to=$TO" | jq -S . >"$WORK/old-relinked-dashboard.json"
BACKUP=$(ls "$WORK/$OLD"/backups/talous-*.db.gz) || fail "$OLD: backup.sh wrote no file."
mkdir "$WORK/saved"
cp "$BACKUP" "$WORK/saved/"
BACKUP=$WORK/saved/$(basename "$BACKUP")
(umask 077; dc "$OLD" exec -T banking cat /secrets/app_secret >"$WORK/saved/app_secret")
[[ $(wc -c <"$WORK/saved/app_secret") -ge 32 ]] || fail "$OLD: the saved app secret is too short."
dc "$OLD" down -v >/dev/null 2>&1 || fail "$OLD: could not be taken down."
docker rmi -f "$OLD:latest" >/dev/null 2>&1 || true
rm -rf "${WORK:?}/$OLD"
[[ -z $(docker ps -a -q --filter "name=^$OLD" ) && -z $(docker volume ls -q --filter "name=$OLD") ]] || fail "$OLD left a container or a volume."
say "ok   backup $(basename "$BACKUP") and the app secret saved; the old install, its volumes and its folder are gone"

# ── 3. the clean machine ──
NEW_PORT=$(free_port)
machine "$NEW" "$NEW_PORT"
curl -fsS "localhost:$NEW_PORT/api/auth/state" | jq -e '.needsSetup == true' >/dev/null || fail "$NEW is not empty."
[[ $(dc "$NEW" exec -T banking cat /secrets/app_secret) != "$(cat "$WORK/saved/app_secret")" ]] || fail "$NEW has the old app secret."
# the installer's lock is the folder: a run that holds it keeps restore.sh out, and nothing changes
flock "$WORK/$NEW" sleep 120 &
LOCKER=$!
sleep 1
if out=$(cd "$WORK/$NEW" && ./scripts/restore.sh "$BACKUP" --secret "$WORK/saved/app_secret" 2>&1 </dev/null); then fail "restore.sh ran while the installer's lock was held."; fi
[[ $out == *"An install or update is running in this folder"* ]] || fail "restore.sh did not name the lock: $(tail -n 2 <<<"$out")"
# flock ends with its child, the sleep that holds the lock
pkill -P "$LOCKER"; wait "$LOCKER" 2>/dev/null || true; LOCKER=""
curl -fsS "localhost:$NEW_PORT/api/auth/state" | jq -e '.needsSetup == true' >/dev/null || fail "$NEW changed while the lock was held."
say "ok   clean install $NEW: empty, a secret of its own, restore.sh stops at the installer's lock"

# a secret that does not open the saved bank keys: refused, and the app secret stays
printf 'x%.0s' {1..40} >"$WORK/wrong_secret"
before=$(dc "$NEW" exec -T banking cat /secrets/app_secret)
if out=$(cd "$WORK/$NEW" && ./scripts/restore.sh "$BACKUP" --secret "$WORK/wrong_secret" 2>&1 </dev/null); then fail "restore.sh took a secret that does not open the bank keys."; fi
[[ $out == *"does not open the saved bank keys"* ]] || fail "restore.sh refused a wrong secret in other words: $(tail -n 2 <<<"$out")"
[[ $(dc "$NEW" exec -T banking cat /secrets/app_secret) == "$before" ]] || fail "a refused secret changed the app secret."
say "ok   a wrong app secret is refused and the app secret is unchanged"
# that restore had already swapped the database in: the real one starts again from a clean machine, an empty database and a new secret
dc "$NEW" down -v >/dev/null 2>&1 || fail "$NEW: could not be taken down."
rm -rf "${WORK:?}/$NEW"
machine "$NEW" "$NEW_PORT"
curl -fsS "localhost:$NEW_PORT/api/auth/state" | jq -e '.needsSetup == true' >/dev/null || fail "$NEW is not empty."

# ── 4. the restore with the backup and the saved secret ──
out=$(cd "$WORK/$NEW" && ./scripts/restore.sh "$BACKUP" --secret "$WORK/saved/app_secret" 2>&1 </dev/null) || fail "restore.sh failed: $(tail -n 6 <<<"$out")"
[[ $out == *"App secret put back."* ]] || fail "restore.sh did not put the app secret back: $(tail -n 6 <<<"$out")"
[[ $(dc "$NEW" exec -T banking cat /secrets/app_secret) == "$(cat "$WORK/saved/app_secret")" ]] || fail "the app secret is not the saved one."
wait_health "$NEW_PORT" "$NEW"
login "$NEW_PORT" "$WORK/new.jar" || fail "the first user cannot sign in after the restore."
api "$WORK/new.jar" "localhost:$NEW_PORT/api/dashboard?from=$FROM&to=$TO" | jq -S . >"$WORK/new-dashboard.json"
if ! cmp -s "$WORK/old-dashboard.json" "$WORK/new-dashboard.json"; then
  diff "$WORK/old-dashboard.json" "$WORK/new-dashboard.json" | head -n 20 || true
  fail "the dashboard after the restore is not the dashboard before the backup."
fi
say "ok   restore.sh: the dashboard answer is the old one to the cent ($(wc -c <"$WORK/new-dashboard.json") bytes), the first user signs in"

# a new consent: the restored bank application opens with the restored app secret, the fake bank answers, the rows come
bank_up "$NEW"
link "$NEW" "$NEW_PORT" "$WORK/new.jar"
synced "$NEW_PORT" "$WORK/new.jar"
api "$WORK/new.jar" "localhost:$NEW_PORT/api/meta" | jq -e ".connections | length > 0" >/dev/null || fail "$NEW lists no bank connection."
api "$WORK/new.jar" "localhost:$NEW_PORT/api/dashboard?from=$FROM&to=$TO" | jq -S . >"$WORK/after-dashboard.json"
if ! cmp -s "$WORK/old-relinked-dashboard.json" "$WORK/after-dashboard.json"; then
  diff "$WORK/old-relinked-dashboard.json" "$WORK/after-dashboard.json" | head -n 30 || true
  fail "a second consent after the restore gives other figures than a second consent on the old install."
fi
say "ok   a new consent in the fake bank works after the restore and its sync gives the figures the old install gave"

say "restore drill ok: $IMAGE in $((SECONDS - STARTED)) s"
