#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous: restore a backup in one command.
#
#   ./scripts/restore.sh <file> [--secret <file>] [--key <age key file>]
#
# <file> is a database copy: a .db downloaded with Lataa uusin, or a .db.gz or .db.gz.age made by backup.sh. The kind
# is read from the file itself. An encrypted file is opened with --key, else ~/omatalous-backup.key, else the key file
# is asked for (a passphrase file makes age ask for the passphrase).
#
# Order, so that a bad file costs nothing: the file is checked and copied into the data volume while the app runs,
# then the app stops, `node dist/node.js restore` checks it again and swaps it in (the current database stays as
# backups/pre-restore-<time>.db in the volume), --secret puts the app secret back keeping the old one as
# app_secret.prev-<time> the way secret rotation does, the app starts, and `address set` writes APP_BASE_URL from .env
# (a database from another machine has that machine's address). Any failure after the stop starts the app again.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%s!%s %s\n' "$yellow" "$reset" "$*"; }
die()  { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
usage() { say "Usage: ./scripts/restore.sh <file.db|file.db.gz|file.db.gz.age> [--secret <app secret file>] [--key <age key file>]"; }

# paths are taken relative to where the command was typed, before the cd to the copy's folder
abs() { case $1 in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
FILE=""; SECRET_FILE=""; KEY=""
while (($#)); do
  case $1 in
    --secret) [[ -n ${2:-} ]] || { usage; exit 2; }; SECRET_FILE=$(abs "$2"); shift 2 ;;
    --key) [[ -n ${2:-} ]] || { usage; exit 2; }; KEY=$(abs "$2"); shift 2 ;;
    -h | --help) usage; exit 0 ;;
    -*) usage; exit 2 ;;
    *) [[ -z $FILE ]] || { usage; exit 2; }; FILE=$(abs "$1"); shift ;;
  esac
done
[[ -n $FILE ]] || { usage; exit 2; }
cd "$(dirname "$0")/.."

NODE=(node --disable-warning=ExperimentalWarning dist/node.js)
HEALTH_WAIT=${RESTORE_HEALTH_WAIT:-120}
# the same form secret rotation gives its .prev- files (toISOString without separators)
STAMP=$(date -u +%Y%m%dT%H%M%S)
NAME=$(basename "$FILE")

# sqlite, gzip, age or other, from the first bytes
kind() {
  local h
  h=$(LC_ALL=C head -c 15 "$1" | tr -d '\0')
  if [[ $h == "SQLite format 3" ]]; then echo sqlite
  elif [[ $(head -c 2 "$1" | od -An -tx1 | tr -d ' \n') == 1f8b ]]; then echo gzip
  else
    h=$(head -c 64 "$1" | tr -d '\0\r'); h=${h%%$'\n'*}
    if [[ $h == age-encryption.org/v1 || $h == "-----BEGIN AGE ENCRYPTED FILE-----" ]]; then echo age; else echo other; fi
  fi
}

