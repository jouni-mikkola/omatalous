#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous database backup.
#
#   ./scripts/backup.sh                      writes backups/talous-YYYYmmdd-HHMMSS.db.gz
#   ./scripts/backup.sh --schedule [HH:MM]   runs it every day at that time (03:30 without one) from the crontab
#   ./scripts/backup.sh --unschedule         takes that crontab line away
#
# Backs up the instance in this clone directory (backups/ is per directory). With several
# instances, run it in each one, for example from a loop (docs/ADVANCED.md#backups).
#
# Takes a consistent snapshot while the app runs (SQLite VACUUM INTO), copies
# it out of the container, compresses it and keeps the last $KEEP_DAYS days (7 without a setting; KEEP_DAYS=30 in
# .env keeps a month).
# If BACKUP_AGE_RECIPIENT is set (an age public key), `age` must be installed:
# the backup is encrypted and only the encrypted file is kept.
# If BACKUP_COPY_TO is set (a folder, for example a mounted NAS share), the new files are copied there after a good
# backup, but only when the folder is on a mounted drive and writable. Otherwise the script warns and the local
# backup stays; the exit status is still 0.
#
# These settings come from the shell, or from this folder's .env when the shell has none. The scheduled run and the
# Ylläpito button run with an empty environment, so .env is where they find them:
#   BACKUP_AGE_RECIPIENT=age1...
#   BACKUP_COPY_TO=/mnt/nas/omatalous
#   KEEP_DAYS=30
#
# --schedule writes one crontab line for this folder, ending in `# talous-backup:<folder>`. A second run replaces it and
# the lines of other folders and of the user stay.
#
# The app secret (/secrets/app_secret in the banking-secrets volume) is needed to
# open the bank keys stored in the database after a restore. With age it is
# backed up too, encrypted, as a separate file. Without age it is NOT copied
# next to the database: keep it in a password manager instead
#   docker compose exec banking cat /secrets/app_secret
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd -P)

