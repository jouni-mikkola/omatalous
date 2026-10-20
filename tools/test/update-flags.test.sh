#!/usr/bin/env bash
# Tests for two flags of scripts/update.sh: --rollback restores a database copy only when someone said so (a terminal's
# answer or --yes), and --check says what an update would do and changes nothing. Against the stub world of
# tools/test/ops-world.sh: nothing here touches the network, a real container or a real registry.
#
#   tools/test/update-flags.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # ops-world.sh copies the scripts from there
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
# COPY_NAME of apps/server/src/db/backup-keep.ts, read here: the unprivileged run gets a copy of scripts/ and tools/test only
export COPY_NAME_RE=${COPY_NAME_RE:-$(sed -nE 's|^export const COPY_NAME = /(.*)/;$|\1|p' "$SRC/apps/server/src/db/backup-keep.ts")}
unprivileged update-flags.test.sh "$@"

# The world, with an answer for the check --check runs on its own copy of the database: $S/dry-check is its exit code
# (default 0) and $S/dry-applied the migrations its JSON line lists (default none). $S/dry-hang makes the check hang
# (its pid in $S/dry-pid), $S/no-db is an install with no database yet and $S/rm-fails a removal of the copy that fails.
world() {
  new_world
  mv "$S/bin/docker" "$S/bin/docker.world"
  cat >"$S/bin/docker" <<'EOF2'
#!/bin/bash
if [[ ${1:-} == run && $* == *"migrate-check /data/backups/.update-check-"* ]]; then
  S=$OPS_STUB_DIR
  printf 'DRY_CHECK %s\n' "$*" >>"$S/calls.log"
  [[ -e $S/dry-hang ]] && { echo $$ >"$S/dry-pid"; exec /bin/sleep 30; }
  code=$(cat "$S/dry-check" 2>/dev/null || echo 0)
  if [[ $code == 0 ]]; then
    printf '{"ok":true,"file":"x","elapsed_ms":5,"migrate_ms":0,"from":8,"to":9,"applied":%s,"ahead":[],"integrity":"ok","foreign_key_violations":{"before":0,"after":0},"tables":{},"problems":[]}\n' "$(cat "$S/dry-applied" 2>/dev/null || echo '[]')"
  elif [[ $code == 1 ]]; then echo "migrate-check failed: migration 0009_x.sql failed: boom" >&2; fi
  exit "$code"
fi
# the options of a database copy (calls.log cuts the line before them)
if [[ ${1:-} == compose && $* == *" room:"* ]]; then
  for a in "$@"; do [[ $a == room:* ]] && printf 'COPY %s %s\n' "$a" "${@: -1}" >>"$OPS_STUB_DIR/calls.log"; done
fi
if [[ ${1:-} == compose && $* == *'existsSync("/data/banking.db")'* ]]; then
  echo "DB_EXISTS?" >>"$OPS_STUB_DIR/calls.log"
  [[ -e $OPS_STUB_DIR/no-db ]] && exit 3
  exit 0
fi
if [[ ${1:-} == compose && $* == *'require("node:fs").rmSync(process.argv[1]'*"/data/backups/.update-check-"* ]]; then
  echo "DROP ${*: -1}" >>"$OPS_STUB_DIR/calls.log"
  [[ -e $OPS_STUB_DIR/rm-fails ]] && exit 1
  exit 0
fi
exec "${0%/*}/docker.world" "$@"
EOF2
  chmod +x "$S/bin/docker"
}
# update.sh in the clone with these arguments and no terminal: the output in OUT, the status in RC
run() {
  : >"$S/calls.log"
  OUT=$(cd "$CL" && env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/update.sh "$@" </dev/null 2>&1); RC=$?
}
said() { [[ $OUT == *"$1"* ]]; }
restored() { test "$(n_calls 'banking\.db\.restore')" != 0; }
# an update to 0.2.0 that went through, then a rollback that has to restore a copy (the new version changed the database
# and the previous one does not read it as it is)
updated_and_changed() {
  world; release 0.2.0; run --yes
  [[ $RC == 0 && $(cver) == 0.2.0 ]] || echo "setup: the update did not go through: $OUT"
  touch "$S/restore-needed"; echo 1 >"$S/previous-check"
}
# this install's image tags and their content, the clone's files and its commit
fingerprint() {
  { (cd "$S/images" && for f in banking-app_*; do [[ -e $f ]] && printf '%s %s\n' "$f" "$(cat "$f")"; done)
    git -C "$CL" rev-parse HEAD; git -C "$CL" status --porcelain --ignored
    (cd "$CL" && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum)
    cat "$S/cver"; ls "$S"; } 2>/dev/null
}

