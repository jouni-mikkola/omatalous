#!/usr/bin/env bash
# tools/ci/offsite-drill.sh IMAGE
# The drill of the copy to another machine: an install sends its encrypted copy to a second container over SFTP, the
# install is taken away, and a clean install is restored from what the second container holds and the age key alone.
#
#   1. The source install (own folder, Compose project, volumes and port) gets its first user. Through the admin API it
#      makes the keys (the age secret is in the answer once and is saved here, as a household saves it in a password
#      manager), is given the target and is asked for a copy now. The target is a second container, Alpine with sshd,
#      whose authorized_keys holds the install's public SSH line.
#   2. The real maintenance helper (scripts/ops-helper.sh, one tick at a time) runs the copy: scripts/lib/ops-offsite.sh
#      reads the target with `ops offsite`, scripts/offsite.sh encrypts with age and uploads over sftp.
#   3. What the target holds is checked: age files only, none of the app secret's bytes, the age secret in none of them
#      and not in the install's data, a wrong key opens nothing, the saved key opens both.
#   4. The source install is taken down with its volumes. A clean install in another folder, with a secret of its own,
#      is restored with scripts/restore.sh from the files fetched from the target and the age key alone (restore.sh
#      refuses without it): the app secret is the old one, the first user signs in and the sealed target opens.
#
# The host needs age for the copy, and it often has none: the drill takes the binary out of the target's image and puts it
# first in PATH for the helper (its test switch OPS_TEST=1 keeps PATH; it
# otherwise runs with a clean one) and restore.sh only. Nothing of a real install is touched: every name carries the process
# id, the ports are free ones, and containers, volumes, tags and folders are removed at the end, also after a failure.
# Needs the image, Docker Compose v2, curl, jq, node, flock, pkill, ssh-keygen and sftp.
# Exit code 0 when everything passed, 1 when a check failed, 2 for a wrong command line.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# the helper refuses a folder that anyone but its owner can write to
umask 022
DOCKER_CONFIG_DIR=${DOCKER_CONFIG:-$HOME/.docker}

say() { printf '%s\n' "$*"; }
fail() { printf 'offsite-drill: %s\n' "$*" >&2; exit 1; }
usage() { printf '%s\nusage: offsite-drill.sh IMAGE\n' "$*" >&2; exit 2; }

