#!/usr/bin/env bash
# Drills in real Docker, on the install the upgrade rehearsal has just built (tools/ci/upgrade-run.sh with
# UPGRADE_KEEP_UP=1 leaves it up). The unit tests of the reliability work use stub Docker and fake disks; here each
# piece runs once for real: the startup gate, "Palauta viimeisin", the watchdog, the self-test of a next release's
# helper, the full disk, and the reset.
#
#   UPGRADE_WORK=<the rehearsal's folder> tools/ci/drills.sh
#
# On an install with a port and a name of its own the same UPGRADE_PORT and UPGRADE_PROJECT go to this script as to
# upgrade-run.sh that made it (the defaults are 8080 and banking-app; drill 5's second instance is 10000 above the port).
# DRILLS_ONLY="3 4" runs only those drills (7 and 8 ride on 3), so that two installs can share the ten: tools/ci/local-proof.sh
# runs 3 and 4, which need the default install, on the one that lane 0 leaves, and the others on one of their own. No drill reads the name or the port
# except through NAME and PORT.
#
# One line per drill: "drill N <name>: ok (Ns)" or "drill N <name>: failed: <reason> (Ns)", and the script goes on to the
# next. A failed drill also prints what it saw (the answer's body, the list it searched, a command's exit code and last
# lines), within 30 lines, so that the log tells the cause without another run. Exit 1 if any failed. Drill 10 reads
# "skipped", which is no failure, when GitHub gives no answer.
# It stops itself at DRILLS_LIMIT seconds (default 600; a drill that has not started by then fails "out of time") and
# removes the install, the containers, the volumes and the folder it made.
#
#   1 gate            garbage in a page of the stopped database: the file goes to /data/damaged, the newest copy is back
#   2 restore         Palauta viimeisin through the API: the app restarts by itself with the copy's data
#   3 watchdog        an app that stops answering after an update is rolled back once; a second bad period brings no more
#   4 self-test       a next release whose helper fails its self-test is rolled back by the helper
#   5 disk            a full tmpfs data volume: the reserve goes, a copy is refused for space, sign-in still works
#   6 reset           reset through the API, then Palauta viimeisin brings the data back
#   7 install.sh lock the installer's lock still holds in a second shell after update.sh merged a release that changes it
#   8 unreadable db   the watchdog's rollback of a release whose migration the previous version cannot read
#   9 symlink         the helper, reached through a symbolic link to the clone and to its own file
#  10 release answer  scripts/lib/release.sh against the real GitHub answer of the public repository (read-only GET)
#
# The watchdog's ten minutes are not waited for: the helper runs with OPS_TEST=1 and a `date` first in PATH that is
# ahead of the real clock by a file's number of seconds (ops-watchdog.sh has no OPS_T_ override for its wait). tick_at
# sets that number so that the helper's clock reads a chosen time when a tick starts, whatever the tick before it took.
# Nor is its 20 s wait for an app that SIGSTOP has stopped: while the app is stopped, a `timeout` first in PATH gives the
# helper's look at it 5 s (timeout_shim in drills-lib.sh). The look fails either way, and nothing else is shortened.
#
# Every drill on the rehearsal's install begins with `fresh`: an earlier drill that failed may have left the app stopped.
# DRILLS_GH_TOKEN (the workflow's read-only token) serves drill 10 alone, and only when GitHub refuses the plain request.
#
# In `set -o pipefail` never `cmd | grep -q`: the writer dies of the closed pipe. Here it is `grep ... >/dev/null`.
set -uo pipefail
WORK=${UPGRADE_WORK:?usage: UPGRADE_WORK=<the folder of upgrade-run.sh> tools/ci/drills.sh}
SRC=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
DIR=$WORK/talous
# shellcheck disable=SC2034 # read in drills-lib.sh (prep_ops, push_release)
REMOTE=$WORK/remote.git
DEV=$WORK/drills-dev
LOGS=$WORK/drills
CLOCK=$LOGS/clock
# The install's port and name are the defaults, or the ones given to upgrade-run.sh that made it (UPGRADE_PORT, UPGRADE_PROJECT).
PORT=${UPGRADE_PORT:-8080}
NAME=${UPGRADE_PROJECT:-banking-app}
DISK_PORT=$((PORT + 10000)) # drill 5's second instance
URL=http://127.0.0.1:$PORT
JAR=$LOGS/jar
NODE=(node --disable-warning=ExperimentalWarning)
PASS='ci-salasana-123456'
IMG=$NAME:latest
# the drills this run is for: DRILLS_ONLY="3 4" runs drill 3 (with 7 and 8, which ride on it) and drill 4; all by default
ONLY=${DRILLS_ONLY:-1 2 3 4 5 6 9 10}
for n in $ONLY; do
  [[ " 1 2 3 4 5 6 9 10 " == *" $n "* ]] || { echo "drills: DRILLS_ONLY names '$n', and there is no such drill (1 2 3 4 5 6 9 10; 7 and 8 come with 3)" >&2; exit 1; }