t_rollback_no_terminal() {
  updated_and_changed
  run --rollback
  check "no terminal, no --yes: the rollback stops" test "$RC" != 0
  check "no terminal, no --yes: no copy is restored" bash -c "! grep -q 'banking\.db\.restore' '$S/calls.log'"
  check "no terminal, no --yes: nothing is saved over either" bash -c "! grep -q 'pre-rollback-' '$S/calls.log'"
  check "no terminal, no --yes: the message names --yes" said "./scripts/update.sh --rollback --yes"
  check "no terminal, no --yes: the app runs again on the new version" test -e "$S/running" -a "$(cver)" = 0.2.0
  check "no terminal, no --yes: the record of the update stays for a later rollback" test -f "$CL/backups/.last-update"
  check "no terminal, no --yes: :latest is not moved" grep -q '^0\.2\.0|' "$S/images/banking-app_latest"
}

t_rollback_yes() {
  updated_and_changed
  run --rollback --yes
  check "--yes: the rollback goes through" test "$RC" = 0
  check "--yes: the copy is restored" restored
  check "--yes: the previous version runs" test "$(cver)" = 0.1.0
}

t_rollback_same_schema_no_terminal() {
  world; release 0.2.0; run --yes
  run --rollback
  check "same schema, no terminal: nothing to restore, so no --yes is needed" test "$RC" = 0 -a "$(cver)" = 0.1.0
  check "same schema, no terminal: no copy is restored" bash -c "! grep -q 'banking\.db\.restore' '$S/calls.log'"
}

t_check_release() {
  local before
  world; release 0.2.0
  before=$(fingerprint)
  run --check
  check "--check: exit 0" test "$RC" = 0
  check "--check: says the version now" said "Current: 0.1.0"
  check "--check: names the release it would install" said "Would install: v0.2.0"
  check "--check: says no migration applies" said "Migrations: none to apply."
  check "--check: no file, commit or image tag of the install changes" test "$(fingerprint)" = "$before"
  check "--check: nothing is tagged, built, started or stopped" test "$(n_calls '^docker (image tag|compose (up|build|stop|start|restart))')" = 0
  check "--check: the image is used only after its signature holds" bash -c "grep -n '^cosign verify' '$S/calls.log' | head -1 | cut -d: -f1 | { read -r c; d=\$(grep -n '^DRY_CHECK' '$S/calls.log' | head -1 | cut -d: -f1); [[ -n \$c && -n \$d ]] && ((c < d)); }"
  check "--check: the copy is taken with room for three times the database" grep -qE '^COPY room:3 /data/backups/\.update-check-[0-9TZ]+\.db$' "$S/calls.log"
  check "--check: the check runs on that copy, with no network, a read-only root and the limits" grep -q '^DRY_CHECK run --rm --name banking-app-update-check --network none --read-only .*--memory 512m --pids-limit 200 .*migrate-check /data/backups/\.update-check-' "$S/calls.log"
  check "--check: the live database is never handed to the check" bash -c "! grep -q 'migrate-check /data/banking.db' '$S/calls.log'"
  check "--check: the copy goes again" grep -qE '^DROP /data/backups/\.update-check-[0-9TZ]+\.db$' "$S/calls.log"
  # COPY_NAME of db/backup-keep.ts: a name it refuses is no copy a restore takes, keeps or lists
  local re=$COPY_NAME_RE copy
  copy=$(sed -nE 's|^COPY room:3 /data/backups/||p' "$S/calls.log")
  check "--check: COPY_NAME is read from backup-keep.ts" test -n "$re"
  check "--check: COPY_NAME refuses the name of the check's copy" bash -c "[[ -n \$2 ]] && ! grep -E \"\$1\" <<<\"\$2\" >/dev/null" x "$re" "$copy"
  check "--check: near miss, COPY_NAME takes the same name without its dot" bash -c "grep -E \"\$1\" <<<\"\${2#.}\" >/dev/null" x "$re" "$copy"
  check "--check: the registry name goes again" grep -q '^docker image rm ghcr.io/jouni-mikkola/omatalous:0.2.0' "$S/calls.log"
}

