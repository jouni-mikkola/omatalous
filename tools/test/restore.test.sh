#!/usr/bin/env bash
# Tests for scripts/restore.sh with docker and age stubbed. A world is a clone with the script, a .env, and a fake
# data and secrets volume. The docker stub runs the `sh -c` scripts on the fake volumes (paths mapped), plays
# `node dist/node.js restore` the way db/restore.ts answers, plays `secret check` against the secret the restored
# database is sealed with (V/sealed-with, no file = no bank keys stored), and logs every call to S/log for order checks.
#
#   tools/test/restore.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
FILTER=${1:-}
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n" "$(tail -n 4 "$W/out" 2>/dev/null | tr '\n' '|')"; fi; }
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT

stubs() { # stubs DIR
  cat >"$1/docker" <<'STUB'
#!/usr/bin/env bash
S=$(cd "$(dirname "$0")" && pwd); V=$S/../vol
printf 'docker %s\n' "$*" >>"$S/log"
flag() { [[ -e $S/flag-$1 ]]; }
map() { local a=$1; a=${a//\/tmp/$V/tmp}; a=${a//\/secrets/$V/secrets}; a=${a//\/data/$V/data}; printf '%s' "$a"; }
[[ $1 == compose ]] || exit 0
shift
case $1 in
  version) exit 0 ;;
  ps) flag no-container || echo c0ffee; exit 0 ;;
  stop) rm -f "$S/running"; exit 0 ;;
  start | restart) flag start-fails && { echo "start failed" >&2; exit 1; }; touch "$S/running"; exit 0 ;;
  exec)
    [[ -e $S/running ]] || { echo "service banking is not running" >&2; exit 1; }
    case "$*" in
      *wget*) flag unhealthy && exit 1; exit 0 ;;
      *"address set"*)
        url=${*: -1}
        if [[ $(cat "$V/address" 2>/dev/null) == "$url" ]]; then echo "App address is already $url."
        else echo "$url" >"$V/address"; echo "App address is now $url."; fi
        exit 0 ;;
    esac
    exit 1 ;;
  run)
    shift; ep=""
    while [[ $1 == -* ]]; do if [[ $1 == --entrypoint ]]; then ep=$2; shift 2; else shift; fi; done
    shift # the service
    if [[ $ep == sh ]]; then
      script=$(map "$2"); shift 2
      args=(); for a in "$@"; do args+=("$(map "$a")"); done
      exec sh -c "$script" "${args[@]}"
    fi
    [[ " $* " == *" restore "* ]] || exit 2
    f=$(map "${*: -1}")
    [[ -e $S/running ]] && echo "RESTORE WHILE RUNNING" >>"$S/log"
    if flag restore-fails || [[ $(head -c 15 "$f") != "SQLite format 3" ]]; then
      echo "$(basename "$f") is not a usable database: quick_check failed. Nothing was changed." >&2; exit 1
    fi
    echo "Checked $(basename "$f"): ok, 2 users, 31 migrations."
    if [[ -s $V/data/banking.db ]]; then
      mkdir -p "$V/data/backups"; cp "$V/data/banking.db" "$V/data/backups/pre-restore-20261011T101530.db"
      echo "The current database is saved as /data/backups/pre-restore-20261011T101530.db"
    fi
    mv "$f" "$V/data/banking.db"
    echo "Restored. Start the app: docker compose start banking"
    exit 0 ;;
esac
exit 0
STUB
  # age -d [-i KEY] FILE: the fake format is the age header, a stanza line naming the key, then the payload
  cat >"$1/age" <<'STUB'