# The age arguments for one file: a passphrase file needs none (age asks itself), a key file is found once.
AGE_ARGS=(); FILE_AGE=()
age_args() {
  local hdr
  command -v age >/dev/null || die "$(basename "$1") is encrypted and age is missing (sudo apt install age)."
  AGE_ARGS=()
  hdr=$(head -c 4096 "$1" | tr -d '\0')
  [[ $hdr != *$'\n-> scrypt '* ]] || return 0
  if [[ -z $KEY && -r $HOME/omatalous-backup.key ]]; then KEY=$HOME/omatalous-backup.key; fi
  if [[ -z $KEY ]]; then
    [[ -t 0 ]] || die "$(basename "$1") is encrypted. Give the key file made with age-keygen: --key <file>"
    read -r -p "The age key file that opens $(basename "$1") (made with age-keygen): " KEY || KEY=""
    # a typed ~/ is not expanded by read
    case $KEY in \~/*) KEY=$HOME/${KEY#\~/} ;; esac
    [[ -n $KEY ]] || die "No key file given. Nothing was changed."
    KEY=$(abs "$KEY")
  fi
  [[ -r $KEY ]] || die "The key file $KEY cannot be read. Nothing was changed."
  AGE_ARGS=(-i "$KEY")
}

[[ -f $FILE && -r $FILE ]] || die "$FILE is not a readable file."
[[ -z $SECRET_FILE || (-f $SECRET_FILE && -r $SECRET_FILE) ]] || die "$SECRET_FILE is not a readable file."

say "${bold}Omatalous restore${reset}  ${dim}folder $(pwd)${reset}"
step "Checking"
KIND=$(kind "$FILE")
case $KIND in
  sqlite) ok "$NAME is a database." ;;
  gzip)
    gzip -t "$FILE" 2>/dev/null || die "$NAME is damaged (gzip -t fails). Nothing was changed."
    [[ $(gunzip -c "$FILE" 2>/dev/null | head -c 15 | tr -d '\0' || true) == "SQLite format 3" ]] \
      || die "$NAME does not contain a database. Nothing was changed."
    ok "$NAME is a compressed database." ;;
  age) age_args "$FILE"; FILE_AGE=("${AGE_ARGS[@]}"); ok "$NAME is encrypted, it is opened while it is copied." ;;
  *) die "$NAME is not a database, nor a .db.gz or .db.gz.age made by backup.sh. Nothing was changed." ;;
esac

# The secret is checked before anything changes and stays in memory: it is never written to disk here in plain text.
SECRET=""
if [[ -n $SECRET_FILE ]]; then
  if [[ $(kind "$SECRET_FILE") == age ]]; then
    age_args "$SECRET_FILE"
    SECRET=$(age -d "${AGE_ARGS[@]}" "$SECRET_FILE") || die "age could not open $(basename "$SECRET_FILE"). Nothing was changed."
  else
    SECRET=$(tr -d '\0' <"$SECRET_FILE")
  fi
  # the app trims the file and wants 32 characters (entry/app-secret.ts)
  SECRET=${SECRET#"${SECRET%%[![:space:]]*}"}; SECRET=${SECRET%"${SECRET##*[![:space:]]}"}
  [[ ${#SECRET} -ge 32 && $SECRET != *$'\n'* ]] \
    || die "$(basename "$SECRET_FILE") is not an app secret (one line of at least 32 characters). Nothing was changed."
  ok "$(basename "$SECRET_FILE") holds an app secret."
fi

command -v docker >/dev/null || die "Docker is missing."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (docker compose version)."
docker info >/dev/null 2>&1 || die "Docker does not respond."
[[ -n $(docker compose ps -a -q banking 2>/dev/null) ]] || die "This folder has no installed app. Install it first: ./scripts/install.sh"

# do not race an install or update (they lock scripts/install.sh) or a maintenance helper action (ops/.lock)
exec 9<scripts/install.sh
if command -v flock >/dev/null && ! flock -n 9; then die "An install or update is running in this folder. Wait until it finishes."; fi
if [[ -f ops/.lock ]] && command -v flock >/dev/null; then
  exec 8>>ops/.lock
  flock -n 8 || die "A maintenance action is running (Asetukset > Ylläpito). Wait until it finishes."
fi

BASE_URL=""
[[ ! -f .env ]] || BASE_URL=$(grep -E '^APP_BASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '\r"'"'" || true)

UPLOAD=""; STOPPED=false
on_exit() {
  local rc=$?
  trap - EXIT
  # a copy restore did not take is not left in the data volume
  if [[ -n $UPLOAD ]]; then
    docker compose run --rm --no-deps -T --entrypoint sh banking -c 'rm -f "$1"' sh "$UPLOAD" </dev/null >/dev/null 2>&1 || true
  fi
  if $STOPPED; then
    if docker compose start banking </dev/null >/dev/null 2>&1; then say "The app was started again."
    else printf '%s✗ The app could not be started. Start it: docker compose start banking%s\n' "$red" "$reset" >&2; fi
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

step "Copying into the data volume"
# The copy is made while the app still runs, so a wrong key or a broken file never stops it. The container checks the
# header and removes a file that is not a database (exit 3). restore removes the copy once it is in place.
UPLOAD=/data/restore-$STAMP.db
UPLOAD_SH='umask 077
if ! cat > "$1"; then rm -f "$1"; exit 1; fi
if [ "$(head -c 15 "$1")" != "SQLite format 3" ]; then rm -f "$1"; exit 3; fi'
copy_in() { docker compose run --rm --no-deps -T --entrypoint sh banking -c "$UPLOAD_SH" sh "$UPLOAD"; }
set +e
case $KIND in
  sqlite) copy_in <"$FILE"; st=("$?") ;;
  gzip) gunzip -c "$FILE" | copy_in; st=("${PIPESTATUS[@]}") ;;
  age) age -d "${FILE_AGE[@]}" "$FILE" | gunzip -c | copy_in; st=("${PIPESTATUS[@]}") ;;
esac
set -e
if [[ $KIND == age ]] && ((st[0] != 0)); then die "age could not open $NAME (is it the right key?). Nothing was changed."; fi
if [[ $KIND == age ]] && ((st[1] != 0)); then die "$NAME does not contain a .db.gz made by backup.sh. Nothing was changed."; fi
if ((${st[-1]} == 3)); then die "$NAME does not contain a database. Nothing was changed."; fi
((${st[-1]} == 0)) || die "The copy into the data volume failed (is the disk full?). Nothing was changed."
ok "Copied."

step "Restoring"
STOPPED=true
docker compose stop banking </dev/null >/dev/null 2>&1 || die "The app could not be stopped. Nothing was changed."
ok "The app is stopped."
set +e
out=$(docker compose run --rm --no-deps -T banking "${NODE[@]}" restore "$UPLOAD" </dev/null 2>&1)
rc=$?
set -e
# restore's own last line says to start the app, which happens below
printf '%s\n' "$out" | grep -v '^Restored\. Start the app' | sed 's/^/  /' || true
((rc == 0)) || die "The restore was refused. The database is unchanged."
UPLOAD=""
CHECKED=$(printf '%s\n' "$out" | sed -n 's/^Checked [^:]*: ok, //p' | tail -1); CHECKED=${CHECKED%.}
PREVIOUS=$(printf '%s\n' "$out" | sed -n 's/^The current database is saved as //p' | tail -1)
ok "Database restored."

PREV_SECRET=""
if [[ -n $SECRET ]]; then
  # as secret rotation does: the old file stays as .prev-<stamp>, the new one comes in by a flushed rename
  SECRET_SH='set -e
umask 077
f=/secrets/app_secret
cat > "$f.next"
if [ -f "$f" ] && [ "$(cat "$f")" = "$(cat "$f.next")" ]; then rm -f "$f.next"; echo same; exit 0; fi
if [ -f "$f" ]; then cp "$f" "$f.prev-$1"; chmod 600 "$f.prev-$1"; sync "$f.prev-$1"; fi
chmod 600 "$f.next"
sync "$f.next"
mv "$f.next" "$f"
sync /secrets
if [ -f "$f.prev-$1" ]; then echo "prev app_secret.prev-$1"; else echo new; fi'
  if ! sec_out=$(printf '%s\n' "$SECRET" | docker compose run --rm --no-deps -T --entrypoint sh banking -c "$SECRET_SH" sh "$STAMP" 2>&1); then
    die "The database was restored, but the app secret could not be written ($(printf '%s' "$sec_out" | tail -1)). The saved bank keys stay locked until it is: run this again with --secret."
  fi
  case $sec_out in
    *same*) ok "The app secret is already this one." ;;
    *prev*) PREV_SECRET=${sec_out##*prev }; ok "App secret put back." ;;
    *) ok "App secret written." ;;
  esac
fi

step "Starting"
docker compose start banking </dev/null >/dev/null 2>&1 || die "The database was restored, but the app could not be started."
STOPPED=false
app_up() { docker compose exec -T banking wget -qO- http://127.0.0.1:8080/api/health </dev/null >/dev/null 2>&1; }
wait_up() { local t=0; until app_up; do ((t < HEALTH_WAIT)) || return 1; sleep 2; t=$((t + 2)); done; }
UP=true
if wait_up; then ok "The app is running."; else UP=false; warn "The app does not respond after $HEALTH_WAIT s."; fi

# A database from another machine or an older copy carries the address it had. The server caches it, so the app
# restarts when it changed (install.sh does the same).
if ! $UP; then
  :
elif [[ -z $BASE_URL ]]; then
  warn "APP_BASE_URL is not in .env. Check Sovelluksen osoite under Asetukset > Palvelin."
elif addr_out=$(docker compose exec -T banking "${NODE[@]}" address set "$BASE_URL" </dev/null 2>&1); then
  ok "$(printf '%s' "$addr_out" | tail -1)"
  if [[ $addr_out == *" is now "* ]]; then
    docker compose restart banking </dev/null >/dev/null 2>&1 || true
    wait_up || { UP=false; warn "The app does not respond after the restart."; }
  fi
else
  warn "Could not set the app address ($(printf '%s' "$addr_out" | tail -1)). Set it under Asetukset > Palvelin."
fi

step "Done"
say "Restored $NAME${CHECKED:+ ($CHECKED)}."
if [[ -n $PREVIOUS ]]; then
  say "The previous database is in the data volume as ${PREVIOUS#/data/}. To go back to it, restore it as"
  say "one of the app's own copies: docs/ADVANCED.md#restore-a-backup"
else
  say "There was no previous database."
fi
[[ -z $PREV_SECRET ]] || say "The previous app secret is in the secrets volume as $PREV_SECRET."
# backup.sh writes the secret of a backup next to it under the same time
if [[ -z $SECRET_FILE && $NAME =~ ^talous-([0-9]+-[0-9]+)\.db ]]; then
  sibling=$(dirname "$FILE")/talous-${BASH_REMATCH[1]}.app_secret.age
  [[ ! -f $sibling ]] || say "If this backup is from another machine, add --secret $sibling or the saved bank keys stay locked."
fi
$UP || die "The database was restored, but the app does not respond. Run: ./scripts/doctor.sh"