t_check_migrations() {
  world; release 0.2.0
  echo '["0009_x.sql","0010_y.sql"]' >"$S/dry-applied"
  run --check
  check "--check, migrations: counted and named" said "Migrations: 2 to apply (0009_x.sql, 0010_y.sql)"
  check "--check, migrations: exit 0" test "$RC" = 0
  echo 1 >"$S/dry-check"
  run --check
  check "--check, a migration fails on the copy: exit 3" test "$RC" = 3
  echo 5 >"$S/dry-check"
  run --check
  check "--check, the check could not run: exit 4" test "$RC" = 4
}

t_check_no_database() {
  local before
  world; release 0.2.0
  touch "$S/no-db"
  before=$(fingerprint)
  run --check
  check "--check, no database yet: exit 0" test "$RC" = 0
  check "--check, no database yet: says so" said "Migrations: none to try, there is no database yet."
  check "--check, no database yet: no copy and no check" test "$(n_calls '^(COPY|DRY_CHECK)')" = 0
  check "--check, no database yet: the registry name goes again" grep -q '^docker image rm ghcr.io/jouni-mikkola/omatalous:0.2.0' "$S/calls.log"
  check "--check, no database yet: nothing of the install changes" test "$(fingerprint)" = "$before"
  # near miss: with a database the question is asked the same way and the copy is taken
  rm "$S/no-db"; run --check
  check "--check, a database: asked, then copied and checked" test "$RC" = 0 -a "$(n_calls '^DB_EXISTS')" = 1 -a "$(n_calls '^DRY_CHECK')" = 1
}

# A real Ctrl-C reaches the whole process group; a background run ignores SIGINT, so TERM stands in (same trap).
t_check_interrupted() {
  local pid i
  world; release 0.2.0
  touch "$S/dry-hang"; : >"$S/calls.log"
  (cd "$CL" && exec env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/update.sh --check </dev/null >"$W/int.out" 2>&1) &
  pid=$!
  for ((i = 0; i < 200; i++)); do [[ -s $S/dry-pid ]] && break; /bin/sleep 0.05; done
  check "--check, interrupted: the check was running" test -s "$S/dry-pid"
  kill -TERM "$pid"; wait "$pid"; RC=$?
  kill "$(cat "$S/dry-pid" 2>/dev/null)" 2>/dev/null
  OUT=$(cat "$W/int.out")
  check "--check, interrupted: exit 130" test "$RC" = 130
  check "--check, interrupted: the copy goes" grep -qE '^DROP /data/backups/\.update-check-[0-9TZ]+\.db$' "$S/calls.log"
  check "--check, interrupted: no word of a copy left" bash -c "! grep -q 'Could not remove' <<<\"\$1\"" x "$OUT"
}

t_check_drop_fails() {
  world; release 0.2.0
  touch "$S/rm-fails"
  run --check
  check "--check, the copy cannot be removed: said, with its name" bash -c "grep -qE 'Could not remove .*/data/backups/\.update-check-[0-9TZ]+\.db' <<<\"\$1\"" x "$OUT"
  check "--check, the copy cannot be removed: the answer still stands" test "$RC" = 0
  rm "$S/rm-fails"; run --check
  check "--check, near miss: a removal that works says nothing" bash -c "! grep -q 'Could not remove' <<<\"\$1\"" x "$OUT"
}

t_check_full_disk() {
  local before
  world; release 0.2.0
  touch "$S/fail-snapshot" # the copy refuses: too little room
  before=$(fingerprint)
  run --check
  check "--check, no room for the copy: refused" bash -c "[[ $RC != 0 ]] && grep -q 'Could not copy the database for the check' <<<\"\$1\"" x "$OUT"
  check "--check, no room for the copy: no check runs" test "$(n_calls '^DRY_CHECK')" = 0
  check "--check, no room for the copy: the registry name goes again" grep -q '^docker image rm ghcr.io/jouni-mikkola/omatalous:0.2.0' "$S/calls.log"
  check "--check, no room for the copy: nothing of the install changes" test "$(fingerprint)" = "$before"
}

t_rollback_local_changes() {
  world; release 0.2.0; run --yes
  echo "# local" >>"$CL/docker-compose.yml"
  run --rollback --yes
  check "local changes: the rollback refuses" bash -c "[[ $RC != 0 ]] && grep -q 'local changes' <<<\"\$1\"" x "$OUT"
  check "local changes: nothing is stopped or restored" test "$(n_calls '^docker compose (stop|run)')" = 0 -a "$(cver)" = 0.2.0
}