done
if [[ -n ${UPGRADE_PROJECT:-} ]]; then
  # the keys of the install's .env, in this environment too, as upgrade-run.sh has them: a script of the install that lost
  # one could not reach the install of the defaults
  export INSTANCE_NAME=$NAME COMPOSE_PROJECT_NAME=$NAME HOST_PORT=$PORT
fi
LIMIT=${DRILLS_LIMIT:-600}
T0=$SECONDS
DEADLINE=$((T0 + LIMIT))
export GIT_AUTHOR_NAME=ci GIT_AUTHOR_EMAIL=ci@example.invalid GIT_COMMITTER_NAME=ci GIT_COMMITTER_EMAIL=ci@example.invalid
[[ -d $DIR/.git ]] || { echo "drills: no install in $DIR (run upgrade-run.sh with UPGRADE_KEEP_UP=1 first)" >&2; exit 1; }
mkdir -p "$LOGS" "$CLOCK"
: >"$LOGS/results"
# The token leaves the environment here, so the helper, update.sh and the containers never see it. Drill 10 reads it from
# a curl config file of its own (rel) and removes the file.
if [[ -n ${DRILLS_GH_TOKEN:-} ]]; then
  mkdir -p "$LOGS/curl-auth" && chmod 700 "$LOGS/curl-auth" && (umask 077; printf 'header = "Authorization: Bearer %s"\n' "$DRILLS_GH_TOKEN" >"$LOGS/curl-auth/.curlrc")
fi
unset DRILLS_GH_TOKEN

# what the drills stand on: the bookkeeping (die, skip, fresh), the app's API, and the helper with its clock and releases
# shellcheck source=drills-lib.sh
. "$SRC/tools/ci/drills-lib.sh" || exit 1

# ── 1 the startup gate ──────────────────────────────────────────────────────
drill_gate() {
  local vol gold
  step "a checked copy of the data, then a change after it"
  login || die "sign-in failed"
  make_copy || die "the copy could not be made"
  gold=$(golden_of "/data/backups/$COPY"); [[ $gold == *"tx ci-admin"* ]] || die "the copy holds no data: $gold"
  mutate || die "the change after the copy failed"
  [[ $(golden_of /data/banking.db) != "$gold" ]] || die "the change did not alter the data, so the drill would prove nothing"
  step "stop the app, write garbage into the pages of the database"
  vol=$(data_volume); [[ -n $vol ]] || die "no data volume found"
  dc stop banking || die "the app did not stop"
  docker run --rm --entrypoint node -v "$vol:/data" "$IMG" -e '
    const fs = require("fs"), f = "/data/banking.db";
    for (const x of ["-wal", "-shm"]) fs.rmSync(f + x, { force: true });
    const fd = fs.openSync(f, "r+"), n = Math.min(fs.fstatSync(fd).size - 4096, 65536);
    fs.writeSync(fd, Buffer.alloc(n, 0x5a), 0, n, 4096); fs.closeSync(fd); console.log("garbage written over", n, "bytes from page 2");' || die "the garbage could not be written"
  step "start the app"
  dc start banking || die "the app did not start"
  until_ok 150 app_ok || die "the app did not come back after the damage"
  step "the damaged file, the data, the log line, the notice"
  dc exec -T banking ls /data/damaged | grep '^banking-.*\.db$' || die "no banking-*.db in /data/damaged"
  [[ $(golden_of /data/banking.db) == "$gold" ]] || die "the data is not the newest copy's (diff: $(diff <(printf '%s\n' "$gold") <(golden_of /data/banking.db) | head -c 300))"
  dc logs --no-color banking 2>&1 | grep 'database: .*was damaged' >/dev/null || die "the app log has no 'database: ... was damaged' line"
  login || die "sign-in failed after the gate"
  notices | grep 'Tietokanta oli vaurioitunut' >/dev/null || die "no notice about the damaged database: $(notices | head -c 300)"
}