# A setting from the shell, else from .env. .env is read as data (the last NAME= line), never run as a script.
setting() { # setting NAME
  local v=${!1:-}
  [[ -z $v ]] && v=$(dotenv "$1")
  printf '%s' "$v"
}
dotenv() { # dotenv NAME: the value in .env, without quotes, a trailing comment or surrounding spaces
  local v
  [[ -f .env ]] || return 0
  v=$(grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '\r' || true)
  v=${v#"${v%%[![:space:]]*}"}
  case $v in
    \"*\" | \'*\') v=${v:1:${#v}-2} ;;
    *) v=${v%% \#*} ;;
  esac
  v=${v%"${v##*[![:space:]]}"}
  printf '%s' "$v"
}

# ── --schedule and --unschedule: one crontab line per folder, found by the marker at the end of the line ──
sdie() { printf 'backup.sh: %s\n' "$*" >&2; exit 1; }
cron_marker() { printf '# talous-backup:%s' "$ROOT"; }
CRON_NOW=""
load_crontab() {
  command -v crontab >/dev/null || sdie "crontab is missing (sudo apt install cron)."
  if ! CRON_NOW=$(LC_ALL=C crontab -l 2>&1); then
    [[ $CRON_NOW == "no crontab"* ]] || sdie "could not read the crontab: $CRON_NOW"
    CRON_NOW=""
  fi
}
# the crontab on stdin without this folder's line (an exact match on the marker at the end of the line)
cron_without() { awk -v m="$(cron_marker)" '{ n = length($0) - length(m); if (n >= 0 && substr($0, n + 1) == m) next; print }'; }
save_crontab() { # save_crontab TEXT: the user's whole crontab, or none when TEXT is empty
  if [[ -n $1 ]]; then printf '%s\n' "$1" | crontab - || sdie "could not write the crontab."; else crontab -r 2>/dev/null || true; fi
}
schedule() { # schedule [HH:MM]
  local when=${1:-03:30} h m rest line
  [[ $when =~ ^([01]?[0-9]|2[0-3]):([0-5][0-9])$ ]] || sdie "the time is written HH:MM, for example 03:30 (got: $when)."
  h=$((10#${BASH_REMATCH[1]})); m=$((10#${BASH_REMATCH[2]}))
  # the folder goes into a crontab line: only plain characters
  [[ $ROOT =~ ^/[A-Za-z0-9_./-]+$ ]] || sdie "the folder path has characters a crontab line does not allow ($ROOT). Move the install to a path without spaces and special characters."
  line=$(printf '%d %d * * * cd %s && ./scripts/backup.sh >> backups/backup.log 2>&1 %s' "$m" "$h" "$ROOT" "$(cron_marker)")
  load_crontab
  rest=$(printf '%s\n' "$CRON_NOW" | cron_without)
  (umask 077; mkdir -p backups) # the line writes its log there
  save_crontab "${rest:+$rest$'\n'}$line"
  echo "Scheduled: every day at $(printf '%02d:%02d' "$h" "$m"), in $ROOT. Look at it with: crontab -l"
  # what the scheduled run will do, as it reads its settings: the shell's are not there
  if [[ -n $(dotenv BACKUP_AGE_RECIPIENT) ]]; then echo "Encrypted: yes, with BACKUP_AGE_RECIPIENT from .env. The app secret is saved with it."
  elif [[ -n ${BACKUP_AGE_RECIPIENT:-} ]]; then echo "Encrypted: no. BACKUP_AGE_RECIPIENT is set in this shell only and the scheduled run does not see it. Put the line BACKUP_AGE_RECIPIENT=... in $ROOT/.env."
  else echo "Encrypted: no, and the app secret is not saved. To encrypt, put the line BACKUP_AGE_RECIPIENT=<age public key> in $ROOT/.env (docs/ADVANCED.md#backups)."; fi
  if [[ -n $(dotenv BACKUP_COPY_TO) ]]; then echo "Copied to: $(dotenv BACKUP_COPY_TO), when that folder is on a mounted drive."
  elif [[ -n ${BACKUP_COPY_TO:-} ]]; then echo "Copied elsewhere: no. BACKUP_COPY_TO is set in this shell only and the scheduled run does not see it. Put the line BACKUP_COPY_TO=... in $ROOT/.env."
  else echo "Copied elsewhere: no. To copy to a NAS, put the line BACKUP_COPY_TO=<mounted folder> in $ROOT/.env (docs/ADVANCED.md#backups)."; fi
}
unschedule() {
  local rest
  load_crontab
  rest=$(printf '%s\n' "$CRON_NOW" | cron_without)
  if [[ $rest == "$CRON_NOW" ]]; then echo "No daily backup is scheduled for $ROOT."; return; fi
  save_crontab "$rest"
  echo "Removed the daily backup of $ROOT from the crontab."
}
case ${1:-} in
  "") ;;
  --schedule) (($# <= 2)) || sdie "usage: ./scripts/backup.sh --schedule [HH:MM]"; schedule "${2:-}"; exit 0 ;;
  --unschedule) (($# == 1)) || sdie "usage: ./scripts/backup.sh --unschedule"; unschedule; exit 0 ;;
  -h | --help) echo "usage: ./scripts/backup.sh [--schedule [HH:MM] | --unschedule]"; exit 0 ;;
  *) sdie "usage: ./scripts/backup.sh [--schedule [HH:MM] | --unschedule]" ;;
esac

BACKUP_AGE_RECIPIENT=$(setting BACKUP_AGE_RECIPIENT)
BACKUP_COPY_TO=$(setting BACKUP_COPY_TO)
KEEP_DAYS=$(setting KEEP_DAYS)
KEEP_DAYS=${KEEP_DAYS:-7}
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
warn() { printf '%s backup%s warning: %s\n' "$(date '+%F %T')" "$TAG" "$*" >&2; }

# Copies this run's files to BACKUP_COPY_TO, once the backup is good. A drive that is not mounted leaves an ordinary
# folder on the local disk, so the target has to be on a mount point (the target or a parent, not /) and writable.
# Each file is copied under a hidden name, compared and renamed, so a full share never leaves a cut-short backup
# behind. Nothing is written through a link on the share (see the loop). Returns 1 with a warning when it could not;
# the caller keeps the local backup either way.
copy_out() {
  local dest d f base part probe n=0 mounted=0 files=()
  for f in "$TARGET.gz" "$TARGET.gz.age" "$SECRET_TARGET"; do [[ ! -e $f ]] || files+=("$f"); done
  [[ $BACKUP_COPY_TO == /* ]] || { warn "BACKUP_COPY_TO has to be a full path starting with / (got: $BACKUP_COPY_TO). Nothing was copied, the backup is in $OUT_DIR."; return 1; }
  command -v mountpoint >/dev/null || { warn "mountpoint is missing (sudo apt install util-linux), so nothing was copied to $BACKUP_COPY_TO. The backup is in $OUT_DIR."; return 1; }
  dest=$(realpath -m -- "$BACKUP_COPY_TO")
  d=$dest
  while [[ $d != / ]]; do
    if timeout 20 mountpoint -q "$d" 2>/dev/null; then mounted=1; break; fi
    d=$(dirname "$d")
  done
  ((mounted)) || { warn "$dest is not on a mounted drive (is the NAS mounted?), so nothing was copied. The backup is in $OUT_DIR."; return 1; }
  # The write test is a file mktemp makes under a new random name (created exclusively), so a link someone put at a
  # fixed name on the share is never written through.
  if ! timeout 60 mkdir -p -- "$dest" 2>/dev/null || ! probe=$(timeout 60 mktemp -- "$dest/.talous-write-test.XXXXXX" 2>/dev/null); then
    warn "$dest is not writable, so nothing was copied. The backup is in $OUT_DIR."; return 1
  fi
  rm -f -- "$probe"
  for f in "${files[@]}"; do
    base=${f##*/}
    part=$dest/.$base.part
    # Whoever can write to the share may have put a link at a name this script uses (the names follow from the time).
    # A link at the final name is refused. cp --remove-destination unlinks the part name first and creates the file
    # exclusively, so a link there is removed and never followed. mv -fT renames onto the final name and never moves
    # into a folder a link points to; a rename replaces a link and does not write through it.
    if [[ -L $dest/$base ]]; then
      warn "$dest/$base is a link, so $base was not copied. The backup is in $OUT_DIR."; return 1
    fi
    if timeout 120 cp -T --remove-destination -- "$f" "$part" 2>/dev/null && [[ -f $part && ! -L $part ]] && cmp -s -- "$f" "$part" && mv -fT -- "$part" "$dest/$base"; then
      n=$((n + 1))
    else
      rm -f -- "$part"
      warn "could not copy $base to $dest (is the share full?). The backup is in $OUT_DIR."; return 1
    fi
  done
  echo "$(date '+%F %T') backup$TAG: $n file(s) copied to $dest"
}

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

# the local backup is good: a copy that fails is a warning and changes neither the files nor the exit status
if [[ -n $BACKUP_COPY_TO ]]; then copy_out || true; fi

# Only now, with this run's good copy in place: a run that failed above never gets here, and a machine that was off for
# weeks keeps its old files until a new one is made. Only plain files of this folder, in the names this script writes;
# this run's own files are never candidates. -mtime +N counts whole 24 hour periods and rounds down, so +7 deletes a
# file at 192 hours (8 days) and keeps one of 191 hours 59 minutes. The folder of BACKUP_COPY_TO is not pruned.
if [[ $KEEP_DAYS =~ ^[0-9]+$ ]]; then
  find "$OUT_DIR" -maxdepth 1 -type f \( -name 'talous-*.db.gz*' -o -name 'talous-*.app_secret.age' \) ! -name "talous-$STAMP.*" -mtime +"$KEEP_DAYS" -delete
else
  warn "KEEP_DAYS is '$KEEP_DAYS', not a whole number of days, so no old backup was deleted."
fi