#!/usr/bin/env bash
S=$(cd "$(dirname "$0")" && pwd)
printf 'age %s\n' "$*" >>"$S/log"
key=""; f=""
while (($#)); do case $1 in -d | --decrypt) shift ;; -i) key=$2; shift 2 ;; *) f=$1; shift ;; esac; done
[[ $(head -n 1 "$f") == age-encryption.org/v1 ]] || { echo "age: error: no age header" >&2; exit 1; }
stanza=$(sed -n 2p "$f")
if [[ $stanza == "-> scrypt "* ]]; then [[ -z $key ]] || { echo "age: error: a passphrase file with -i" >&2; exit 1; }
else
  [[ -r $key ]] || { echo "age: error: missing identity" >&2; exit 1; }
  [[ $stanza == "-> X25519 $(cat "$key")" ]] || { echo "age: error: no identity matched any of the recipients" >&2; exit 1; }
fi
tail -n +3 "$f"
STUB
  # node dist/node.js secret check FILE: exit 0 when the file holds the secret the restored database is sealed with (or
  # none is stored), 4 when it holds another, 1 when the check could not run: the statuses of cli.ts. The sentences are
  # the stub's own, since restore.sh reads the status and only shows the last line. Never prints the secret.
  cat >"$1/node" <<'STUB'
#!/usr/bin/env bash
S=$(cd "$(dirname "$0")" && pwd); V=$S/../vol
printf 'node %s\n' "$*" >>"$S/log"
[[ " $* " == *" secret check "* ]] || exit 2
[[ -e $S/running ]] && echo "CHECK WHILE RUNNING" >>"$S/log"
grep -aq BACKUP "$V/data/banking.db" || echo "CHECK BEFORE THE SWAP" >>"$S/log"
if [[ -e $S/flag-check-crashes ]]; then echo "Could not open the database. disk I/O error" >&2; exit 1; fi
f=${*: -1}
[[ -r $f ]] || { echo "The secret file cannot be read. Give its path: secret check <file>" >&2; exit 1; }
if [[ ! -e $V/sealed-with || $(tr -d '\n' <"$f") == "$(tr -d '\n' <"$V/sealed-with")" ]]; then echo "The secret fits the stored bank keys."; exit 0; fi
echo "Not the secret of this database." >&2; exit 4
STUB
  printf '#!/bin/sh\nexit 0\n' >"$1/sleep"
  chmod +x "$1/docker" "$1/age" "$1/node" "$1/sleep"
}

new_world() {
  W=$(mktemp -d "$ROOT/w.XXXX"); CL=$W/clone; S=$W/stub; V=$W/vol
  mkdir -p "$CL/scripts/lib" "$S" "$V/data" "$V/secrets" "$V/tmp" "$W/home" "$W/files"
  cp "$SRC/scripts/restore.sh" "$CL/scripts/"; echo '# lock' >"$CL/scripts/install.sh"
  cp "$SRC/scripts/lib/release.sh" "$CL/scripts/lib/" # installer_lock
  printf 'INSTANCE_NAME=banking-app\nAPP_BASE_URL=https://talous.example.test\n' >"$CL/.env"
  stubs "$S"; touch "$S/running" "$S/log"
  mkdb "$V/data/banking.db" CURRENT
  printf 'old-secret-0123456789abcdefghijklmnopqrstuvwxyz\n' >"$V/secrets/app_secret"; chmod 600 "$V/secrets/app_secret"
  echo https://old.example.test >"$V/address"
  echo testkey >"$W/home/omatalous-backup.key"
}
mkdb() { { printf 'SQLite format 3\0'; printf '%s' "$2"; head -c 4000 /dev/zero; } >"$1"; }
agefile() { { echo age-encryption.org/v1; echo "-> X25519 ${3:-testkey}"; cat "$2"; } >"$1"; }
# run_restore ARGS...: in a folder that is not the clone, as a user would from Downloads
run_restore() {
  (cd "$W/files" && PATH="$S:$PATH" HOME="$W/home" RESTORE_HEALTH_WAIT=4 bash "$CL/scripts/restore.sh" "$@" </dev/null >"$W/out" 2>&1)
  echo $? >"$W/rc"
}
rc_is() { [[ $(cat "$W/rc") == "$1" ]]; }
out_has() { grep -qF -- "$1" "$W/out"; }
db_is() { grep -aq "$1" "$V/data/banking.db"; }
running() { [[ -e $S/running ]]; }
no_upload_left() { ! compgen -G "$V/data/restore-*.db" >/dev/null; }
log_has() { grep -qF -- "$1" "$S/log"; }
# before A B: the first line with A comes before the last line with B
before() { local a b; a=$(grep -nF -- "$1" "$S/log" | head -1 | cut -d: -f1); b=$(grep -nF -- "$2" "$S/log" | tail -1 | cut -d: -f1); [[ -n $a && -n $b ]] && ((a < b)); }
restored_ok() { # the common outcome of a good restore
  local what=$1
  check "$what: exit 0" rc_is 0
  check "$what: the database is the backup" db_is BACKUP
  check "$what: the old database is the pre-restore copy" grep -aq CURRENT "$V/data/backups/pre-restore-20261011T101530.db"
  check "$what: stopped, restored, started in that order" bash -c "$(declare -f before); S='$S'; before 'compose stop banking' ' restore /data/restore-' && before ' restore /data/restore-' 'compose start banking'"
  check "$what: never restored while the app ran" bash -c "! grep -q 'RESTORE WHILE RUNNING' '$S/log'"
  check "$what: the app runs at the end" running
  check "$what: the copy in the data volume is gone" no_upload_left
  check "$what: the address from .env was set" bash -c "[[ \$(cat '$V/address') == https://talous.example.test ]]"
  check "$what: a changed address restarts the app" log_has "compose restart banking"
  check "$what: says what was restored" out_has "Restored $2 (2 users, 31 migrations)."
  check "$what: says where the previous copy is" out_has "The previous database is in the data volume as backups/pre-restore-20261011T101530.db"
}

t_plain_db() {
  new_world; mkdb "$W/files/auto-2026-10-09.db" BACKUP
  run_restore auto-2026-10-09.db
  restored_ok ".db" auto-2026-10-09.db
  check ".db: the secret is untouched without --secret" bash -c "grep -q old-secret '$V/secrets/app_secret' && ! compgen -G '$V/secrets/app_secret.prev-*' >/dev/null"
}
t_gz() {
  new_world; mkdb "$W/b.db" BACKUP; mkdir -p "$W/files/backups"; gzip -c "$W/b.db" >"$W/files/backups/talous-20261009-033000.db.gz"
  run_restore backups/talous-20261009-033000.db.gz
  restored_ok ".db.gz" talous-20261009-033000.db.gz
  check ".db.gz: no secret hint without a secret file next to it" bash -c "! grep -q -- '--secret' '$W/out'"
}
t_age() {
  new_world; mkdb "$W/b.db" BACKUP; gzip -c "$W/b.db" >"$W/b.gz"
  agefile "$W/files/talous-20261009-033000.db.gz.age" "$W/b.gz"
  printf 'new-secret-0123456789abcdefghijklmnopqrstuvwxyz\n' >"$W/s"; agefile "$W/files/talous-20261009-033000.app_secret.age" "$W/s"
  run_restore talous-20261009-033000.db.gz.age
  restored_ok ".db.gz.age with ~/omatalous-backup.key" talous-20261009-033000.db.gz.age
  check ".db.gz.age: decrypted before the app was stopped" before "age -d -i $W/home/omatalous-backup.key" "compose stop banking"
  check ".db.gz.age: names the secret file next to it" out_has "add --secret $W/files/talous-20261009-033000.app_secret.age"
  new_world; mkdb "$W/b.db" BACKUP; gzip -c "$W/b.db" >"$W/b.gz"; agefile "$W/files/x.db.gz.age" "$W/b.gz" otherkey
  echo otherkey >"$W/files/other.key"
  run_restore x.db.gz.age --key other.key
  check "--key: the given key file opens it" bash -c "[[ \$(cat '$W/rc') == 0 ]] && grep -aq BACKUP '$V/data/banking.db'"
  new_world; mkdb "$W/b.db" BACKUP; gzip -c "$W/b.db" >"$W/b.gz"
  { echo age-encryption.org/v1; echo "-> scrypt salt 18"; cat "$W/b.gz"; } >"$W/files/p.db.gz.age"; rm "$W/home/omatalous-backup.key"
  run_restore p.db.gz.age
  check "a passphrase file goes to age without a key (age asks)" bash -c "[[ \$(cat '$W/rc') == 0 ]] && grep -q '^age -d $W/files/p.db.gz.age' '$S/log'"
}
t_age_without_key() {
  new_world; mkdb "$W/b.db" BACKUP; gzip -c "$W/b.db" >"$W/b.gz"; agefile "$W/files/x.db.gz.age" "$W/b.gz"; rm "$W/home/omatalous-backup.key"
  run_restore x.db.gz.age
  check "no key and no terminal: refused with how to give one" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q -- '--key <file>' '$W/out'"
  check "no key: the app was never stopped" bash -c "! grep -q 'compose stop' '$S/log'"
  new_world; mkdb "$W/b.db" BACKUP; gzip -c "$W/b.db" >"$W/b.gz"; agefile "$W/files/x.db.gz.age" "$W/b.gz" otherkey
  run_restore x.db.gz.age
  check "the wrong key: refused, nothing changed" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'is it the right key' '$W/out' && grep -aq CURRENT '$V/data/banking.db'"
  check "the wrong key: the app was never stopped, no copy left" bash -c "! grep -q 'compose stop' '$S/log' && ! compgen -G '$V/data/restore-*.db' >/dev/null"
}
t_failed_restore_starts_app() {
  new_world; mkdb "$W/files/a.db" BACKUP; touch "$S/flag-restore-fails"
  printf 'new-secret-0123456789abcdefghijklmnopqrstuvwxyz\n' >"$W/files/secret"
  run_restore a.db --secret secret
  check "a refused restore: exit is not 0" bash -c "[[ \$(cat '$W/rc') != 0 ]]"
  check "a refused restore: restore's reason is shown" out_has "is not a usable database"
  check "a refused restore: says the database is unchanged" out_has "The restore was refused. The database is unchanged."
  check "a refused restore: the database is unchanged" db_is CURRENT
  check "a refused restore: the app was started again after the stop" bash -c "$(declare -f before); S='$S'; before 'compose stop banking' 'compose start banking'"
  check "a refused restore: the app runs" running
  check "a refused restore: the copy is removed from the data volume" no_upload_left
  check "a refused restore: the secret is not touched" bash -c "grep -q old-secret '$V/secrets/app_secret' && ! compgen -G '$V/secrets/app_secret.prev-*' >/dev/null"
}
t_secret_kept_as_prev() {
  new_world; mkdb "$W/b.db" BACKUP; gzip -c "$W/b.db" >"$W/b.gz"; agefile "$W/files/talous-20261009-033000.db.gz.age" "$W/b.gz"
  printf 'new-secret-0123456789abcdefghijklmnopqrstuvwxyz\n' >"$W/s"; agefile "$W/files/talous-20261009-033000.app_secret.age" "$W/s"
  run_restore talous-20261009-033000.db.gz.age --secret talous-20261009-033000.app_secret.age
  check "--secret: exit 0" rc_is 0
  check "--secret: the new secret is in place" grep -q '^new-secret-0123456789abcdefghijklmnopqrstuvwxyz$' "$V/secrets/app_secret"
  prev=$(compgen -G "$V/secrets/app_secret.prev-*" | head -1)
  check "--secret: the old secret is kept as .prev-<stamp> (rotation's form)" bash -c "[[ '$prev' =~ app_secret\\.prev-[0-9]{8}T[0-9]{6}\$ ]] && grep -q old-secret '$prev'"
  check "--secret: both files are mode 600" bash -c "[[ \$(stat -c %a '$V/secrets/app_secret') == 600 && \$(stat -c %a '$prev') == 600 ]]"
  check "--secret: no .next left" bash -c "[[ ! -e '$V/secrets/app_secret.next' ]]"
  check "--secret: tried on the restored database, then written, all before the start" bash -c "$(declare -f before); S='$S'; before ' restore /data/restore-' 'secret check' && before 'secret check' 'compose start banking' && ! grep -q 'CHECK WHILE RUNNING\|CHECK BEFORE THE SWAP' '$S/log'"
  check "--secret: a database with no saved bank keys takes any well-formed secret" bash -c "[[ ! -e '$V/sealed-with' ]] && grep -q '^node .*secret check' '$S/log'"
  check "--secret: the secret does not stay in the container's /tmp" bash -c "[[ -z \$(ls -A '$V/tmp') ]]"
  check "--secret: the summary names the old secret" out_has "The previous app secret is in the secrets volume as app_secret.prev-"
  check "--secret: no hint to add --secret" bash -c "! grep -q 'add --secret' '$W/out'"
  check "--secret: the plain secret never lands in the folders" bash -c "! grep -rq new-secret '$CL' '$W/home' 2>/dev/null"
  new_world; mkdb "$W/files/a.db" BACKUP; printf 'old-secret-0123456789abcdefghijklmnopqrstuvwxyz\n' >"$W/files/same"
  run_restore a.db --secret same
  check "the same secret again: no .prev- file, nothing to try" bash -c "[[ \$(cat '$W/rc') == 0 ]] && ! compgen -G '$V/secrets/app_secret.prev-*' >/dev/null && grep -q 'already this one' '$W/out' && ! grep -q '^node ' '$S/log'"
  new_world; mkdb "$W/files/a.db" BACKUP; echo short >"$W/files/short"
  run_restore a.db --secret short
  check "a short secret: refused before anything changes" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'is not an app secret' '$W/out' && ! grep -q 'compose stop' '$S/log' && grep -aq CURRENT '$V/data/banking.db'"
}
# The database's bank keys are sealed with a secret (V/sealed-with). Only a secret that opens them replaces the app secret.
t_secret_checked() {
  new_world; mkdb "$W/files/a.db" BACKUP
  printf 'sealed-secret-0123456789abcdefghijklmnopqrstuvwxyz\n' >"$V/sealed-with"
  printf 'another-copys-secret-0123456789abcdefghijklmnopqrs\n' >"$W/files/wrong"
  run_restore a.db --secret wrong
  check "a wrong secret: refused with the reason, exit is not 0" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'wrong does not open the saved bank keys of this database' '$W/out' && grep -q 'the app secret was not changed' '$W/out'"
  check "a wrong secret: the old app secret stays, nothing else is left in the secrets volume" bash -c "grep -q '^old-secret-' '$V/secrets/app_secret' && [[ \$(ls -A '$V/secrets') = app_secret ]]"
  check "a wrong secret: the candidate is gone from the container's /tmp" bash -c "[[ -z \$(ls -A '$V/tmp') ]]"
  check "a wrong secret: the secret is not printed" bash -c "! grep -q 'another-copys-secret' '$W/out' && ! grep -q 'sealed-secret' '$W/out'"
  check "a wrong secret: the database was restored and the app runs again" bash -c "grep -aq BACKUP '$V/data/banking.db' && [[ -e '$S/running' ]] && grep -q 'The app was started again' '$W/out'"
  check "a wrong secret: tried after the restore and before the start" bash -c "$(declare -f before); S='$S'; before ' restore /data/restore-' 'secret check' && before 'secret check' 'compose start banking' && ! grep -q 'CHECK WHILE RUNNING\|CHECK BEFORE THE SWAP' '$S/log'"

  new_world; mkdb "$W/files/a.db" BACKUP
  printf 'sealed-secret-0123456789abcdefghijklmnopqrstuvwxyz\n' >"$V/sealed-with"
  cp "$V/sealed-with" "$W/files/right"
  run_restore a.db --secret right
  check "the right secret: exit 0, installed, the old one kept as .prev-" bash -c "[[ \$(cat '$W/rc') == 0 ]] && grep -q '^sealed-secret-' '$V/secrets/app_secret' && grep -q old-secret \"\$(compgen -G '$V/secrets/app_secret.prev-*' | head -1)\" && grep -q 'App secret put back' '$W/out'"
  check "the right secret: tried on the restored database before it was installed" bash -c "$(declare -f before); S='$S'; before ' restore /data/restore-' 'secret check' && before 'secret check' 'compose start banking'"
  check "the right secret: no .next and no candidate left" bash -c "[[ ! -e '$V/secrets/app_secret.next' && -z \$(ls -A '$V/tmp') ]]"

  new_world; mkdb "$W/files/a.db" BACKUP; touch "$S/flag-check-crashes"
  printf 'new-secret-0123456789abcdefghijklmnopqrstuvwxyz\n' >"$W/files/s"
  run_restore a.db --secret s
  check "a check that cannot run: refused, says so with its last line, the old secret stays" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'could not be tried on it (Could not open the database' '$W/out' && grep -q '^old-secret-' '$V/secrets/app_secret' && ! compgen -G '$V/secrets/app_secret.prev-*' >/dev/null"
  check "a check that cannot run: the database was restored and the app runs again" bash -c "grep -aq BACKUP '$V/data/banking.db' && [[ -e '$S/running' ]]"

  # an age-encrypted secret file is tried the same way, after age has opened it
  new_world; mkdb "$W/files/a.db" BACKUP
  printf 'sealed-secret-0123456789abcdefghijklmnopqrstuvwxyz\n' >"$V/sealed-with"
  printf 'another-copys-secret-0123456789abcdefghijklmnopqrs\n' >"$W/s"; agefile "$W/files/talous-20261009-033000.app_secret.age" "$W/s"
  run_restore a.db --secret talous-20261009-033000.app_secret.age
  check "an encrypted wrong secret: refused, the old secret stays" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'does not open the saved bank keys' '$W/out' && grep -q '^old-secret-' '$V/secrets/app_secret'"
}
t_wrong_file_refused() {
  new_world; echo "just some notes" >"$W/files/notes.db"
  run_restore notes.db
  check "a text file named .db: refused" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'notes.db is not a database' '$W/out'"
  check "a text file: docker never stopped or ran anything" bash -c "! grep -qE 'compose (stop|run)' '$S/log'"
  check "a text file: the database and the app are as they were" bash -c "grep -aq CURRENT '$V/data/banking.db' && [[ -e '$S/running' ]]"
  new_world; echo "not a database" | gzip -c >"$W/files/t.db.gz"
  run_restore t.db.gz
  check "a .db.gz without a database inside: refused before docker" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'does not contain a database' '$W/out' && ! grep -qE 'compose (stop|run)' '$S/log'"
  new_world; echo "not a database" | gzip -c >"$W/t.gz"; agefile "$W/files/t.db.gz.age" "$W/t.gz"
  run_restore t.db.gz.age
  check "a .db.gz.age without a database inside: refused, app never stopped" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'does not contain a database' '$W/out' && ! grep -q 'compose stop' '$S/log'"
  check "a .db.gz.age without a database: nothing left in the data volume" no_upload_left
  new_world; run_restore missing.db
  check "a missing file: refused" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'is not a readable file' '$W/out'"
  new_world; run_restore
  check "no file: usage, exit 2" bash -c "[[ \$(cat '$W/rc') == 2 ]] && grep -q '^Usage:' '$W/out'"
}
t_app_does_not_come_up() {
  new_world; mkdb "$W/files/a.db" BACKUP; touch "$S/flag-unhealthy"
  run_restore a.db
  check "no health after the start: exit is not 0, doctor named" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'scripts/doctor.sh' '$W/out'"
  check "no health: the database was restored and the app left started" bash -c "grep -aq BACKUP '$V/data/banking.db' && [[ -e '$S/running' ]]"
  check "no health: the address is not set into an app that does not answer" bash -c "! grep -q 'address set' '$S/log'"
}
t_address() {
  new_world; mkdb "$W/files/a.db" BACKUP; echo https://talous.example.test >"$V/address"
  run_restore a.db
  check "the same address: no restart" bash -c "[[ \$(cat '$W/rc') == 0 ]] && grep -q 'already https://talous.example.test' '$W/out' && ! grep -q 'compose restart' '$S/log'"
  new_world; mkdb "$W/files/a.db" BACKUP; printf 'INSTANCE_NAME=banking-app\n' >"$CL/.env"
  run_restore a.db
  check "no APP_BASE_URL in .env: restored, with where to set the address" bash -c "[[ \$(cat '$W/rc') == 0 ]] && grep -q 'Asetukset > Palvelin' '$W/out' && ! grep -q 'address set' '$S/log'"
}
t_refusals_before_change() {
  new_world; mkdb "$W/files/a.db" BACKUP; touch "$S/flag-no-container"
  run_restore a.db
  check "no installed app: refused with the install command" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'scripts/install.sh' '$W/out' && ! grep -q 'compose stop' '$S/log'"
  if command -v flock >/dev/null; then
    new_world; mkdb "$W/files/a.db" BACKUP
    exec {lockfd}<"$CL/scripts/install.sh"; flock -n "$lockfd"
    run_restore a.db
    exec {lockfd}<&-
    check "an install or update running: refused, nothing stopped" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'install or update is running' '$W/out' && ! grep -q 'compose stop' '$S/log'"
  fi
}
# a tick of the maintenance helper holds ops/.lock while it waits for a press: restore waits for it, and refuses only after the wait.
# The holder lets go when the file $W/release appears; the test makes it appear when restore has said it is waiting.
hold_lock() { # hold_lock: in the background, ops/.lock held until $W/release exists
  mkdir -p "$CL/ops"; : >"$CL/ops/.lock"; rm -f "$W/release" "$W/held"
  ( exec 9>>"$CL/ops/.lock"; flock 9; : >"$W/held"; until [[ -e $W/release ]]; do sleep 0.1; done ) &
  until [[ -e $W/held ]]; do sleep 0.1; done
}
t_helper_lock() {
  command -v flock >/dev/null || return 0
  local i
  new_world; mkdb "$W/files/a.db" BACKUP; hold_lock
  run_restore a.db &
  for ((i = 0; i < 100; i++)); do out_has "Waiting for the maintenance helper" 2>/dev/null && break; sleep 0.1; done
  touch "$W/release"; wait
  check "a tick holds the lock and lets go: restore said it waited, then went on" bash -c "[[ \$(cat '$W/rc') == 0 ]] && grep -q 'Waiting for the maintenance helper (at most a minute)' '$W/out' && ! grep -q 'A maintenance action is running' '$W/out' && [[ \$(grep -c 'Waiting for the maintenance helper' '$W/out') == 1 ]]"
  new_world; mkdb "$W/files/a.db" BACKUP; hold_lock
  RESTORE_LOCK_WAIT=1 run_restore a.db
  touch "$W/release"; wait
  check "the lock held throughout: the wait, then today's sentence, nothing stopped" bash -c "[[ \$(cat '$W/rc') != 0 ]] && grep -q 'Waiting for the maintenance helper' '$W/out' && grep -q 'A maintenance action is running (Asetukset > Ylläpito). Wait until it finishes.' '$W/out' && ! grep -q 'compose stop' '$S/log'"
  new_world; mkdb "$W/files/a.db" BACKUP; mkdir -p "$CL/ops"; : >"$CL/ops/.lock"
  run_restore a.db
  check "the lock free: no waiting, restored" bash -c "[[ \$(cat '$W/rc') == 0 ]] && ! grep -q 'Waiting for the maintenance helper' '$W/out'"
}

for t in t_plain_db t_gz t_age t_age_without_key t_failed_restore_starts_app t_secret_kept_as_prev t_secret_checked t_wrong_file_refused \
  t_app_does_not_come_up t_address t_refusals_before_change t_helper_lock; do
  want "$t" && "$t"
done
echo "restore.test.sh: $PASS passed, $FAILED failed"
((FAILED == 0))