# ── 2 Palauta viimeisin through the API ─────────────────────────────────────
drill_restore() {
  local gold audit
  fresh
  step "a checked copy, then a change after it"
  login || die "sign-in failed"
  make_copy || die "the copy could not be made"
  gold=$(golden_of "/data/backups/$COPY"); mutate || die "the change failed"
  [[ $(golden_of /data/banking.db) != "$gold" ]] || die "the change did not alter the data"
  step "POST /api/ops/restore-latest, the app stops and Docker starts it"
  restore_api
  [[ $RESTORED == "$COPY" ]] || die "the API named the copy '$RESTORED', expected '$COPY'"
  step "the data, pre-restore copy, marker, notice, audit"
  [[ $(golden_of /data/banking.db) == "$gold" ]] || die "the data is not the copy's"
  dc exec -T banking ls /data/backups | grep '^pre-restore-' >/dev/null || die "no pre-restore-*.db in /data/backups"
  dc exec -T banking test ! -e /data/.restore-request || die "/data/.restore-request is still there"
  login || die "sign-in failed after the restore"
  notices | grep 'palautti tietokannan' >/dev/null || die "no notice naming who asked: $(notices | head -c 300)"
  # the list gives an event as an action and an outcome: services/ops.ts splits the detail "tietokannan palautus: tehty (<copy>)"
  audit=$(api "$URL/api/ops/audit") || die "GET /api/ops/audit failed"
  grep -F "\"action\":\"tietokannan palautus\",\"outcome\":\"tehty ($COPY)\"" <<<"$audit" >/dev/null \
    || die "the audit list has no 'tietokannan palautus' with the outcome 'tehty ($COPY)'" "the list, newest first, as action: outcome [user]:" "$(audit_rows <<<"$audit")" "its first bytes: $(head -c 240 <<<"$audit")"
}

# ── 6 reset through the API, then Palauta viimeisin ─────────────────────────
drill_reset() {
  local gold n=0
  fresh
  login || die "sign-in failed"
  gold=$(golden_of /data/banking.db); [[ $gold == *"tx ci-member"* ]] || die "there is no member's data to empty: $gold"
  step "POST /api/ops/reset"
  while :; do
    code=$(post /api/ops/reset "{\"password\":\"$PASS\",\"confirm\":\"TYHJENN\\u00c4\"}")
    [[ $code == 409 ]] && ((n++ < 3)) && ((SECONDS < DEADLINE)) && { sleep 5; continue; }
    break
  done
  [[ $code == 200 ]] || die "POST reset answered $code: $(body)"
  grep '"copy":"pre-reset-' "$LOGS/body" >/dev/null || die "the answer names no pre-reset copy: $(body)"
  step "the data is gone, the admin stays"
  [[ $(golden_of /data/banking.db) != "$gold" ]] || die "the data is the same after the reset"
  [[ $(golden_of /data/banking.db) != *"ci-member"* ]] || die "the member is still there"
  login || die "the admin cannot sign in after the reset"
  step "Palauta viimeisin brings the data back"
  api "$URL/api/ops/restore-latest" | grep '"name":"pre-reset-' >/dev/null || die "the newest copy is not the pre-reset one: $(api "$URL/api/ops/restore-latest" | head -c 300)"
  restore_api
  [[ $RESTORED == pre-reset-* ]] || die "the restored copy is '$RESTORED'"
  [[ $(golden_of /data/banking.db) == "$gold" ]] || die "the data is not what it was before the reset (diff: $(diff <(printf '%s\n' "$gold") <(golden_of /data/banking.db) | head -c 300))"
}