t_rollback_untracked_in_way() {
  world
  # 0.2.0 drops a file that 0.1.0 (the commit a rollback goes back to) has
  git -C "$W/seed" rm -q scripts/doctor.sh; release 0.2.0; run --yes
  [[ $RC == 0 && ! -e $CL/scripts/doctor.sh ]] || echo "setup: the update did not go through: $OUT"
  echo "# mine" >"$CL/scripts/doctor.sh"
  run --rollback --yes
  check "untracked file in the way: the rollback refuses" bash -c "[[ $RC != 0 ]] && grep -q 'scripts/doctor.sh' <<<\"\$1\" && grep -q 'Nothing was stopped' <<<\"\$1\"" x "$OUT"
  check "untracked file in the way: nothing is stopped and the file stays" test "$(n_calls '^docker compose (stop|run)')" = 0 -a "$(cver)" = 0.2.0 -a "$(cat "$CL/scripts/doctor.sh")" = "# mine"
  # near miss: an untracked file the old version does not have is no obstacle
  mv "$CL/scripts/doctor.sh" "$CL/notes.txt"
  run --rollback --yes
  check "untracked file out of the way: the rollback goes through" test "$RC" = 0 -a "$(cver)" = 0.1.0 -a -f "$CL/notes.txt"
}

t_rollback_reset_fails() {
  world; release 0.2.0; run --yes
  touch "$CL/.git/index.lock" # git reset --keep cannot write the index
  run --rollback --yes
  rm -f "$CL/.git/index.lock"
  check "reset --keep fails: the rollback stops and says what to run" bash -c "[[ $RC != 0 ]] && grep -q 'The source could not go back' <<<\"\$1\" && grep -q 'git reset --keep' <<<\"\$1\"" x "$OUT"
  check "reset --keep fails: the previous version is not started" test "$(n_calls '^docker compose up')" = 0
  check "reset --keep fails: the folder stays at the new version" test "$(git -C "$CL" log -1 --format=%s)" = "release 0.2.0"
}

t_check_current() {
  world; release 0.2.0; run --yes
  run --check
  check "--check, at the release: nothing to install" bash -c "[[ $RC == 0 ]] && grep -q 'Would install: nothing' <<<\"\$1\"" x "$OUT"
  check "--check, at the release: nothing pulled" test "$(n_calls '^docker pull')" = 0
}

t_check_source() {
  local before
  world; setenv TALOUS_CHANNEL=source; src_commit
  before=$(fingerprint)
  run --check
  check "--check, source: names the commit it would build" bash -c "[[ $RC == 0 ]] && grep -q 'Would install: source' <<<\"\$1\" && grep -q 'not known before the build' <<<\"\$1\"" x "$OUT"
  check "--check, source: nothing is pulled, built or merged" test "$(n_calls '^docker (pull|compose build)')" = 0 -a "$(fingerprint)" = "$before"
}

t_check_source_private() {
  local before
  new_world; setenv TALOUS_CHANNEL=source TALOUS_PRIVATE_BUILD=yes; src_commit
  before=$(fingerprint)
  run --check
  check "--check, source with the private key: says the build is private" bash -c "[[ $RC == 0 ]] && grep -q '^Build: private' <<<\"\$1\"" x "$OUT"
  check "--check, source with the private key: nothing is built or changed" test "$(n_calls '^docker (pull|compose build)')" = 0 -a "$(fingerprint)" = "$before"
  # at the commit already, built public: the switch is what an update would do
  setenv TALOUS_CHANNEL=source; run --yes; setenv TALOUS_CHANNEL=source TALOUS_PRIVATE_BUILD=yes
  run --check
  check "--check, key added at the same commit: would install the private build" bash -c "[[ $RC == 0 ]] && grep -q 'Would install: the private build of' <<<\"\$1\"" x "$OUT"
  setenv TALOUS_CHANNEL=source; run --check
  check "--check, built public and no key: nothing" bash -c "[[ $RC == 0 ]] && grep -q 'Would install: nothing' <<<\"\$1\"" x "$OUT"
}

t_check_locked() {
  world; release 0.2.0
  exec 7<"$CL"; flock -n 7
  run --check
  exec 7<&-
  check "--check while another run holds the folder: refused" bash -c "[[ $RC != 0 ]] && grep -q 'Another update or install is already running' <<<\"\$1\"" x "$OUT"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