(($# == 1)) || usage "One argument, not $#."
IMAGE=$1
[[ -n $IMAGE ]] || usage "IMAGE is empty."
HEALTH_WAIT=${OFFSITE_DRILL_HEALTH_WAIT:-60}

# Compose and the scripts read these from the environment before .env: a caller's values would point the drill at a real install
unset INSTANCE_NAME COMPOSE_PROJECT_NAME HOST_PORT BIND_ADDRESS APP_BASE_URL COMPOSE_PROFILES COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_ENV_FILES BACKUP_DIR BACKUP_COPY_TO BACKUP_AGE_RECIPIENT KEEP_DAYS
ID=offsite-drill-$$
SRC=$ID-src NEW=$ID-new TARGET=$ID-target
WORK=$(mktemp -d "${TMPDIR:-/tmp}/offsite-drill.XXXXXX")
STARTED=$SECONDS
PASS='ci-salasana-123456'
H=(-H 'Content-Type: application/json' -H 'X-Requested-With: fetch')

cleanup() {
  local rc=$? n
  trap - EXIT
  [[ $BASHPID == "$$" ]] || exit "$rc"
  for n in "$SRC" "$NEW"; do
    if ((rc != 0)) && docker inspect "$n" >/dev/null 2>&1; then
      say "--- the last log lines of $n"
      docker logs --tail 40 "$n" 2>&1 || true
    fi
    [[ ! -d $WORK/$n ]] || (cd "$WORK/$n" && docker compose down -v >/dev/null 2>&1) || true
    docker rmi -f "$n:latest" >/dev/null 2>&1 || true
  done
  if ((rc != 0)) && docker inspect "$TARGET" >/dev/null 2>&1; then docker logs --tail 20 "$TARGET" 2>&1 || true; fi
  docker rm -f "$TARGET" >/dev/null 2>&1 || true
  docker rmi -f "$TARGET:latest" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

free_port() { node -e 'const s=require("node:net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
# dc NAME ARGS...: docker compose in the folder of that install
dc() { local n=$1; shift; (cd "$WORK/$n" && docker compose "$@"); }
wait_health() { # wait_health PORT NAME
  local from=$SECONDS
  until curl -fsS "localhost:$1/api/health" >/dev/null 2>&1; do
    ((SECONDS - from < HEALTH_WAIT)) || fail "$2: /api/health did not answer within $HEALTH_WAIT s."
    sleep 1
  done
}
# machine NAME PORT: a folder with what a clone holds that the scripts read, an .env and an image tag of its own
machine() {
  local d=$WORK/$1
  mkdir -p "$d/backups"
  cp -r "$ROOT/scripts" "$ROOT/docker-compose.yml" "$d/"
  printf 'INSTANCE_NAME=%s\nCOMPOSE_PROJECT_NAME=%s\nHOST_PORT=%s\nAPP_BASE_URL=http://127.0.0.1:%s\nINDUSTRY_LOOKUP=false\nSETUP_CODE=ci-setup-code-12345\n' "$1" "$1" "$2" "$2" >"$d/.env"
  docker tag "$IMAGE" "$1:latest"
  [[ $(dc "$1" config --format json | jq -r '[.name, .services.banking.container_name, .services.banking.image] | join(" ")') == "$1 $1 $1:latest" ]] \
    || fail "$1: Compose does not resolve to the names of the drill."
  dc "$1" up -d --no-build banking >/dev/null || fail "$1 did not start."
  wait_health "$2" "$1"
}
# api JAR ARGS...: curl as the signed-in user whose cookie is in JAR
api() { local jar=$1; shift; curl -fsS --max-time 60 -b "$jar" -c "$jar" "${H[@]}" "$@"; }

docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "This machine has no image $IMAGE."
for tool in curl jq node flock pkill ssh-keygen sftp; do command -v "$tool" >/dev/null || fail "$tool is missing."; done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is missing."

# ── the other machine: sshd with sftp, and the age binary for the host ──
docker build -q -t "$TARGET:latest" - >/dev/null <<'DOCKERFILE' || fail "The target image did not build."
FROM alpine:3
RUN apk add --no-cache openssh-server openssh-sftp-server age \
 && adduser -D -s /bin/sh omatalous && echo "omatalous:$(head -c 24 /dev/urandom | base64)" | chpasswd \
 && mkdir -p /home/omatalous/.ssh && chmod 700 /home/omatalous/.ssh && chown omatalous /home/omatalous/.ssh \
 && ssh-keygen -A
CMD ["/usr/sbin/sshd", "-D", "-e", "-o", "PasswordAuthentication=no"]
DOCKERFILE
# age of Alpine is dynamic against musl: the loader goes along, so a glibc host runs it
mkdir "$WORK/bin" "$WORK/musl"
docker run --rm --entrypoint sh "$TARGET:latest" -c 'tar -c -C / usr/bin/age lib/ld-musl-*.so.1' | tar -x -C "$WORK/musl" || fail "age did not come out of the target image."
printf '#!/bin/sh\nexec "$(ls "%s"/musl/lib/ld-musl-*.so.1)" "%s/musl/usr/bin/age" "$@"\n' "$WORK" "$WORK" >"$WORK/bin/age"
chmod +x "$WORK/bin/age"
age --version >/dev/null 2>&1 || PATH="$WORK/bin:$PATH" age --version >/dev/null 2>&1 || fail "The age binary of the target image does not run on this machine."
SSH_PORT=$(free_port)
docker run -d --name "$TARGET" -p "127.0.0.1:$SSH_PORT:22" "$TARGET:latest" >/dev/null || fail "The target did not start."
from=$SECONDS
until (exec 3<>"/dev/tcp/127.0.0.1/$SSH_PORT") 2>/dev/null; do ((SECONDS - from < 20)) || fail "sshd does not answer."; sleep 1; done

# ── 1. the source install and its keys ──
SRC_PORT=$(free_port)
machine "$SRC" "$SRC_PORT"
code=$(dc "$SRC" exec -T banking node --disable-warning=ExperimentalWarning dist/node.js setup-code | tail -1)
curl -fsS "${H[@]}" -d "{\"code\":\"$code\",\"username\":\"ci-admin\",\"displayName\":\"CI\",\"password\":\"$PASS\"}" "localhost:$SRC_PORT/api/auth/setup" >/dev/null \
  || fail "$SRC: the first user could not be made."
api "$WORK/src.jar" -d "{\"username\":\"ci-admin\",\"password\":\"$PASS\"}" "localhost:$SRC_PORT/api/auth/login" >/dev/null
keys=$(api "$WORK/src.jar" -d "{\"password\":\"$PASS\"}" "localhost:$SRC_PORT/api/admin/offsite/keys") || fail "The keys were not made."
(umask 077; jq -r .ageSecret <<<"$keys" >"$WORK/age.key")
AGE_SECRET=$(cat "$WORK/age.key")
[[ $AGE_SECRET == AGE-SECRET-KEY-1* ]] || fail "The answer holds no age secret."
SSH_PUB=$(jq -r .sshPublic <<<"$keys")
[[ $SSH_PUB == ssh-ed25519\ * ]] || fail "The answer holds no SSH public line."
printf '%s\n' "$SSH_PUB" | docker exec -i "$TARGET" sh -c 'cat > /home/omatalous/.ssh/authorized_keys && chown omatalous /home/omatalous/.ssh/authorized_keys && chmod 600 /home/omatalous/.ssh/authorized_keys'
api "$WORK/src.jar" -X PUT -d "{\"password\":\"$PASS\",\"enabled\":true,\"keyConfirmed\":true,\"host\":\"127.0.0.1\",\"port\":$SSH_PORT,\"user\":\"omatalous\",\"dir\":\"omatalous-copies\"}" "localhost:$SRC_PORT/api/admin/offsite" \
  | jq -e '.configured == true' >/dev/null || fail "The target was not saved."
say "ok   source install: keys made, the age secret kept outside it, the target saved"

# ── 2. the copy, run by the helper ──
export PATH="$WORK/bin:$PATH"
tick() { (cd "$WORK/$SRC" && OPS_TEST=1 ./scripts/ops-helper.sh) >"$WORK/helper.log" 2>&1 || fail "The helper failed: $(tail -n 30 "$WORK/helper.log")"; }
tick # the first tick tells the app the helper's version, which a request needs
# a copy the app queued by itself (the daily one, due as soon as the switch is on) may be under way: then the app refuses a second, and that copy is the one
api "$WORK/src.jar" -d "{\"password\":\"$PASS\"}" "localhost:$SRC_PORT/api/admin/offsite/run" >/dev/null || say "note the app had queued the copy itself"
from=$SECONDS
until docker exec "$TARGET" sh -c 'ls /home/omatalous/omatalous-copies/talous-*.db.gz.age' >/dev/null 2>&1; do
  ((SECONDS - from < 120)) || fail "No copy reached the target. Helper log: $(tail -n 12 "$WORK/$SRC/ops/helper.log" 2>&1) $(cd "$WORK/$SRC/ops" && tail -n 15 run/* journal/* 2>&1)"
  tick
  sleep 2
done
say "ok   the helper ran the copy: it is on the target"

# ── 3. what the target holds ──
mkdir "$WORK/fetched"
docker cp "$TARGET:/home/omatalous/omatalous-copies/." "$WORK/fetched/"
shopt -s nullglob
dbs=("$WORK"/fetched/talous-*.db.gz.age)
secs=("$WORK"/fetched/talous-*.app_secret.age)
((${#dbs[@]} >= 1 && ${#secs[@]} >= 1)) || fail "The target lacks the database copy or the secret copy."
[[ -z $(find "$WORK/fetched" -mindepth 1 -maxdepth 1 -name '*.part') ]] || fail "A half-uploaded file is left on the target."
SECRET=$(dc "$SRC" exec -T banking cat /secrets/app_secret)
for f in "${dbs[@]}" "${secs[@]}"; do
  [[ $(head -c 21 "$f") == age-encryption.org/v1 ]] || fail "$(basename "$f") is not an age file."
  grep -qaF "$SECRET" "$f" && fail "The app secret is readable in $(basename "$f")."
  grep -qaF "SQLite format" "$f" && fail "$(basename "$f") holds plain database bytes."
  grep -qaF "$AGE_SECRET" "$f" && fail "The age secret is in $(basename "$f")."
done
if dc "$SRC" exec -T banking grep -rqF "$AGE_SECRET" /data 2>/dev/null; then fail "The age secret is stored in the install."; fi
docker run --rm --entrypoint age-keygen "$TARGET:latest" >"$WORK/wrong.key" 2>/dev/null
if age -d -i "$WORK/wrong.key" "${dbs[0]}" >/dev/null 2>&1; then fail "A wrong key opened the copy."; fi
if age -d -i "$WORK/wrong.key" "${secs[0]}" >/dev/null 2>&1; then fail "A wrong key opened the secret."; fi
[[ $(age -d -i "$WORK/age.key" "${dbs[0]}" | gunzip -c | head -c 15) == "SQLite format 3" ]] || fail "The age key does not open the database copy."
[[ $(age -d -i "$WORK/age.key" "${secs[0]}") == "$SECRET" ]] || fail "The copied secret is not the app secret."
say "ok   the target holds age files only; a wrong key opens nothing, the saved key opens both, neither secret is in the copy"

# ── 4. nothing of the source, then the clean machine ──
dc "$SRC" down -v >/dev/null 2>&1 || fail "$SRC: could not be taken down."
docker rmi -f "$SRC:latest" >/dev/null 2>&1 || true
rm -rf "${WORK:?}/$SRC"
[[ -z $(docker ps -a -q --filter "name=^$SRC") && -z $(docker volume ls -q --filter "name=$SRC") ]] || fail "$SRC left a container or a volume."
NEW_PORT=$(free_port)
machine "$NEW" "$NEW_PORT"
curl -fsS "localhost:$NEW_PORT/api/auth/state" | jq -e '.needsSetup == true' >/dev/null || fail "$NEW is not empty."
[[ $(dc "$NEW" exec -T banking cat /secrets/app_secret) != "$SECRET" ]] || fail "$NEW has the old app secret."
# without the key restore.sh stops and changes nothing (HOME is the drill's, so no key file of the real user is found)
if (cd "$WORK/$NEW" && HOME=$WORK DOCKER_CONFIG="$DOCKER_CONFIG_DIR" ./scripts/restore.sh "${dbs[0]}" >/dev/null 2>&1 </dev/null); then fail "restore.sh opened an encrypted copy with no key."; fi
curl -fsS "localhost:$NEW_PORT/api/auth/state" | jq -e '.needsSetup == true' >/dev/null || fail "$NEW changed with no key given."
out=$(cd "$WORK/$NEW" && HOME=$WORK DOCKER_CONFIG="$DOCKER_CONFIG_DIR" ./scripts/restore.sh "${dbs[0]}" --key "$WORK/age.key" --secret "${secs[0]}" 2>&1 </dev/null) || fail "restore.sh failed: $(tail -n 6 <<<"$out")"
[[ $out == *"App secret put back."* ]] || fail "restore.sh did not put the app secret back: $(tail -n 6 <<<"$out")"
[[ $(dc "$NEW" exec -T banking cat /secrets/app_secret) == "$SECRET" ]] || fail "the app secret is not the old one."
wait_health "$NEW_PORT" "$NEW"
api "$WORK/new.jar" -d "{\"username\":\"ci-admin\",\"password\":\"$PASS\"}" "localhost:$NEW_PORT/api/auth/login" >/dev/null || fail "the first user cannot sign in after the restore."
api "$WORK/new.jar" "localhost:$NEW_PORT/api/admin/offsite" | jq -e '.configured == true and .host == "127.0.0.1"' >/dev/null \
  || fail "the sealed target did not open with the restored app secret."
say "ok   clean install restored from the copy and the age key: old app secret, first user signs in, the sealed target opens"

say "offsite drill ok: $IMAGE in $((SECONDS - STARTED)) s"