# ── 5 a full data volume ────────────────────────────────────────────────────
DISK=(drill-disk drill-disk-data drill-disk-secrets drill-disk-hold)
disk_clean() { docker rm -f "${DISK[0]}" "${DISK[3]}" >/dev/null 2>&1; docker volume rm -f "${DISK[1]}" "${DISK[2]}" >/dev/null 2>&1; return 0; }
reserve_full() { [[ $(docker exec "$1" stat -c %s /data/.reserve 2>/dev/null) == 67108864 ]]; }
# what the second instance's volume holds, for a failed drill 5
disk_saw() {
  echo "df /data: $(docker exec "${DISK[0]}" df -Pk /data 2>&1 | tail -n 1)"
  echo "/data (size name): $(docker exec "${DISK[0]}" ls -la /data 2>&1 | awk 'NR > 1 {print $5, $NF}' | tr '\n' ';' | cut -c1-240)"
  echo "the end of the second instance's log:"; docker logs --tail 6 "${DISK[0]}" 2>&1 | cut -c1-240
}
drill_disk() {
  local c=${DISK[0]} u=http://127.0.0.1:$DISK_PORT free kb size leave out rc j=$LOGS/jar-disk
  disk_clean
  step "a second instance on a 1200 MB tmpfs volume (the reserve is written only with over 1 GB free)"
  docker volume create --driver local --opt type=tmpfs --opt device=tmpfs --opt o=size=1200m,uid=1000,gid=1000 "${DISK[1]}" >/dev/null || die "the tmpfs volume was not made"
  docker volume create "${DISK[2]}" >/dev/null || die "the secrets volume was not made"
  # Docker unmounts a tmpfs volume when its last container stops, and it comes back empty. This container keeps it mounted
  # over the restart below.
  docker run -d --name "${DISK[3]}" --network none --entrypoint node -v "${DISK[1]}:/data" "$IMG" -e 'setInterval(() => {}, 60000)' >/dev/null || die "the container that keeps the volume mounted did not start"
  saw_with disk_saw
  docker run -d --name "$c" -p 127.0.0.1:$DISK_PORT:8080 -e DATA_DIR=/data -e APP_SECRET_FILE=/secrets/app_secret -e "APP_BASE_URL=$u" \
    -e SETUP_CODE=ci-setup-code-12345 -e INDUSTRY_LOOKUP=false --read-only --tmpfs /tmp:noexec,nosuid,nodev,size=16m --cap-drop ALL \
    --security-opt no-new-privileges:true -v "${DISK[1]}:/data" -v "${DISK[2]}:/secrets" "$IMG" >/dev/null || die "the second instance did not start"
  until_ok 120 curl -fsS --max-time 5 "$u/api/health" || die "the second instance did not answer"
  curlj -c "$j" -d '{"code":"ci-setup-code-12345","username":"ci-admin","displayName":"CI","password":"'"$PASS"'"}' "$u/api/auth/setup" >/dev/null || die "setup failed"
  curlj -b "$j" -c "$j" -X POST "$u/api/demo" >/dev/null || die "demo data failed"
  until_ok 60 reserve_full "$c" || die "no 64 MB /data/.reserve: $(docker exec "$c" ls -la /data 2>&1 | head -c 400)"
  step "fill the volume to 100 MB free, then restart: the start gives the reserve up"
  free=$(docker exec "$c" df -Pk /data | awk 'NR==2 {print $4}'); kb=$((free - 100 * 1024))
  docker exec "$c" dd if=/dev/zero of=/data/ballast1 bs=1024 count="$kb" 2>&1 | tail -n 1
  free=$(docker exec "$c" df -Pk /data | awk 'NR==2 {print $4}')
  ((free < 128 * 1024)) || die "the fill left $free KB free: the reserve goes only under 128 MB"
  docker restart "$c" >/dev/null || die "restart failed"
  until_ok 120 curl -fsS --max-time 5 "$u/api/health" || die "the second instance did not answer after the restart"
  docker exec "$c" test -s /data/ballast1 || die "the restart emptied the volume, so the start saw no full disk"
  docker exec "$c" test ! -e /data/.reserve || die "the reserve is still there with $(docker exec "$c" df -Pk /data | awk 'NR==2 {print $4}') KB free"
  docker logs "$c" 2>&1 | grep 'the reserve .* was deleted' >/dev/null || die "the log has no line about the deleted reserve"
  step "fill what is left but half a copy, then ask for a copy"
  docker exec "$c" mkdir -p /data/backups
  size=$(docker exec "$c" stat -c %s /data/banking.db); leave=$((size / 2048)); ((leave < 96)) && leave=96
  free=$(docker exec "$c" df -Pk /data | awk 'NR==2 {print $4}'); kb=$((free - leave))
  docker exec "$c" dd if=/dev/zero of=/data/ballast2 bs=1024 count="$kb" 2>&1 | tail -n 1
  rc=0
  # shellcheck source=../../scripts/lib/dbcopy.sh
  out=$(. "$DIR/scripts/lib/dbcopy.sh" && docker exec "$c" "${NODE[@]}" -e "$DBCOPY_JS" 'keep:^manual-[0-9TZ]+\.db$' /data/backups/manual-drill.db 2>&1) || rc=$?
  ((rc != 0)) || die "the copy was made on a full disk"
  [[ $out == *"not enough free space"* ]] || die "the copy was refused without the space message: $(printf '%s' "$out" | head -c 300)"
  step "sign-in on the full volume"
  curlj -c "$j.2" -d "{\"username\":\"ci-admin\",\"password\":\"$PASS\"}" "$u/api/auth/login" >/dev/null 2>"$LOGS/curl.err" || die "sign-in failed on the full volume ($(docker exec "$c" df -Pk /data | awk 'NR==2 {print $4}') KB free)" "$(head -c 200 "$LOGS/curl.err")"
}

