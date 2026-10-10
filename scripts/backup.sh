#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous database backup.
#
#   ./scripts/backup.sh                 writes backups/talous-YYYYmmdd-HHMMSS.db.gz
#
# Backs up the instance in this clone directory (backups/ is per directory). With several
# instances, run it in each one, for example from a loop (docs/INSTALL.md).
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

die() { printf '%s varmuuskopio%s epäonnistui: %s\n' "$(date '+%F %T')" "$TAG" "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker puuttuu."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 puuttuu (docker compose version)."
[[ -n $(docker compose ps --status running -q banking 2>/dev/null) ]] || die "sovellus ei ole käynnissä (docker compose up -d)."
# an unencrypted copy must never replace the encrypted one the user asked for
if [[ -n ${BACKUP_AGE_RECIPIENT:-} ]]; then command -v age >/dev/null || die "BACKUP_AGE_RECIPIENT on asetettu mutta age puuttuu (sudo apt install age)."; fi

umask 077
mkdir -p "$OUT_DIR"

# A full disk stops any step below. Leave no half-written or plain-text leftovers behind.
cleanup() {
  local status=$?
  if ((status != 0)); then
    rm -f "$TARGET" "$TARGET.gz" "$TARGET.gz.age" "$SECRET_TARGET"
    docker compose exec -T banking node -e 'require("node:fs").rmSync("/data/backup.db", { force: true })' >/dev/null 2>&1 || true
    printf '%s varmuuskopio%s epäonnistui (onko levy täynnä?). Keskeneräiset tiedostot poistettiin.\n' "$(date '+%F %T')" "$TAG" >&2
  fi
}
trap cleanup EXIT

# VACUUM INTO writes a consistent copy of the live database (the path is an SQL string literal, so single quotes)
SNAPSHOT_JS=$(cat <<'JS'
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
fs.rmSync("/data/backup.db", { force: true });
new DatabaseSync("/data/banking.db").exec("VACUUM INTO '/data/backup.db'");
JS
)
docker compose exec -T banking node --disable-warning=ExperimentalWarning -e "$SNAPSHOT_JS"
docker compose cp banking:/data/backup.db "$TARGET" >/dev/null
chmod 600 "$TARGET" # docker cp keeps the container's 644
docker compose exec -T banking node -e 'require("node:fs").rmSync("/data/backup.db", { force: true })'
gzip -9 "$TARGET"

if [[ -n ${BACKUP_AGE_RECIPIENT:-} ]]; then
  age -r "$BACKUP_AGE_RECIPIENT" -o "$TARGET.gz.age" "$TARGET.gz"
  chmod 600 "$TARGET.gz.age"
  rm -f "$TARGET.gz"
  # the secret goes straight from the container into age, never to disk in plain text
  docker compose exec -T banking cat /secrets/app_secret | age -r "$BACKUP_AGE_RECIPIENT" -o "$SECRET_TARGET"
  echo "$(date '+%F %T') varmuuskopio$TAG: $TARGET.gz.age ja $SECRET_TARGET (salattu)"
else
  echo "$(date '+%F %T') varmuuskopio$TAG: $TARGET.gz (salausavainta ei mukana, säilytä se salasanojen hallinnassa)"
fi

find "$OUT_DIR" \( -name 'talous-*.db.gz*' -o -name 'talous-*.app_secret.age' \) -mtime +"$KEEP_DAYS" -delete
