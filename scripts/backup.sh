#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous database backup.
#
#   ./scripts/backup.sh                 writes backups/talous-YYYYmmdd-HHMMSS.db.gz
#
# Backs up the instance in this clone directory (backups/ is per directory). With several
# instances, run it in each one, for example from a loop (docs/ADVANCED.md#backups).
#
# Takes a consistent snapshot while the app runs (SQLite VACUUM INTO), copies
# it out of the container, compresses it and keeps the last $KEEP_DAYS days.
# If BACKUP_AGE_RECIPIENT is set (an age public key), `age` must be installed:
# the backup is encrypted and only the encrypted file is kept.
#
# Daily at 03:30 (crontab -e):
#   30 3 * * * cd /home/<you>/banking-app && ./scripts/backup.sh >> backups/backup.log 2>&1
#
# The app secret (/secrets/app_secret in the banking-secrets volume) is needed to
# open the bank keys stored in the database after a restore. With age it is
# backed up too, encrypted, as a separate file. Without age it is NOT copied
# next to the database: keep it in a password manager instead
#   docker compose exec banking cat /secrets/app_secret
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

KEEP_DAYS=${KEEP_DAYS:-30}
OUT_DIR=${BACKUP_DIR:-backups}
STAMP=$(date +%Y%m%d-%H%M%S)
TARGET="$OUT_DIR/talous-$STAMP.db"
SECRET_TARGET="$OUT_DIR/talous-$STAMP.app_secret.age"

# instance name from the shell or .env (as data); shown in messages when it is not the default
NAME=${INSTANCE_NAME:-}
[[ -n $NAME || ! -f .env ]] || NAME=$(grep -E '^INSTANCE_NAME=' .env | tail -1 | cut -d= -f2- || true)
NAME=${NAME:-banking-app}
TAG=""; [[ $NAME == banking-app ]] || TAG=" [$NAME]"

die() { printf '%s backup%s failed: %s\n' "$(date '+%F %T')" "$TAG" "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker is missing."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (docker compose version)."
[[ -n $(docker compose ps --status running -q banking 2>/dev/null) ]] || die "the app is not running (docker compose up -d)."
# an unencrypted copy must never replace the encrypted one the user asked for
if [[ -n ${BACKUP_AGE_RECIPIENT:-} ]]; then command -v age >/dev/null || die "BACKUP_AGE_RECIPIENT is set but age is missing (sudo apt install age)."; fi

umask 077
mkdir -p "$OUT_DIR"

# A full disk stops any step below. Leave no half-written or plain-text leftovers behind.
cleanup() {
  local status=$?
  if ((status != 0)); then
    rm -f "$TARGET" "$TARGET.gz" "$TARGET.gz.age" "$SECRET_TARGET"
    docker compose exec -T banking node -e 'require("node:fs").rmSync("/data/backup.db", { force: true })' >/dev/null 2>&1 || true
    printf '%s backup%s failed (is the disk full?). Unfinished files were removed.\n' "$(date '+%F %T')" "$TAG" >&2
  fi
}
trap cleanup EXIT

# A consistent copy of the live database (VACUUM INTO), checked inside the container (size, quick_check, tables)
# and removed there when it fails; the shared code is in scripts/lib/dbcopy.sh. A copy that was cut short on the
# way out is caught by comparing sizes, and the compressed file by gzip -t.
# shellcheck source=lib/dbcopy.sh
. scripts/lib/dbcopy.sh
docker compose exec -T banking node --disable-warning=ExperimentalWarning -e "$DBCOPY_JS" - /data/backup.db
want=$(docker compose exec -T banking node -e 'console.log(require("node:fs").statSync("/data/backup.db").size)' | tr -d '\r')
docker compose cp banking:/data/backup.db "$TARGET" >/dev/null
chmod 600 "$TARGET" # docker cp keeps the container's 644
docker compose exec -T banking node -e 'require("node:fs").rmSync("/data/backup.db", { force: true })'
[[ $(stat -c %s "$TARGET") == "$want" && $want -ge 4096 ]] || die "the copy that came out of the container is $(stat -c %s "$TARGET") bytes, expected $want."
[[ $(head -c 15 "$TARGET") == "SQLite format 3" ]] || die "the copy is not a SQLite file."
gzip -9 "$TARGET"
gzip -t "$TARGET.gz" || die "the compressed copy does not pass gzip -t."

if [[ -n ${BACKUP_AGE_RECIPIENT:-} ]]; then
  age -r "$BACKUP_AGE_RECIPIENT" -o "$TARGET.gz.age" "$TARGET.gz"
  [[ -s $TARGET.gz.age ]] || die "age wrote an empty file."
  chmod 600 "$TARGET.gz.age"
  rm -f "$TARGET.gz"
  # the secret goes straight from the container into age, never to disk in plain text
  docker compose exec -T banking cat /secrets/app_secret | age -r "$BACKUP_AGE_RECIPIENT" -o "$SECRET_TARGET"
  echo "$(date '+%F %T') backup$TAG: $TARGET.gz.age and $SECRET_TARGET (encrypted)"
else
  echo "$(date '+%F %T') backup$TAG: $TARGET.gz (app secret not included, keep it in a password manager)"
fi

# the finished files and their folder survive a power cut (fsync_path is in scripts/lib/dbcopy.sh)
for f in "$TARGET.gz" "$TARGET.gz.age" "$SECRET_TARGET"; do [[ ! -e $f ]] || fsync_path "$f"; done
fsync_path "$OUT_DIR"

find "$OUT_DIR" \( -name 'talous-*.db.gz*' -o -name 'talous-*.app_secret.age' \) -mtime +"$KEEP_DAYS" -delete