# ── 3 the watchdog (and 7, 8, which ride on its update) ─────────────────────
# what the installed release's own installer_lock says (scripts/lib/release.sh), for drill 7's line
lock_says() {
  (
    cd "$DIR" && . scripts/lib/release.sh || exit 0
    if ! declare -F installer_lock >/dev/null; then echo "not in this release"; elif installer_lock; then echo free; else echo held; fi
  ) 2>&1 | tail -n 1
}
drill_watchdog() {
  local prev new upid v n=0 rc=0 t3=$SECONDS
  fresh
  prep_ops || die "the helper's folders could not be made"
  login || die "sign-in failed"
  prev=$(app_version)
  step "a next release with a migration the previous version cannot read, and a changed install.sh; update.sh by hand"
  push_release "drill: watchdog release" release_watchdog || die "the release could not be pushed"
  new=$(git -C "$DEV" rev-parse HEAD)
  shim next
  (cd "$DIR" && exec ./scripts/update.sh --yes) >"$LOGS/update3.log" 2>&1 &
  upid=$!
  if until_ok 240 merged "$new" && kill -0 "$upid" 2>/dev/null; then
    # The installer's lock is the clone folder itself, a name no update replaces. A lock on scripts/install.sh is
    # on a new inode after this merge: a second shell took it in round 1, and would on the fixed code too.
    if (flock -n 9) 9<"$DIR"; then
      note_result 7 "install.sh lock" "failed: update.sh was running after the merge and a second shell took the installer's lock (the clone folder); installer_lock of the merged scripts/lib/release.sh says: $(lock_says)"
    else
      note_result 7 "install.sh lock" "ok ($((SECONDS - t3)) s into drill 3)"
    fi
  else
    note_result 7 "install.sh lock" "failed: update.sh was over before the lock could be tried (see drill 3 log)"
  fi
  wait "$upid" || { rc=$?; die "update.sh by hand failed" "exit code $rc, its last lines:" "$(tail -n 12 "$LOGS/update3.log")"; }
  until_ok 120 app_ok || die "the new version does not answer"
  [[ $(app_version) == 9999.1.0 ]] || die "the new version is not running: $(app_version)"
  [[ -s $DIR/backups/.last-update ]] || die "no backups/.last-update after the update"
  cp "$DIR/backups/.last-update" "$LOGS/last-update.saved"
  saw_with watchdog_saw
  step "the app stops answering (SIGSTOP); five ticks 160 s apart on the helper's clock: 480 s of it by the fourth, 640 s by the fifth"
  stop_app || die "the app could not be stopped"
  clock_start
  n=0
  for v in 2 162 322 482 642; do
    ((n++))
    tick_at "$v" || die "tick $n ended with $?"
    echo "tick $n at +$v s: ops/watchdog-since (START SECONDS LAST JOURNAL) = $(since)"
    if ((n < 5)); then compgen -G "$DIR/ops/watchdog-*Z" >/dev/null && die "the update was rolled back at tick $n, before ten minutes"; fi
  done
  rm -f "$CLOCK/stopped" # the rollback of the fifth tick has put a running app in its place
  step "after the fifth tick: rolled back, once, reported"
  compgen -G "$DIR/ops/watchdog-*Z" >/dev/null || die "no ops/watchdog-<AT> mark: the watchdog did not roll back"
  helper_log_has 'watchdog: the app has been unhealthy for 10 minutes' || die "helper.log has no 'watchdog: the app has been unhealthy' line"
  until_ok 120 app_ok || die "the app does not answer after the watchdog's rollback"
  [[ $(app_version) == "$prev" ]] || die "the version after the rollback is $(app_version), expected $prev"
  grep '"reason":"unhealthy"' "$DIR/ops/watchdog.frag" >/dev/null || die "ops/watchdog.frag is missing or has no reason unhealthy" "ops/watchdog.frag: $(cat "$DIR/ops/watchdog.frag" 2>&1)"
  login || die "sign-in failed after the rollback"
  until_ok 30 bash -c "curl -fsS -b '$JAR' '$URL/api/security/notices' | grep watchdog_notice" || die "the app shows no watchdog notice after the rollback" "ops/watchdog.frag: $(cat "$DIR/ops/watchdog.frag" 2>&1)" "the notices: $(notices 2>&1 | head -c 240)"
  if migrations | grep '^9999_drill_watchdog' >/dev/null; then
    note_result 8 "unreadable database" "failed: the rolled back database still has the migration the previous version cannot read"
  else
    note_result 8 "unreadable database" "ok ($((SECONDS - t3)) s into drill 3)"
  fi
  step "a second bad period: the same update's record put back, the app stopped again, five ticks"
  cp "$LOGS/last-update.saved" "$DIR/backups/.last-update" && chmod 600 "$DIR/backups/.last-update" || die "the record could not be put back"
  n=$(started_at)
  stop_app || die "the app could not be stopped"
  for v in 1000 1160 1320 1480 1640; do
    tick_at "$v" || die "a tick of the second period ended with $?"
    echo "tick at +$v s: ops/watchdog-since = $(since)"
  done
  [[ $(grep -c 'watchdog: the app has been unhealthy for 10 minutes' "$DIR/ops/helper.log") == 1 ]] || die "a second rollback was started"
  [[ $(started_at) == "$n" ]] || die "the container was recreated in the second period"
  rm -f "$CLOCK/stopped"
  docker kill -s CONT "$NAME" >/dev/null || true
  until_ok 60 app_ok || die "the app does not answer after SIGCONT"
  rm -f "$DIR/backups/.last-update"
}

# ── 4 the self-test of a next release's helper ──────────────────────────────
drill_selftest() {
  local prev head
  fresh
  prep_ops || die "the helper's folders could not be made"
  login || die "sign-in failed"
  prev=$(app_version); head=$(git -C "$DIR" rev-parse HEAD)
  saw_with ops_saw
  step "a first tick, so the helper is known to the app"
  tick 0 || die "the first tick ended with $?"
  step "a next release whose helper fails its self-test; Päivitä through the API; the tick runs the update"
  push_release "drill: self-test fails" release_selftest || die "the release could not be pushed"
  shim next
  code=$(post /api/ops/request "{\"action\":\"update\",\"password\":\"$PASS\"}")
  [[ $code == 2?? ]] || die "POST request update answered $code: $(body)"
  tick 0 || die "the tick that runs the update ended with $?"
  step "rolled back by the helper, and said so"
  helper_log_has 'update: the new helper failed its self-test' || die "helper.log has no 'update: the new helper failed its self-test' line"
  helper_log_has 'update: the previous version was restored' || die "helper.log has no 'update: the previous version was restored' line"
  until_ok 120 app_ok || die "the app does not answer after the rollback"
  [[ $(app_version) == "$prev" ]] || die "the version after the rollback is $(app_version), expected $prev"
  [[ $(git -C "$DIR" rev-parse HEAD) == "$head" ]] || die "the source was not put back"
  grep -l 'uusi ylläpitoapuri ei toiminut' "$DIR"/ops/journal/*.result >/dev/null 2>&1 || die "the request's result does not say the new helper failed"
  grep '"reason":"self_test"' "$DIR/ops/watchdog.frag" >/dev/null || die "ops/watchdog.frag is missing or has no reason self_test"
}

# ── 9 the helper behind symbolic links ──────────────────────────────────────
drill_symlink() {
  local out seen
  ln -s "$DIR" "$WORK/linked-clone" && ln -s "$DIR/scripts/ops-helper.sh" "$WORK/linked-helper.sh" || die "the links could not be made"
  prep_ops || die "the helper's folders could not be made"
  step "--self-test through the clone's link, and through the helper's own link"
  out=$(cd "$WORK/linked-clone" && env OPS_TEST=1 PATH="$PATH" ./scripts/ops-helper.sh --self-test 2>&1); [[ $out == *"self-test ok"* ]] || die "through the clone's link: $out"
  out=$(cd / && env OPS_TEST=1 PATH="$PATH" "$WORK/linked-helper.sh" --self-test 2>&1); [[ $out == *"self-test ok"* ]] || die "through the helper's link: $out"
  step "a tick through the clone's link works on the real folder"
  seen=$(stat -c %Y "$DIR/ops/helper-seen" 2>/dev/null || echo 0); sleep 1
  # the one place a real container runs the wait for a press: five seconds of it, not 45
  (cd "$WORK/linked-clone" && env OPS_TEST=1 OPS_T_WAKE=5 PATH="$PATH" timeout -k 10 120 ./scripts/ops-helper.sh) >>"$LOGS/tick.out" 2>&1 || die "the tick through the link ended with $?"
  (($(stat -c %Y "$DIR/ops/helper-seen") > seen)) || die "ops/helper-seen of the real folder did not change"
  [[ ! -e $WORK/linked-clone/../ops ]] || die "an ops folder was made beside the link"
}

# ── 10 the release parser on GitHub's real answer ───────────────────────────
# rel FUNCTION ARGS...: a function of this checkout's scripts/lib/release.sh, run in the checkout. The address asked is the
# one that file holds (RELEASES_API). With the caller's auth=1 its curl also reads the token's config file.
rel() { (cd "$SRC" && . scripts/lib/release.sh && { [[ -z ${auth:-} ]] || export CURL_HOME=$LOGS/curl-auth; } && "$@"); }
# GitHub did not answer the question: no connection, a refusal for the address's rate, or its own error
no_answer() { [[ $1 =~ ^(000|403|429|5[0-9][0-9])$ ]]; }
release_rows() { grep -oE '"(tag_name|draft|prerelease)": *("[^"]*"|[a-z]+)' "$1" | tr '\n' ' ' | cut -c1-860 | fold -w 290; }
# The tag a JSON parser takes from the answer on stdin, by the rules of release_pick: vX.Y.Z, no draft, in mode latest no
# pre-release, and of those the highest.
RELEASE_JS='
  const m = process.argv[1]; let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const j = JSON.parse(s), n = (t) => t.slice(1).split(".").map(Number);
    const tags = (Array.isArray(j) ? j : [j]).filter((r) => r && /^v\d+\.\d+\.\d+$/.test(r.tag_name) && r.draft !== true && !(m === "latest" && r.prerelease === true)).map((r) => r.tag_name);
    tags.sort((a, b) => { const x = n(a), y = n(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; });
    console.log(tags[0] || "");
  });'
# Round 1 failed here on a 403 of a second, plain GET: GitHub allows a runner's shared address 60 requests an hour. Now the
# answer the product's own GET fetched is parsed twice, a refusal is asked again with the workflow's token when there is
# one, and no answer at all is "skipped", never a failure of the parser.
drill_release() {
  local m f=$LOGS/release.json code rc got want all auth=""
  trap 'rm -rf "$LOGS/curl-auth"' EXIT
  step "scripts/lib/release.sh on GitHub's real answer: its GET, its parser against a JSON parser on the same bytes, then the whole call (awk: $(awk -W version 2>&1 | head -n 1 || true))"
  (cd "$SRC" && . scripts/lib/release.sh && declare -F release_get release_pick release_from_api >/dev/null) || die "scripts/lib/release.sh lacks release_get, release_pick or release_from_api"
  for m in latest newest; do
    code=$(rel release_get "$m" "$f")
    if [[ $code =~ ^(403|429)$ && -z $auth && -s $LOGS/curl-auth/.curlrc ]]; then
      echo "$m: GitHub refused the request without a token (HTTP $code: $(head -c 160 "$f" | tr '\n' ' ')). Asking with the workflow's token from here on."
      auth=1; code=$(rel release_get "$m" "$f")
    fi
    no_answer "$code" && skip "GitHub gave no answer (HTTP $code for $m, with the token: ${auth:-no}): $(head -c 160 "$f" 2>/dev/null | tr '\n' ' ')"
    [[ $code == 200 ]] || die "$m: GitHub answered HTTP $code" "the answer: $(head -c 500 "$f" 2>/dev/null | tr '\n' ' ')"
    want=$(docker run --rm -i --network none --entrypoint node "$IMG" -e "$RELEASE_JS" "$m" <"$f" 2>&1) || die "$m: the answer could not be read as JSON" "$want" "the answer: $(head -c 300 "$f" | tr '\n' ' ')"
    rc=0; got=$(rel release_pick "$m" "$f") || rc=$?
    got=${got%%$'\t'*}
    echo "$m: HTTP $code, $(wc -c <"$f") bytes; release_pick: rc=$rc tag='$got'; a JSON parser: '$want'"
    [[ $want =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "$m: the answer holds no release that counts, so nothing was compared" "$(release_rows "$f")"
    [[ $rc == 0 && $got == "$want" ]] || die "$m: release_pick says '$got' (rc $rc), a JSON parser says '$want' on the same answer" "$(release_rows "$f")"
    rc=0; all=$(rel release_from_api "$m") || rc=$?
    if [[ $rc != 0 ]]; then
      code=$(rel release_get "$m" "$f")
      no_answer "$code" && skip "GitHub gave no answer to release_from_api $m (rc $rc, a GET right after it: HTTP $code); release_pick agreed with a JSON parser"
    fi
    [[ $rc == 0 && $all == "$want" ]] || die "$m: release_from_api says '$all' (rc $rc), expected '$want'" "a GET right after it: HTTP $code"
  done
}

# ── run ─────────────────────────────────────────────────────────────────────
names=([1]=gate [2]=restore [3]=watchdog [4]=self-test [5]=disk [6]=reset [9]=symlink [10]="release answer")
run_drill() { # run_drill N fn
  local n=$1 fn=$2 t=$SECONDS why rc
  : >"$LOGS/$n.log"; rm -f "$LOGS/reason" "$LOGS/saw"; echo "-" >"$LOGS/step"
  if ((SECONDS >= DEADLINE)); then note_result "$n" "${names[$n]}" "failed: out of time (the script stops at $LIMIT s)"; return; fi
  echo "${names[$n]}" >"$LOGS/current"
  # compose repeats one warning on every call; it is left out of the log
  ("$fn") 2>&1 | sed -u '/variable is not set. Defaulting to a blank string/d' | tee -a "$LOGS/$n.log"
  rc=${PIPESTATUS[0]}
  why=$(cat "$LOGS/reason" 2>/dev/null || echo "ended without a reason")
  if ((rc == 0)); then
    note_result "$n" "${names[$n]}" "ok ($((SECONDS - t)) s)"
  elif ((rc == 77)); then
    note_result "$n" "${names[$n]}" "skipped: $why"
  else
    # the result line, then at most 28 lines: what the drill saw, the end of the app's log and of the helper's
    note_result "$n" "${names[$n]}" "failed at '$(cat "$LOGS/step")': $why ($((SECONDS - t)) s)"
    {
      if [[ -s $LOGS/saw ]]; then echo "what it saw:"; head -n 16 "$LOGS/saw"; fi
      echo "the end of the app's log:"; dc logs --no-color --tail 12 banking 2>&1 | grep -v 'variable is not set' | tail -n 5
      if [[ -f $DIR/ops/helper.log ]]; then echo "the end of ops/helper.log:"; tail -n 4 "$DIR/ops/helper.log"; fi
    } | cut -c1-300 | sed 's/^/    /'
  fi
  rm -f "$LOGS/current"
}
finish() {
  local rc=$? bad=0
  trap - EXIT
  if [[ -f $LOGS/current ]]; then note_result "?" "$(cat "$LOGS/current")" "failed: stopped at the time limit"; fi
  if [[ -n ${TIMER:-} ]]; then pkill -TERM -P "$TIMER" 2>/dev/null; kill "$TIMER" 2>/dev/null; fi
  docker kill -s CONT "$NAME" >/dev/null 2>&1
  disk_clean
  dc down -v >/dev/null 2>&1
  echo; echo "== drills (${SECONDS}s of $LIMIT)"
  sort -t'|' -k1,1n "$LOGS/results" | while IFS='|' read -r n title res; do printf 'drill %s %s: %s\n' "$n" "$title" "$res"; done
  grep -vE '^[^|]*\|[^|]*\|(ok|skipped)' "$LOGS/results" >/dev/null && bad=1
  [[ -s $LOGS/results ]] || bad=1
  [[ -n $WORK ]] && rm -rf "$WORK" 2>/dev/null
  ((rc != 0 || bad != 0)) && exit 1
  exit 0
}
trap finish EXIT
trap 'pkill -TERM -P $$ 2>/dev/null; exit 1' TERM
# "&&": finish ends this timer by ending its sleep first. With ";" the timer then went on to its kill, and a run whose
# drills had all passed ended 1 with no summary (seen in the first run that passed all ten).
( sleep "$LIMIT" && kill -TERM $$ 2>/dev/null ) >/dev/null 2>&1 &
TIMER=$!
disown "$TIMER"

for n in 1:gate 2:restore 6:reset 5:disk 9:symlink 10:release 3:watchdog 4:selftest; do
  [[ " $ONLY " != *" ${n%%:*} "* ]] || run_drill "${n%%:*}" "drill_${n#*:}"
done
