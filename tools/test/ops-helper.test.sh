#!/usr/bin/env bash
# Tests for scripts/ops-helper.sh (and the update path it drives) against a stub docker, a stub cosign and
# curl, and a local bare git remote. Nothing here touches the network, a real container or a real registry.
#
#   tools/test/ops-helper.test.sh [name-filter]
#
# The world (stubs, clone, ticks) is tools/test/ops-world.sh, shared with the suites of the libs under scripts/lib.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged ops-helper.test.sh "$@"

# ── release mode ────────────────────────────────────────────────────────────
t_release_update() {
  new_world; release 0.2.0; poll update
  tick
  check "release: update reported ok" reported ok
  check "release: running version is now 0.2.0" test "$(cver)" = 0.2.0
  check "release: pulled the release image" test "$(n_calls "^docker pull $REG:0.2.0")" = 1
  check "release: cosign verified the digest against the pinned issuer and workflow" test "$(n_calls '^cosign verify .*@sha256:')" = 1
  check "release: the copy was taken before the switch (snapshot before up)" bash -c "calls=\$(grep -nE '^SNAPSHOT /data/backups/pre-update-|^docker compose up' '$S/calls.log' | head -2); [[ \$calls == *SNAPSHOT*up* || \$calls == *SNAPSHOT*docker* ]]"
  check "release: checkout moved to the tag" test "$(head_commit)" = "$(git -C "$W/seed" rev-parse v0.2.0)"
  check "release: no local build" test "$(n_calls '^docker compose build')" = 0
  check "release: journal written and marked reported" grep -q '"reported":true' "$CL/ops/journal/$ID.json"
  check "release: state file for rollback exists (600)" test "$(stat -c %a "$CL/backups/.last-update")" = 600
}
t_offer_after_update_and_rollback() { # the daily check offered the version before the update, and nothing fetches after it
  new_world; release 0.2.0; tick; poll update; tick
  check "offer: after a release update the result says no update is available" grep -q '"update_available":false' "$S/reports/1.json"
  poll rollback "$ID2"; tick
  check "offer: a rollback drops the saved answer, so its result has none" bash -c "! grep -q update_available '$S/reports/2.json' && [[ ! -e '$CL/ops/check.frag' && ! -e '$CL/ops/last-check' ]]"
  rm -f "$S/state.last" "$CL/ops/boot_id"; tick
  check "offer: and the next heartbeat checks again" grep -q '"update_available":true' "$S/state.last"
  new_world; setenv TALOUS_CHANNEL=source; src_commit; tick; poll update; tick
  check "offer, source: after the update the result says no update is available" grep -q '"update_available":false' "$S/reports/1.json"
}
t_release_not_newer() {
  new_world; release 0.2.0; echo 0.2.0 >"$S/cver"; echo "0.2.0|$(git -C "$W/seed" rev-parse HEAD)|1" >"$S/images/$(printf %s banking-app:latest | tr '/:@' '___')"
  poll update; tick
  check "release: same version is not installed" test "$(n_calls "^docker pull")" = 0
  check "release: same version reported as already current" grep -q "jo käytössä" <<<"$(report)"
  rm -f "$S/reports"/*; : >"$S/calls.log"
  echo 0.3.0 >"$S/cver"; poll update "$ID2"; tick
  check "release: a lower release than the running version is not installed" test "$(n_calls "^docker pull")" = 0
}
t_release_cosign_fails() {
  new_world; release 0.2.0; touch "$S/cosignfail"; poll update; local before; before=$(head_commit)
  tick
  check "release: failed signature reported failed" reported failed
  check "release: unsigned image never tagged or started" test "$(n_calls '^docker (image tag ghcr|compose up)')" = 0
  check "release: old version still running" test "$(cver)" = 0.1.0
  check "release: checkout unchanged" test "$(head_commit)" = "$before"
}
t_release_signed_by_hand() {
  # 0.4.0 and 0.5.0 were signed by runs started by hand, which installs before 0.5.1 refused
  new_world; release 0.2.0; echo workflow_dispatch >"$S/signed-by"; poll update
  tick
  check "release: an image signed by a run started by hand is accepted" reported ok
  check "release: the push trigger was tried first" bash -c "grep '^cosign verify' '$S/calls.log' | head -1 | grep 'trigger push ' >/dev/null"
  new_world; release 0.2.0; echo schedule >"$S/signed-by"; poll update
  tick
  check "release: any other trigger is refused" reported failed
  check "release: refused image not started" test "$(cver)" = 0.1.0
}
t_release_bad_image() {
  new_world; release 0.2.0
  echo "0.2.0|0000000000000000000000000000000000000000|1" >"$S/registry/0.2.0"
  poll update; tick
  check "release: image built from another commit is refused" reported failed
  check "release: refused image not started" test "$(cver)" = 0.1.0
}
t_release_health_fails_rolls_back() {
  new_world; release 0.2.0; touch "$S/bad_0.2.0"; poll update; local before; before=$(head_commit)
  tick
  check "release: unhealthy new version reported failed" reported failed
  check "release: rolled back by itself to 0.1.0" test "$(cver)" = 0.1.0
  check "release: checkout back at the previous commit" test "$(head_commit)" = "$before"
  check "release: no RECOVERY.txt when the rollback worked" test ! -e "$CL/ops/RECOVERY.txt"
}
t_release_rollback_fails_too() {
  new_world; release 0.2.0; touch "$S/bad_0.2.0" "$S/bad_0.1.0"; poll update
  tick
  check "release: both failing reports failed" reported failed
  check "release: RECOVERY.txt written" test -s "$CL/ops/RECOVERY.txt"
  check "release: RECOVERY.txt has the exact commands" grep -q './scripts/update.sh --rollback' "$CL/ops/RECOVERY.txt"
}

# ── the new version's migrations are tried on the copy before the old container stops ───
line_of() { grep -nE "$1" "$S/calls.log" | head -1 | cut -d: -f1; }
t_migrate_check_before_switch() {
  new_world; release 0.2.0; poll update; tick
  check "migrate-check: update reported ok" reported ok
  check "migrate-check: the new image is asked whether it has the command, with no volume" grep -qE '^docker run --rm --network none .*migrate-check' "$S/calls.log"
  check "migrate-check: it ran on the pre-update copy in a one-off container of the new image" bash -c "grep -qE '^MIGRATE_CHECK /data/backups/pre-update-[0-9TZ]+\.db\$' '$S/calls.log' && grep -qE '^docker compose run --rm --no-deps -T --entrypoint node banking .*dist/node.js migrate-check /data/backups/pre-update-' '$S/calls.log'"
  check "migrate-check: the copy comes first, then the check" test "$(line_of '^SNAPSHOT /data/backups/pre-update-')" -lt "$(line_of '^MIGRATE_CHECK ')"
  check "migrate-check: the check comes before the old container is replaced" test "$(line_of '^MIGRATE_CHECK ')" -lt "$(line_of '^docker compose up')"
  check "migrate-check: its result is in the update output" grep -q 'migrate-check: ok, 1 migration' "$S/reports/1.json"
  check "migrate-check: the previous image is saved only after it passed" test "$(line_of '^MIGRATE_CHECK ')" -lt "$(line_of '^docker image tag banking-app:pending-previous banking-app:previous')"
}
t_migrate_check_fails() {
  new_world; release 0.2.0; touch "$S/migrate-fail"; poll update
  local before; before=$(head_commit)
  tick
  check "migrate-check fails: reported failed, in Finnish, with the cause in the log" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/1.json' && grep -q 'tietokantamuutokset' '$S/reports/1.json' && grep -q 'migration 0010_x.sql failed: boom' '$S/reports/1.json'"
  check "migrate-check fails: the old version is still running" test "$(cver)" = 0.1.0
  check "migrate-check fails: nothing was stopped, started or restarted" test "$(n_calls '^docker compose (up|stop|restart)')" = 0
  check "migrate-check fails: :latest is the old image again" test "$(cut -d'|' -f1 "$S/images/banking-app_latest")" = 0.1.0
  check "migrate-check fails: no :previous image and no state file for an update that did not happen" bash -c "[[ ! -e '$S/images/banking-app_previous' && ! -e '$CL/backups/.last-update' ]]"
  check "migrate-check fails: the copy of the failed attempt is removed" grep -q 'rmSync' "$S/calls.log"
  check "migrate-check fails: checkout unchanged" test "$(head_commit)" = "$before"
  rm -f "$S/migrate-fail" "$S/reports"/*; poll update "$ID2"; tick
  check "migrate-check fails: the next attempt updates" test "$(cver)" = 0.2.0
  check "migrate-check fails: and :previous is the old version, not the failed new one" test "$(cut -d'|' -f1 "$S/images/banking-app_previous")" = 0.1.0
}
t_migrate_check_could_not_run() {
  # exit codes other than the check's own 1 (125 to 127 docker, 137 out of memory) say nothing about the migrations
  new_world; release 0.2.0; echo 137 >"$S/migrate-crash"; poll update
  tick
  check "migrate-check crashed: reported failed with a summary that does not blame the migrations" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/1.json' && grep -q 'ei voitu ajaa' '$S/reports/1.json' && ! grep -q 'tietokantamuutokset' '$S/reports/1.json'"
  check "migrate-check crashed: the log says the check could not run and gives the code" grep -q 'migration check could not run (exit code 137)' "$S/reports/1.json"
  check "migrate-check crashed: the exit code of update.sh is 4, not the 3 of a failed check" grep -q '"exit_code":4' "$S/reports/1.json"
  check "migrate-check crashed: the old version is still running on its own image" bash -c "[[ \$(cat '$S/cver') = 0.1.0 && \$(cut -d'|' -f1 '$S/images/banking-app_latest') = 0.1.0 ]]"
  check "migrate-check crashed: nothing was stopped or started" test "$(n_calls '^docker compose (up|stop|restart)')" = 0
  rm -f "$S/migrate-crash" "$S/reports"/*; touch "$S/migrate-fail"; poll update "$ID2"; tick
  check "migrate-check fails (rc 1) is still exit code 3 and blames the migrations" bash -c "grep -q '\"exit_code\":3' '$S/reports/1.json' && grep -q 'tietokantamuutokset' '$S/reports/1.json'"
}
t_migrate_check_fails_source() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; touch "$S/migrate-fail"; poll update
  local before; before=$(head_commit)
  tick
  check "migrate-check fails (source): reported failed" reported failed
  check "migrate-check fails (source): the old version is still running" test "$(cver)" = 0.1.0
  check "migrate-check fails (source): the checkout is back, so the next run starts the whole update again" test "$(head_commit)" = "$before"
}
t_interrupted_update_keeps_latest() {
  # the helper ends an update that hangs in the migration check (its timeout sends TERM)
  new_world; release 0.2.0; touch "$S/migrate-hang"; poll update
  local before; before=$(head_commit)
  tick env OPS_T_UPDATE=5
  check "interrupted: reported failed, the old version still runs" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/1.json' && [[ \$(cat '$S/cver') = 0.1.0 ]]"
  check "interrupted: :latest is the old image again, not the new one that was never checked" test "$(cut -d'|' -f1 "$S/images/banking-app_latest")" = 0.1.0
  check "interrupted: nothing was stopped, started or restarted" test "$(n_calls '^docker compose (up|stop|restart)')" = 0
  check "interrupted: checkout unchanged" test "$(head_commit)" = "$before"
  rm -f "$S/migrate-hang" "$S/reports"/*; poll update "$ID2"; tick
  check "interrupted: the next update works" bash -c "grep -q '\"status\":\"ok\"' '$S/reports/1.json' && [[ \$(cat '$S/cver') = 0.2.0 ]]"
  check "interrupted: and :previous is the version that ran, so a rollback has an image to go back to" test "$(cut -d'|' -f1 "$S/images/banking-app_previous")" = 0.1.0
}
t_previous_is_the_running_image() {
  # an earlier run was killed (SIGKILL, no trap) after :latest moved to a new image; the container still runs 0.1.0
  new_world; release 0.2.0; release 0.3.0
  echo "0.2.0|$(git -C "$W/seed" rev-parse v0.2.0)|1" >"$S/images/banking-app_latest"
  poll update; tick
  check "previous: the update reached 0.3.0" test "$(cver)" = 0.3.0
  check "previous: :previous is the image that was running (0.1.0), not the :latest left behind (0.2.0)" test "$(cut -d'|' -f1 "$S/images/banking-app_previous")" = 0.1.0
  rm -f "$S/reports"/*; poll rollback "$ID2"; tick
  check "previous: the rollback goes back to 0.1.0" bash -c "grep -q '\"status\":\"ok\"' '$S/reports/1.json' && [[ \$(cat '$S/cver') = 0.1.0 ]]"
}
t_source_failed_build_keeps_checkout() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; touch "$S/failbuild"; poll update
  local before; before=$(head_commit)
  tick
  check "source build fails: reported failed, the old version runs" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/1.json' && [[ \$(cat '$S/cver') = 0.1.0 ]]"
  check "source build fails: the checkout is back on the commit that runs" test "$(head_commit)" = "$before"
  rm -f "$S/reports"/*; poll check-update op_5555555555555555; tick
  check "source build fails: the next check still offers the update (the checkout is not ahead)" grep -q '"update_available":true' "$S/reports/1.json"
  rm -f "$S/failbuild" "$S/reports"/*; poll update "$ID2"; tick
  check "source build fails: the retry is a whole update, with the copy and the migration check" test "$(n_calls '^MIGRATE_CHECK ')" = 1
  check "source build fails: and it reaches the new commit" bash -c "[[ \$(git -C '$CL' rev-parse HEAD) = \$(git -C '$W/seed' rev-parse HEAD) ]] && grep -q '\"status\":\"ok\"' '$S/reports/1.json'"
}
t_migrate_check_missing_in_old_image() {
  new_world; release 0.2.0; touch "$S/no-migrate-check"; poll update; tick
  check "migrate-check missing: the update goes on, reported ok" reported ok
  check "migrate-check missing: no check was run on the copy" test "$(n_calls '^MIGRATE_CHECK ')" = 0
  check "migrate-check missing: the output says so" grep -q 'no migration check' "$S/reports/1.json"
}
t_health_wait_follows_check() {
  local p
  probes() { awk '/^MIGRATE_CHECK /{f=1} f && /wget/{n++} END{print n+0}' "$S/calls.log"; }
  new_world; release 0.2.0; touch "$S/bad_0.2.0"; poll update; tick
  p=$(probes)
  check "health wait: a quick check keeps 120 s (60 probes, $p seen)" test "$p" -ge 60 -a "$p" -le 70
  new_world; release 0.2.0; touch "$S/bad_0.2.0"; echo 100000 >"$S/migrate-ms"; poll update; tick
  p=$(probes)
  check "health wait: a check of 100 s gives 300 s (150 probes, $p seen)" test "$p" -ge 150 -a "$p" -le 160
  # the helper ends an update after OPS_T_UPDATE seconds and tells update.sh when (TALOUS_DEADLINE); the wait stops 60 s before
  new_world; release 0.2.0; touch "$S/bad_0.2.0"; echo 100000 >"$S/migrate-ms"; poll update; tick env OPS_T_UPDATE=200
  p=$(probes)
  check "health wait: a long wait is cut to the time the helper has left (about 70 probes, $p seen)" test "$p" -ge 60 -a "$p" -le 85
  # healthy() itself: seconds by the clock, the deadline, and a deadline that is not a number
  # healthy reads two clocks, `date +%s` and the shell's SECONDS. Both are the test's here: date answers $now, and SECONDS,
  # unset, is a plain number that only a probe moves. So no result depends on how long the machine takes.
  local now=2000000000
  probe_count() { # probe_count WAIT DEADLINE PROBE_SECONDS: how many probes healthy makes
    HW=$1 DL=$2 PS=$3 NOW=$now SRC_FILE="$SRC/scripts/lib/preflight.sh" bash -c '
      n=0; HEALTH_WAIT=$HW; TALOUS_DEADLINE=$DL
      unset SECONDS; SECONDS=0
      date() { echo "$NOW"; }
      app_up() { n=$((n + 1)); SECONDS=$((SECONDS + PS)); return 1; }
      docker() { case $* in *"compose ps"*) echo cid ;; *inspect*) echo 0 ;; esac; }
      sleep() { :; }
      source <(sed -n "/^healthy()/,/^}/p" "$SRC_FILE")
      healthy || true
      echo $n' 2>/dev/null
  }
  check "healthy: 120 s of instant probes is 60 probes (each turn counts its 2 s sleep)" test "$(probe_count 120 '' 0)" = 60
  check "healthy: probes that take 3 s each count as 3 s, so 120 s is 40 probes" test "$(probe_count 120 '' 3)" = 40
  check "healthy: a deadline far away changes nothing (900 s, 450 probes)" test "$(probe_count 900 $((now + 1200)) 0)" = 450
  check "healthy: a deadline 200 s away leaves 140 s (70 probes)" test "$(probe_count 900 $((now + 200)) 0)" = 70
  check "healthy: a deadline already past still waits 60 s (30 probes)" test "$(probe_count 900 $((now - 100)) 0)" = 30
  check "healthy: a deadline that is not a number is ignored" test "$(probe_count 120 'soon; id' 0)" = 60
  # the bounds, on the function itself (a run at the upper bound is 450 probes)
  local ms
  for ms in 40 39999 40000 100000 300000 5000000; do
    check "health wait: a check of $ms ms" bash -c "
      MS=$ms; HEALTH_WAIT=120
      migrate_check_available() { return 0; }
      run_logged() { printf '%s\n' \"{\\\"ok\\\":true,\\\"file\\\":\\\"/data/x.db\\\",\\\"elapsed_ms\\\":\$MS,\\\"migrate_ms\\\":1}\" 'migrate-check: ok' >\"\$1\"; }
      ok() { :; }; say() { :; }
      source <(sed -n '/^preflight_migrations()/,/^}/p' '$SRC/scripts/lib/preflight.sh')
      preflight_migrations /data/x.db
      case $ms in 40|39999|40000) want=120 ;; 100000) want=300 ;; 300000) want=900 ;; *) want=900 ;; esac
      [[ \$HEALTH_WAIT = \$want ]] || { echo \"got \$HEALTH_WAIT want \$want\"; exit 1; }"
  done
}
t_state_file_written_whole() {
  new_world; release 0.2.0; poll update; tick
  check "state file: written next to its name and flushed before the rename" grep -qx 'sync backups/.last-update.new' "$S/calls.log"
  check "state file: its folder is flushed after the rename" test "$(line_of '^sync backups/.last-update.new$')" -lt "$(line_of '^sync backups$')"
  check "state file: complete, mode 600, no temp file left" bash -c "cd '$CL/backups' && [[ ! -e .last-update.new && \$(stat -c %a .last-update) = 600 ]] && grep -q '^AT=' .last-update && grep -q '^PREV_COMMIT=' .last-update && grep -q '^SNAPSHOT=/data/backups/pre-update-' .last-update && grep -q '^PREV_VERSION=0.1.0' .last-update && grep -q '^INSTANCE=' .last-update"
  new_world; release 0.2.0; touch "$S/sync-fail-paths"; poll update; tick
  check "state file: a flush of the file that fails is not papered over by a plain sync (no state file, update stops)" bash -c "[[ ! -e '$CL/backups/.last-update' && ! -e '$CL/backups/.last-update.new' ]] && grep -q '\"status\":\"failed\"' '$S/reports/1.json' && [[ \$(cat '$S/cver') = 0.1.0 ]]"
  check "state file: and only the flush of the file was asked for, never a plain sync" test "$(n_calls '^sync $')" = 0
  new_world; release 0.2.0; touch "$S/sync-fail"; poll update; tick
  check "state file: if it cannot be flushed the update stops, no state file or temp file is left" bash -c "[[ ! -e '$CL/backups/.last-update' && ! -e '$CL/backups/.last-update.new' ]]"
  check "state file: and the old version keeps running on its own image" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/1.json' && [[ \$(cat '$S/cver') = 0.1.0 && \$(cut -d'|' -f1 '$S/images/banking-app_latest') = 0.1.0 ]]"
}
t_rollback_checks_the_copy_first() {
  new_world; release 0.2.0; poll update; tick
  : >"$S/calls.log"; rm -f "$S/reports"/*
  touch "$S/snapshot-bad"; poll rollback "$ID2"; tick
  check "rollback: a missing or damaged copy is reported failed" reported failed
  check "rollback: nothing was stopped, started or retagged" test "$(n_calls '^docker compose (stop|up|start)|^docker image tag')" = 0
  check "rollback: the new version is still running" test "$(cver)" = 0.2.0
  check "rollback: the reason is in the log" grep -q 'database copy unusable' "$S/reports/1.json"
  check "rollback: the state file stays, so the rollback can be tried again" test -f "$CL/backups/.last-update"
  rm -f "$S/snapshot-bad" "$S/reports"/*; : >"$S/calls.log"; poll rollback op_aaaaaaaaaaaaaaaa; tick
  check "rollback: with an intact copy it goes back" test "$(cver)" = 0.1.0
  check "rollback: the copy named in the state file was checked before the app was stopped" test "$(line_of '^DBCHECK /data/backups/pre-update-')" -lt "$(line_of '^docker compose stop')"
}
t_schema_changed_is_reported() {
  new_world; release 0.2.0; touch "$S/schema-changed"; poll update; tick
  check "schema_changed: update.sh compared the live database with the pre-update copy after the start" test "$(line_of '^docker compose up')" -lt "$(line_of '^SCHEMA_CHECK /data/backups/pre-update-')"
  check "schema_changed: the state file records it and keeps its other keys, mode 600" bash -c "cd '$CL/backups' && grep -qx 'SCHEMA_CHANGED=yes' .last-update && grep -q '^SNAPSHOT=/data/backups/pre-update-' .last-update && grep -q '^PREV_VERSION=0.1.0' .last-update && [[ \$(stat -c %a .last-update) = 600 && ! -e .last-update.new ]]"
  check "schema_changed: the update's report carries schema_changed true" grep -q '"schema_changed":true' "$S/reports/1.json"
  poll rollback "$ID2"; tick
  check "schema_changed: after the rollback the state says nothing can be rolled back and no schema change" bash -c "grep -q '\"can_rollback\":false' '$S/reports/2.json' && grep -q '\"schema_changed\":false' '$S/reports/2.json'"
  new_world; release 0.2.0; poll update; tick
  check "schema_changed: an update that changed nothing records no" grep -qx 'SCHEMA_CHANGED=no' "$CL/backups/.last-update"
  check "schema_changed: and the report says false" grep -q '"schema_changed":false' "$S/reports/1.json"
  # An older update.sh (the 0.5.x one that installs 0.6.0, which adds migration 0009) writes no such line, and a
  # comparison that failed writes none either. Silence must not hide a change: only "no" is trusted.
  sed -i '/^SCHEMA_CHANGED=/d' "$CL/backups/.last-update"; rm -f "$S/state.last" "$CL/ops/boot_id"; tick
  check "schema_changed: a state file without the key is reported as true" grep -q '"schema_changed":true' "$S/state.last"
  new_world; release 0.2.0; touch "$S/schema-fail"; poll update; tick
  check "schema_changed: a comparison that failed leaves the key out of the state file" bash -c "! grep -q '^SCHEMA_CHANGED=' '$CL/backups/.last-update'"
  check "schema_changed: and the report warns (true) all the same" grep -q '"schema_changed":true' "$S/reports/1.json"
  check "schema_changed: the update itself still succeeded" bash -c "grep -q '\"status\":\"ok\"' '$S/reports/1.json'"
  # with nothing to roll back there is nothing to warn about
  rm -f "$CL/backups/.last-update" "$S/state.last" "$CL/ops/boot_id"; tick
  check "schema_changed: no state file, no warning" grep -q '"schema_changed":false' "$S/state.last"
}
t_rollback_restore_is_flushed() {
  # the update changed the schema and the previous image refuses the database (its check exits 1), so the rollback restores the pre-update copy
  new_world; release 0.2.0; poll update; tick
  : >"$S/calls.log"; rm -f "$S/reports"/*; touch "$S/restore-needed"; echo 1 >"$S/previous-check"; poll rollback "$ID2"; tick
  check "rollback restore: reported ok, the old version is back" bash -c "grep -q '\"status\":\"ok\"' '$S/reports/1.json' && [[ \$(cat '$S/cver') = 0.1.0 ]]"
  check "rollback restore: the pre-update copy is restored" grep -q 'Database restored: /data/backups/pre-update-' "$S/reports/1.json"
  check "rollback restore: what is overwritten is saved first" test "$(line_of '^SNAPSHOT /data/backups/pre-rollback-')" -lt "$(line_of 'entrypoint sh banking -c')"
  check "rollback restore: the copy is flushed before it replaces the database, /data after" grep -qF 'cp "$1" /data/banking.db.restore; sync /data/banking.db.restore; rm -f /data/banking.db-wal /data/banking.db-shm; mv /data/banking.db.restore /data/banking.db; sync /data || echo "warning: could not flush /data" >&2' "$S/calls.log"
}
# A rollback whose migration history differs from the pre-update copy (the update changed the schema) asks the previous
# image whether it opens the database as it is. Only then does the data written since the update stay.
# a rollback after a schema change ("restore-needed" makes the stub's comparison differ), the previous image's check ending in CODE
roll() { # roll [CODE [APPLIED [STUBFILE]]]: the exit code of the check, what its JSON lists as applied, a stub file to create
  new_world; release 0.2.0; poll update; tick
  : >"$S/calls.log"; rm -f "$S/reports"/*
  touch "$S/restore-needed"; [[ -z ${1:-} ]] || echo "$1" >"$S/previous-check"
  [[ -z ${2:-} ]] || echo "$2" >"$S/previous-applied"; [[ -z ${3:-} ]] || touch "$S/$3"
  poll rollback "$ID2"; tick
}
restored() { grep -q 'Database restored: /data/backups/pre-update-' <<<"$(report)"; }
t_rollback_asks_the_previous_image_accepts() {
  # (a) the previous image accepts the database: it stays, after a copy
  roll
  check "rollback keeps: reported ok, the old version is back" bash -c "[[ \$(cat '$S/cver') = 0.1.0 ]] && grep -q '\"status\":\"ok\"' '$S/reports/1.json'"
  check "rollback keeps: the previous image's own check ran on the live database, no network, the data volume" grep -qE '^PREVIOUS_CHECK run --rm --name banking-app-rollback-check --network none .*-v vol:/data .*--entrypoint node banking-app:previous .*dist/node.js migrate-check /data/banking.db$' "$S/calls.log"
  check "rollback keeps: the check ran once the app was stopped" test "$(line_of '^docker compose stop')" -lt "$(line_of '^PREVIOUS_CHECK ')"
  check "rollback keeps: the database is not replaced" test "$(n_calls 'entrypoint sh banking -c')" = 0
  check "rollback keeps: the one-off container has a name of its own, and nothing is removed by hand after a yes" bash -c "grep -qE '^PREVIOUS_CHECK run .*--name banking-app-rollback-check ' '$S/calls.log' && [[ \$(grep -c '^docker rm' '$S/calls.log') = 0 ]]"
  check "rollback keeps: the report says the data stays" grep -qF 'The previous version can read the database as it is, so the data written since the update stays.' "$S/reports/1.json"
  check "rollback keeps: no word of a restore" bash -c "! grep -q 'Database restored' '$S/reports/1.json'"
  check "rollback keeps: the pre-rollback copy comes after the check" test "$(line_of '^PREVIOUS_CHECK ')" -lt "$(line_of '^SNAPSHOT /data/backups/pre-rollback-')"
  check "rollback keeps: and before the old version starts" test "$(line_of '^SNAPSHOT /data/backups/pre-rollback-')" -lt "$(line_of '^docker compose up')"
  check "rollback keeps: the previous image became :latest and the state file is spent" bash -c "grep -q '^docker image tag banking-app:previous banking-app:latest' '$S/calls.log' && [[ ! -e '$CL/backups/.last-update' ]]"
}
t_rollback_asks_the_previous_image_restores() {
  # (b) the previous image refuses the database (its check exits 1): the copy is restored as before
  roll 1
  check "rollback restores: the check ran once and refused" test "$(n_calls '^PREVIOUS_CHECK ')" = 1
  check "rollback restores: the check's container is removed by name, before the restore" test "$(line_of '^docker rm -f banking-app-rollback-check')" -lt "$(line_of 'entrypoint sh banking -c')"
  check "rollback restores: reported ok, the old version is back" bash -c "[[ \$(cat '$S/cver') = 0.1.0 ]] && grep -q '\"status\":\"ok\"' '$S/reports/1.json'"
  check "rollback restores: the pre-update copy replaces the database" restored
  check "rollback restores: what is overwritten is saved first" test "$(line_of '^SNAPSHOT /data/backups/pre-rollback-')" -lt "$(line_of 'entrypoint sh banking -c')"
  check "rollback restores: no word of the data staying" bash -c "! grep -q 'data written since the update stays' '$S/reports/1.json'"
}
t_rollback_asks_the_previous_image_without_the_command() {
  # (c) an image without the command, a docker error and a usage answer: the same restore
  new_world; release 0.2.0; poll update; tick
  : >"$S/calls.log"; rm -f "$S/reports"/*
  touch "$S/restore-needed" "$S/no-migrate-check"; poll rollback "$ID2"; tick
  check "rollback, image without migrate-check: only asked whether it has the command, the live database never mounted" bash -c "[[ \$(grep -cE '^docker run .*banking-app:previous .*migrate-check \$' '$S/calls.log') = 1 && \$(grep -c '^PREVIOUS_CHECK ' '$S/calls.log') = 0 ]]"
  check "rollback, image without migrate-check: the copy is restored" restored
  roll 125
  check "rollback, docker error (exit 125): the copy is restored" restored
}
t_rollback_asks_the_previous_image_exit_zero_with_work() {
  # exit 0 is not enough: the check's JSON has to say that nothing is applied to the database
  roll 0 '["0009_x.sql"]'
  check "rollback, exit 0 with a migration to apply: the copy is restored and the message says why" bash -c "grep -q 'Database restored: /data/backups/pre-update-' '$S/reports/1.json' && grep -q 'changes of its own' '$S/reports/1.json'"
  roll 0 '' previous-nojson
  check "rollback, exit 0 without the JSON line: the copy is restored" restored
}
t_rollback_asks_the_previous_image_killed_or_usage() {
  # the client was killed (137) or timed out (124): the container is removed by name and the message names the time
  roll 137
  check "rollback, a killed check (exit 137): the copy is restored, the container removed, the time named" bash -c "grep -q '^docker rm -f banking-app-rollback-check' '$S/calls.log' && grep -q 'took longer than' '$S/reports/1.json' && ! grep -q 'could not be asked' '$S/reports/1.json'"
  roll 2
  check "rollback, a usage answer (exit 2) is no yes: the copy is restored" restored
}
t_rollback_asks_the_previous_image_same_history() {
  # (d) the same migration history: nothing to ask, the database stays
  new_world; release 0.2.0; poll update; tick
  : >"$S/calls.log"; rm -f "$S/reports"/*; poll rollback "$ID2"; tick
  check "rollback, same history: reported ok, the old version is back" bash -c "[[ \$(cat '$S/cver') = 0.1.0 ]] && grep -q '\"status\":\"ok\"' '$S/reports/1.json'"
  check "rollback, same history: the previous image is not run for a check" test "$(n_calls '^docker run .*banking-app:previous')" = 0
  check "rollback, same history: the database stays, as it always did" grep -qF 'The database is unchanged, so the data stays.' "$S/reports/1.json"
  check "rollback, same history: no restore and no pre-rollback copy" test "$(n_calls 'pre-rollback-|entrypoint sh banking -c')" = 0
}
t_rollback_asks_the_previous_image_copy_fails() {
  # a copy that cannot be made stops a rollback that would keep the database too: the current version starts again, nothing changed
  new_world; release 0.2.0; poll update; tick
  : >"$S/calls.log"; rm -f "$S/reports"/*
  touch "$S/restore-needed" "$S/fail-snapshot"; poll rollback "$ID2"; tick
  check "rollback keeps, copy fails: reported failed, the new version runs on its own image" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/1.json' && [[ \$(cat '$S/cver') = 0.2.0 && \$(cut -d'|' -f1 '$S/images/banking-app_latest') = 0.2.0 ]]"
  check "rollback keeps, copy fails: the app was started again and :latest was not moved" bash -c "[[ \$(grep -c '^docker compose start' '$S/calls.log') = 1 && \$(grep -c '^docker image tag banking-app:previous banking-app:latest' '$S/calls.log') = 0 ]]"
  check "rollback keeps, copy fails: the state file stays, so the rollback can be tried again" test -f "$CL/backups/.last-update"
  # the same on the restore path: nothing is replaced and the app is not left stopped
  new_world; release 0.2.0; poll update; tick
  : >"$S/calls.log"; rm -f "$S/reports"/*
  touch "$S/restore-needed" "$S/fail-snapshot"; echo 1 >"$S/previous-check"; poll rollback "$ID2"; tick
  check "rollback restores, copy fails: reported failed, the new version runs on its own image" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/1.json' && [[ \$(cat '$S/cver') = 0.2.0 && \$(cut -d'|' -f1 '$S/images/banking-app_latest') = 0.2.0 ]]"
  check "rollback restores, copy fails: the app was started again, the database not replaced, :latest not moved" bash -c "[[ \$(grep -c '^docker compose start' '$S/calls.log') = 1 && \$(grep -c 'entrypoint sh banking -c' '$S/calls.log') = 0 && \$(grep -c '^docker image tag banking-app:previous banking-app:latest' '$S/calls.log') = 0 ]]"
  check "rollback restores, copy fails: the state file stays, so the rollback can be tried again" test -f "$CL/backups/.last-update"
  # (e) a check that hangs is cut off after PREVIOUS_CHECK_WAIT and does not count as a yes
  new_world; release 0.2.0; poll update; tick
  : >"$S/calls.log"; touch "$S/previous-hang"
  local t0=$SECONDS rc=0
  OPS_STUB_DIR=$S PATH="$S/bin:$PATH" IMAGE=banking-app SRC_FILE="$SRC/scripts/lib/preflight.sh" bash -c '
    PREVIOUS_CHECK_WAIT=1
    say() { :; }; project_name() { echo clone; }
    run_logged() { local log=$1; shift 2; "$@" >"$log" 2>&1; }
    source <(sed -n "/^migrate_check_available()/,/^}/p; /^data_volume()/,/^}/p; /^previous_reads_database()/,/^}/p" "$SRC_FILE")
    previous_reads_database' >/dev/null 2>"$W/hang.err" || rc=$?
  check "rollback, a hanging check: cut off, not accepted" bash -c "[[ $rc -ne 0 && $((SECONDS - t0)) -lt 30 ]] && grep -q '^PREVIOUS_CHECK ' '$S/calls.log'"
  check "rollback, a hanging check: the container is removed by name and the message names the time" bash -c "grep -q '^docker rm -f banking-app-rollback-check' '$S/calls.log' && grep -q 'took longer than 1 s' '$W/hang.err'"
}
t_release_rollback_action() {
  new_world; release 0.2.0; poll update; tick
  poll rollback "$ID2"; tick
  check "rollback: previous version is back" test "$(cver)" = 0.1.0
  check "rollback: reported ok" reported ok
  poll rollback op_aaaaaaaaaaaaaaaa; tick
  check "rollback: only one rollback per update" reported failed
}
t_release_pull_fails() {
  new_world; release 0.2.0; touch "$S/pullfail"; poll update; tick
  check "release: failed pull reported failed, old version running" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/1.json' && [[ $(cat "$S/cver") = 0.1.0 ]]"
}
t_release_api_offline() {
  new_world; echo 503 >"$S/release.status"; poll check-update; tick
  check "release: API error reported as failed check, nothing else" reported failed
  check "release: API error changes nothing" test "$(n_calls '^docker (pull|build|compose up)')" = 0
}
t_release_fixed_url() {
  new_world; release 0.2.0; poll check-update; tick
  check "release: the Releases API of the project is the only URL asked" test "$(calls | grep -c '^curl ' )" = 1
  check "release: check reports the new version" grep -q '"update_available":true' "$S/reports/1.json"
}
t_tag_not_forward() {
  new_world; release 0.2.0; git -C "$W/seed" push -q -f origin "$C1:refs/heads/main" 2>/dev/null
  # the release tag now points at a commit that does not descend from this checkout's HEAD
  git -C "$CL" fetch -q origin 2>/dev/null; git -C "$CL" merge -q --ff-only origin/main 2>/dev/null
  echo "x" >"$W/seed/other"; git -C "$W/seed" add -A; git -C "$W/seed" commit -qm other; git -C "$W/seed" push -q origin main 2>/dev/null
  git -C "$CL" fetch -q origin 2>/dev/null; git -C "$CL" merge -q --ff-only origin/main 2>/dev/null
  poll update; tick
  check "release: a tag that is not a step forward is refused" reported failed
  check "release: refused tag, nothing pulled" test "$(n_calls '^docker pull')" = 0
}

# ── source mode ─────────────────────────────────────────────────────────────
t_source_update() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; src_commit
  echo 'export const APP_VERSION = "0.1.1";' >"$W/seed/apps/server/src/version.ts"; git -C "$W/seed" add -A; git -C "$W/seed" commit -qm v; git -C "$W/seed" push -q origin main 2>/dev/null
  poll update; tick
  check "source: fast-forward update reported ok" reported ok
  check "source: built and started" bash -c "[[ $(grep -c '^docker compose build' "$S/calls.log") = 1 && $(cver) = 0.1.1 ]]"
  check "source: checkout moved to origin/main" test "$(head_commit)" = "$(git -C "$W/seed" rev-parse HEAD)"
}
t_source_force_push() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; src_commit; git -C "$CL" fetch -q origin 2>/dev/null; git -C "$CL" merge -q --ff-only origin/main
  local before; before=$(head_commit)
  git -C "$W/seed" reset -q --hard "$C1"; src_commit; git -C "$W/seed" push -q -f origin main 2>/dev/null
  poll update; tick
  check "source: force-pushed branch refused" reported failed
  check "source: force push, no build" test "$(n_calls '^docker compose build')" = 0
  check "source: force push, checkout unchanged" test "$(head_commit)" = "$before"
}
t_source_url_branch_dirty() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit
  git -C "$CL" remote set-url origin "file://$W/elsewhere.git"; poll update; tick
  check "source: changed remote URL refused" bash -c "grep -q 'Päivityslähde on muuttunut' '$S/reports/1.json'"
  git -C "$CL" remote set-url origin "file://$W/origin.git"; rm -f "$S/reports"/*
  git -C "$CL" checkout -q -b other; poll update "$ID2"; tick
  check "source: changed branch refused" grep -q 'Päivityslähteen versiolinja on muuttunut' <<<"$(report)"
  git -C "$CL" checkout -q main; echo dirty >>"$CL/scripts/doctor.sh"; rm -f "$S/reports"/*
  poll update op_1111111111111111; tick
  check "source: dirty tree refused" grep -q 'muutettu käsin' <<<"$(report)"
  check "source: none of the refusals built anything" test "$(n_calls '^docker compose build')" = 0
}
t_source_remote_types() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit
  local u
  for u in http://example.invalid/x.git git://example.invalid/x.git ext::sh%20-c%20id; do
    git -C "$CL" remote set-url origin "$u"; printf 'REMOTE_URL=%s\nBRANCH=main\n' "$u" >"$CL/ops/policy"
    rm -f "$S/reports"/*; poll update; tick
    check "source: remote $u refused" reported failed
  done
  check "source: no fetch or build from a refused scheme" test "$(n_calls '^docker (compose build|pull)')" = 0
}
# inject ANCHOR_REGEX TEXT: TEXT after the first line of the seed's compose file that matches
inject() { awk -v re="$1" -v add="$2" '{print} $0 ~ re && !d {print add; d=1}' "$W/seed/docker-compose.yml" >"$W/seed/dc.new" && mv "$W/seed/dc.new" "$W/seed/docker-compose.yml"; }
# policy_case NAME CMD...: a fresh seed at the first commit, CMD changes it, one source update must be refused
policy_case() {
  local name=$1; shift
  git -C "$W/seed" fetch -q origin 2>/dev/null; git -C "$W/seed" reset -q --hard "$C1"; git -C "$W/seed" clean -qfd; git -C "$W/seed" push -q -f origin main 2>/dev/null; git -C "$CL" fetch -q origin 2>/dev/null
  "$@"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "evil compose"; git -C "$W/seed" push -q origin main 2>/dev/null
  rm -f "$S/reports"/*; : >"$S/calls.log"; poll update; tick
  check "source: $name refused before build" bash -c "grep -q 'turvasääntöjä' '$S/reports/1.json' && [[ $(grep -c '^docker compose build' "$S/calls.log") = 0 ]]"
}
t_source_compose_policy() {
  new_world; setenv TALOUS_CHANNEL=source
  [[ -x /usr/bin/docker ]] && /usr/bin/docker compose version >/dev/null 2>&1 || { fail "compose policy: needs docker compose on this machine"; return; }
  policy_case "privileged" inject '^  banking:$' "    privileged: true"
  policy_case "quoted privileged and pid" inject '^  banking:$' '    "privileged": true\n    "pid": "host"'
  policy_case "flow merge" inject '^  banking:$' "    <<: {privileged: true, pid: host}"
  policy_case "cap_add" inject '^  banking:$' "    cap_add: [SYS_ADMIN]"
  policy_case "network_mode host" inject '^  banking:$' "    network_mode: host"
  policy_case "long bind of /" inject 'banking-secrets:/secrets' '      - type: bind\n        source: /\n        target: /host'
  policy_case "flow bind of /" inject 'banking-secrets:/secrets' "      - {type: bind, source: /, target: /host}"
  policy_case "short bind of the Docker socket" inject 'banking-secrets:/secrets' "      - /var/run/docker.sock:/var/run/docker.sock"
  policy_case "named volume bound to a host path" sed -i 's#^  banking-data:$#  banking-data:\n    driver_opts: {type: none, o: bind, device: /root}#' "$W/seed/docker-compose.yml"
  policy_case "top-level secret from a host file" bash -c "printf 'secrets:\n  sh:\n    file: /etc/shadow\n' >>'$W/seed/docker-compose.yml' && awk '{print} /banking-secrets:\/secrets/ && !d {print \"    secrets: [sh]\"; d=1}' '$W/seed/docker-compose.yml' >'$W/seed/dc.new' && mv '$W/seed/dc.new' '$W/seed/docker-compose.yml'"
  policy_case "other image" sed -i 's#image: caddy:2#image: evil/caddy:2#' "$W/seed/docker-compose.yml"
  policy_case "other service" inject '^services:$' "  extra:\n    image: caddy:2"
  policy_case "extra capability-free key (devices)" inject '^  banking:$' "    devices: [/dev/sda:/dev/sda]"
  policy_case "a compose.yaml next to it" bash -c "printf 'services: {}\n' >'$W/seed/compose.yaml'"
  policy_case "an override file" bash -c "printf 'services: {}\n' >'$W/seed/docker-compose.override.yml'"
  local i h; h=$(printf %064d 0); for i in evil/cloudflared:2026.9.1 "evil/cloudflared:latest@sha256:$h" ghcr.io/cloudflare/cloudflared:2026.9.1 cloudflare/cloudflared:2026.9.1-arm64 cloudflare/cloudflared:2026.9 "cloudflare/cloudflared:2026.9.1@sha256:${h:1}" "cloudflare/cloudflared@sha256:$h" "cloudflare/cloudflared:latest@sha256:$h"; do policy_case "tunnel image $i" sed -i "s#image: cloudflare/cloudflared.*#image: $i#" "$W/seed/docker-compose.yml"; done
}
t_real_compose_passes() { # as it is, and with the tunnel image at latest or pinned to a cloudflared release, with and without a digest
  new_world; setenv TALOUS_CHANNEL=source
  [[ -x /usr/bin/docker ]] && /usr/bin/docker compose version >/dev/null 2>&1 || { fail "compose policy: needs docker compose on this machine"; return; }
  local i; for i in '' latest 2026.9.1 "2026.9.1@sha256:$(printf %064d 0)"; do [[ -z $i ]] || sed -i "s#image: cloudflare/cloudflared.*#image: cloudflare/cloudflared:$i#" "$W/seed/docker-compose.yml"; src_commit
    check "source: the project's own docker-compose.yml passes the policy check${i:+ with the tunnel image at $i}" bash -c "cd '$CL' && export PATH='$S/bin:/usr/bin:/bin' && mkdir -p ops/run && source <(sed -n '/^COMPOSE_JQ=/,/^}/p' scripts/ops-helper.sh) && OPS=ops && git fetch -q origin && git show origin/main:docker-compose.yml | grep 'image: cloudflare/cloudflared.*$i\$' >/dev/null && compose_policy_ok origin/main || { echo \"\$POLICY_MSG\"; exit 1; }"
  done
}
make_signers() {
  ssh-keygen -q -t ed25519 -N '' -f "$W/key1" -C k1; ssh-keygen -q -t ed25519 -N '' -f "$W/key2" -C k2
  printf 'test@example.com namespaces="git" %s\n' "$(cut -d' ' -f1,2 "$W/key1.pub")" >"$CL/ops/allowed_signers"; chmod 600 "$CL/ops/allowed_signers"
}
signed_commit() { # signed_commit KEYFILE
  echo "s$RANDOM" >>"$W/seed/CHANGES"; git -C "$W/seed" add -A
  git -C "$W/seed" -c gpg.format=ssh -c "user.signingkey=$1" commit -q -S -m signed && git -C "$W/seed" push -q origin main 2>/dev/null
}
t_source_signatures() {
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  src_commit; poll update; tick
  check "source: unsigned commit refused when a signers file exists" grep -q 'allekirjoittanut' <<<"$(report)"
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  signed_commit "$W/key2"; poll update; tick
  check "source: commit signed by another key refused" grep -q 'allekirjoittanut' <<<"$(report)"
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  src_commit; signed_commit "$W/key1"; poll update; tick
  check "source: a signed tip over an unsigned commit refused" grep -q 'allekirjoittanut' <<<"$(report)"
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  signed_commit "$W/key1"; poll update; tick
  check "source: commit signed by the trusted key goes through" reported ok
  check "source: only the good one built" test "$(n_calls '^docker compose build')" = 1
}
t_source_check_update() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; poll check-update; tick
  check "source: check lists the new commit" grep -q '"behind_commits":\[{"hash"' "$S/reports/1.json"
  check "source: check says an update is available" grep -q '"update_available":true' "$S/reports/1.json"
}

# ── the helper picks the commit, update.sh installs only that one ───────────
t_rt_tag_bypasses_signers() {
  # a signed commit on main, and an unsigned commit on a side branch tagged as a newer release
  new_world; make_signers
  signed_commit "$W/key1"
  local good; good=$(git -C "$W/seed" rev-parse HEAD)
  git -C "$W/seed" checkout -q -b side "$C1"
  printf 'echo pwned >>"$OPS_STUB_DIR/calls.log"\n' >>"$W/seed/scripts/ops-helper.sh"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "unsigned"; git -C "$W/seed" tag v0.9.0
  git -C "$W/seed" push -q origin side v0.9.0 2>/dev/null; git -C "$W/seed" checkout -q main
  echo "0.9.0|$(git -C "$W/seed" rev-parse v0.9.0)|1" >"$S/registry/0.9.0"
  setenv TALOUS_CHANNEL=source # GitHub saying "no release" with a release tag in the folder is no answer (channel.test.sh)
  git -C "$CL" fetch -q --tags origin 2>/dev/null
  poll update; tick
  check "tag bypass: the signed main commit is what gets installed" test "$(head_commit)" = "$good"
  check "tag bypass: the unsigned tag is not an ancestor of HEAD" bash -c "! git -C '$CL' merge-base --is-ancestor v0.9.0 HEAD"
  check "tag bypass: no release image pulled" test "$(n_calls '^docker pull')" = 0
  check "tag bypass: helper script unchanged" bash -c "! grep -q pwned '$CL/scripts/ops-helper.sh'"
}
t_rt_source_race() {
  # an unsigned commit lands after the helper's check, while update.sh is running
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  signed_commit "$W/key1"
  local good; good=$(git -C "$W/seed" rev-parse HEAD)
  printf 'cd "%s" && echo evil >>CHANGES && git add -A && git -c user.name=t -c user.email=t@example.com commit -qm evil && git push -q origin main 2>/dev/null\n' "$W/seed" >"$S/race.sh"
  poll update; tick
  check "source race: the late commit did land on the remote" bash -c "git -C '$W/origin.git' log --format=%s main | grep evil >/dev/null"
  check "source race: exactly the checked commit is installed" test "$(head_commit)" = "$good"
  check "source race: reported ok" reported ok
}
t_rt_previous_retag() {
  new_world; release 0.2.0; poll update; tick
  release 0.3.0; touch "$S/cosignfail"; rm -f "$S/reports"/*; poll update "$ID2"; tick
  check "previous: the failed update reported failed" reported failed
  check "previous: :previous is still the 0.1.0 image" test "$(cut -d'|' -f1 "$S/images/banking-app_previous")" = 0.1.0
  rm -f "$S/cosignfail" "$S/reports"/*; poll rollback op_aaaaaaaaaaaaaaaa; tick
  check "previous: a rollback after the failed update goes to 0.1.0" bash -c "[[ $(cver) = 0.1.0 ]]"
}
t_release_not_on_main() {
  # a release tag whose commit is on a side branch, not on the pinned branch
  new_world
  git -C "$W/seed" checkout -q -b side
  echo 'export const APP_VERSION = "0.2.0";' >"$W/seed/apps/server/src/version.ts"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm side; git -C "$W/seed" tag v0.2.0
  git -C "$W/seed" push -q origin side v0.2.0 2>/dev/null; git -C "$W/seed" checkout -q main
  echo "0.2.0|$(git -C "$W/seed" rev-parse v0.2.0)|1" >"$S/registry/0.2.0"
  printf '{\n  "tag_name": "v0.2.0",\n  "body": "x"\n}\n' >"$S/release.json"
  poll update; tick
  check "release: a tag that is not on the pinned branch is refused" reported failed
  check "release: nothing pulled for it" test "$(n_calls '^docker pull')" = 0
}
t_release_signers() {
  new_world; make_signers; release 0.2.0; poll update; tick
  check "release: unsigned release commit refused when a signers file exists" grep -q 'allekirjoittanut' <<<"$(report)"
  check "release: nothing pulled" test "$(n_calls '^docker pull')" = 0
  new_world; make_signers
  echo 'export const APP_VERSION = "0.2.0";' >"$W/seed/apps/server/src/version.ts"; git -C "$W/seed" add -A
  git -C "$W/seed" -c gpg.format=ssh -c "user.signingkey=$W/key1" commit -q -S -m "release 0.2.0"; git -C "$W/seed" tag v0.2.0
  git -C "$W/seed" push -q origin main v0.2.0 2>/dev/null
  echo "0.2.0|$(git -C "$W/seed" rev-parse HEAD)|1" >"$S/registry/0.2.0"
  printf '{\n  "tag_name": "v0.2.0",\n  "body": "x"\n}\n' >"$S/release.json"
  poll update; tick
  check "release: a signed release commit goes through" reported ok
}
t_git_config_pinned() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit
  printf '[gpg "ssh"]\n\tprogram = %s/pwn.sh\n' "$W" >>"$CL/.git/config"
  printf '#!/bin/sh\ntouch %s/pwned\nexit 1\n' "$W" >"$W/pwn.sh"; chmod +x "$W/pwn.sh"
  make_signers; poll update; tick
  check "git config: gpg.ssh.program from .git/config is not run" test ! -e "$W/pwned"
  chmod 664 "$CL/.git/config"; : >"$S/calls.log"; rm -f "$S/reports"/*; poll backup op_9999999999999999; tick
  check "git config: a group-writable .git/config stops the helper" bash -c "[[ $TICK_RC != 0 && \$(grep -c 'backup.sh ran' '$S/calls.log') = 0 ]]"
}

# ── the poll answer is untrusted ────────────────────────────────────────────
t_poll_injection() {
  new_world
  local i=0 fx
  local -a fixtures=(
    '{"request":{"id":"op_0123456789abcdef","action":"update; touch PWN","params":{},"secret":null}}'
    '{"request":{"id":"op_../../x","action":"update","params":{},"secret":null}}'
    '{"request":{"id":"op_0123456789abcdef","action":"update","params":{},"secret":null,"cmd":"touch PWN"}}'
    '{"request":{"id":"op_0123456789abcdef","action":"update","params":{"a":"$(touch PWN)"},"secret":null}}'
    '{"request":{"id":"op_0123456789abcdef","action":"update","params":{},"secret":"abc"}}'
    '{"request":{"id":"OP_0123456789ABCDEF","action":"update","params":{},"secret":null}}'
    '{"request":{"id":"op_0123456789abcde","action":"update","params":{},"secret":null}}'
    '{"request":{"id":"op_0123456789abcdef","action":"UPDATE","params":{},"secret":null}}'
    '{"request":{"id":"op_0123456789abcdef","action":"update","params":{},"secret":null}}{"request":null}'
    'hello; touch PWN'
    '{"request":{"id":"op_0123456789abcdef","action":"ba\nckup","params":{},"secret":null}}'
  )
  for fx in "${fixtures[@]}"; do
    i=$((i + 1)); : >"$S/calls.log"; rm -f "$W/pwn" "$CL/pwn" "$CL/PWN"
    printf '%b\n' "${fx//PWN/$W/pwn}" >"$S/poll"
    tick
    check "poll fixture $i: nothing run, nothing written" bash -c "[[ ! -e '$W/pwn' && ! -e '$CL/PWN' && \$(grep -cE '^docker (compose (build|up|restart|stop)|pull)|^cosign|backup.sh ran' '$S/calls.log') = 0 && -z \$(ls '$CL/ops/journal' 2>/dev/null) && \$(ls '$S/reports' | wc -l) = 0 ]]"
  done
  : >"$S/calls.log"; head -c 9000 /dev/zero | tr '\0' 'a' | sed 's/^/{"request":{"id":"op_0123456789abcdef","action":"update","params":{},"secret":null,"x":"/; s/$/"}}/' >"$S/poll"
  tick
  check "poll fixture big: 9 KB answer dropped" bash -c "[[ \$(grep -cE '^docker (compose (build|up)|pull)' '$S/calls.log') = 0 && -z \$(ls '$CL/ops/journal') ]]"
  check "poll: the drop is logged" grep -q 'bad poll' "$CL/ops/helper.log"
  poll backup; tick
  check "poll: control, a well-formed request in the same world still runs" test "$(n_calls 'backup.sh ran')" = 1
}
t_poll_unknown_action() {
  # a well-formed request for an action this helper does not know: the app marked the row running, so the helper
  # answers failed at once instead of leaving it for 30 minutes. Nothing is run for it.
  new_world
  local a n=0
  for a in port reindex; do
    n=$((n + 1)); : >"$S/calls.log"
    poll "$a" "op_00000000000000a$n"; tick
    check "unknown action $a: reported failed at once" grep -q '"status":"failed"' <<<"$(report)"
    check "unknown action $a: the summary says so (Finnish), exit code 1" bash -c "grep -q '\"summary\":\"Tuntematon toiminto\\.\"' '$S/reports/$n.json' && grep -q '\"exit_code\":1' '$S/reports/$n.json'"
    check "unknown action $a: nothing was run" test "$(n_calls '^docker (compose (build|up|restart|stop|logs)|pull|image (tag|prune|rm)|builder)|^cosign|backup.sh ran')" = 0
    check "unknown action $a: journal says reported, so a repeat is not run" grep -q '"reported":true' "$CL/ops/journal/op_00000000000000a$n.json"
  done
  check "unknown action: the log names it" grep -q 'unknown action "reindex", reported failed' "$CL/ops/helper.log"
  # the shape is still checked first: an unknown action with anything extra is dropped as before
  rm -f "$S/reports"/*
  printf '%s\n' '{"request":{"id":"op_00000000000000b1","action":"reindex","params":{},"secret":null,"x":1}}' >"$S/poll"; tick
  check "unknown action: a malformed shape is still dropped, not answered" test "$(nreports)" = 0
  poll backup op_00000000000000c1; tick
  check "unknown action: a known action in the same world still runs" test "$(n_calls 'backup.sh ran')" = 1
}
t_journal_replay() {
  new_world; poll backup; tick
  check "journal: first backup ran" test "$(n_calls 'backup.sh ran')" = 1
  poll backup; tick
  check "journal: the same id from the database again is not run" test "$(n_calls 'backup.sh ran')" = 1
  rm -rf "$S/reports"/*; poll backup "$ID2"; tick
  check "journal: a new id runs" test "$(n_calls 'backup.sh ran')" = 2
}

# ── refusals before anything runs ───────────────────────────────────────────
t_permissions() {
  new_world; poll backup
  chmod 777 "$CL/scripts"; tick
  check "perms: world-writable scripts/ refused" bash -c "[[ $TICK_RC != 0 && \$(grep -c . '$S/calls.log') = 0 ]]"
  chmod 755 "$CL/scripts"; chmod 770 "$CL/ops"; tick
  check "perms: group-writable ops/ refused" test "$TICK_RC" != 0
  chmod 700 "$CL/ops"; chmod 666 "$CL/.env"; tick
  check "perms: writable .env refused" test "$TICK_RC" != 0
  chmod 600 "$CL/.env"; chmod 664 "$CL/scripts/ops-helper.sh"; tick
  check "perms: group-writable helper script refused" test "$TICK_RC" != 0
  chmod 755 "$CL/scripts/ops-helper.sh"; tick
  check "perms: fixed again, it runs" test "$(n_calls 'backup.sh ran')" = 1
}
t_env_poison() {
  new_world; local l
  for l in 'COMPOSE_FILE=/tmp/evil.yml' 'DOCKER_HOST=tcp://evil:2375' 'LD_PRELOAD=/tmp/x.so' 'FOO=$(touch PWN)' 'COMPOSE_PROFILES=evil' 'PATH=/tmp/evil' 'INSTANCE_NAME=a b' 'GIT_SSH_COMMAND=touch PWN' 'BASH_ENV=/tmp/x'; do
    rm -f "$S/reports"/* "$CL/ops/journal"/*; : >"$S/calls.log"; rm -f "$W/pwn" "$CL/PWN"
    setenv "${l//PWN/$W/pwn}"; poll backup; tick
    check ".env '${l:0:28}' refused, nothing run" bash -c "[[ $TICK_RC != 0 && ! -e '$W/pwn' && \$(grep -c . '$S/calls.log') = 0 ]]"
  done
  setenv 'COMPOSE_PROFILES=caddy' 'HOST_PORT=8081' '# a comment' ''; : >"$S/calls.log"; poll backup; tick
  check ".env with plain keys and a comment is accepted" test "$(n_calls 'backup.sh ran')" = 1
}
t_lock_and_disk() {
  new_world; poll backup
  exec 7>"$CL/ops/.lock"; flock -n 7
  tick
  check "lock: a tick during a run does nothing and exits 0" bash -c "[[ $TICK_RC = 0 && \$(grep -c . '$S/calls.log') = 0 ]]"
  exec 7>&-
  touch "$S/lowdisk"; : >"$S/calls.log"; tick
  check "disk: 10 MB free refuses a backup" bash -c "grep -q 'Levytila' '$S/reports/1.json' && [[ \$(grep -c 'backup.sh ran' '$S/calls.log') = 0 ]]"
}
t_timeout() {
  new_world; touch "$S/hang-restart"; poll restart
  local t0=$SECONDS; tick env OPS_T_RESTART=2
  check "timeout: a hanging action is killed and reported failed" bash -c "[[ \$(( $SECONDS - $t0 )) -lt 40 ]] && grep -q '\"status\":\"failed\"' '$S/reports/1.json'"
}
t_app_down() {
  new_world; rm -f "$S/running"; poll backup; tick
  check "app down: no poll, no action, helper-seen written" bash -c "[[ \$(grep -c 'ops poll' '$S/calls.log') = 0 && -s '$CL/ops/helper-seen' && $TICK_RC = 0 ]]"
}

# ── the other actions, output handling ──────────────────────────────────────
t_actions() {
  new_world; poll backup; tick
  check "backup: ran backup.sh and made the copy in the data volume" bash -c "[[ \$(grep -c 'backup.sh ran' '$S/calls.log') = 1 && \$(grep -c 'SNAPSHOT /data/backups/manual-' '$S/calls.log') = 1 ]]"
  check "backup: reported ok" reported ok
  poll doctor "$ID2"; tick
  check "doctor: ran and reported the findings" bash -c "grep -q '\"status\":\"ok\"' '$S/reports/2.json' && grep -q '\"doctor\":{\"at\"' '$S/reports/2.json'"
  poll restart op_3333333333333333; tick
  check "restart: restarted and waited for health" bash -c "grep -q '^docker compose restart banking' '$S/calls.log' && grep -q '\"status\":\"ok\"' '$S/reports/3.json'"
}
t_logs() {
  new_world; poll logs; tick
  check "logs: reported ok" reported ok
  check "logs: banking only when caddy and tunnel do not run" bash -c "grep -q '== banking ==' '$S/reports/1.json' && ! grep -qE '== (caddy|tunnel) ==' '$S/reports/1.json'"
  check "logs: asked for exactly 100 lines of banking, no other service" bash -c "[[ \$(grep -c '^docker compose logs --no-color --tail 100 banking' '$S/calls.log') = 1 && \$(grep -c '^docker compose logs' '$S/calls.log') = 1 ]]"
  check "logs: bearer token, JWT, TOKEN and key lines are gone" bash -c "! grep -qE 'abc123tokenvalue|eyJ|TUNNEL_TOKEN|api_key|c2ln' '$S/reports/1.json'"
  check "logs: ordinary lines are kept" grep -q 'kept log line' "$S/reports/1.json"
  check "logs: summary names the service (Finnish)" grep -q '"summary":"Luettu: banking\."' "$S/reports/1.json"
  touch "$S/svc-caddy" "$S/svc-tunnel"; poll logs "$ID2"; tick
  check "logs: caddy and tunnel are added when they run" bash -c "grep -q '== banking ==' '$S/reports/2.json' && grep -q '== caddy ==' '$S/reports/2.json' && grep -q '== tunnel ==' '$S/reports/2.json'"
  check "logs: 3 services of 100 lines are not cut to 200 lines" bash -c "grep -q 'line 51 of banking' '$S/reports/2.json'"
  check "logs: read-only, nothing else was run" test "$(n_calls '^docker (compose (restart|up|build)|image prune|builder)')" = 0
}
t_prune() {
  new_world; printf '1.2GB' >"$S/prune-images"; printf '300MB' >"$S/prune-cache"
  cp "$S/images/banking-app_latest" "$S/images/banking-app_previous"
  poll prune; tick
  check "prune: reported ok with the freed space in Finnish" grep -q '"summary":"Levyltä vapautui 1,2 Gt vanhoista versioista ja 300 Mt välimuistista\."' "$S/reports/1.json"
  check "prune: the two fixed commands ran once each" bash -c "[[ \$(grep -c '^docker image prune -f' '$S/calls.log') = 1 && \$(grep -c '^docker builder prune -f' '$S/calls.log') = 1 ]]"
  check "prune: nothing broader (no -a, --all, system prune, volumes)" bash -c "! grep -E '^docker .*(prune.*(-a|--all|--volumes)|system prune|volume prune|image rm|rmi)' '$S/calls.log'"
  check "prune: :latest and :previous are still there" test -f "$S/images/banking-app_latest" -a -f "$S/images/banking-app_previous"
  : >"$S/calls.log"; rm -f "$S/prune-images" "$S/prune-cache"; poll prune "$ID2"; tick
  check "prune: nothing to free is said so" grep -q '"summary":"Ei vapautettavaa\."' "$S/reports/2.json"
  touch "$S/prune-eats-previous"; poll prune op_3333333333333333; tick
  check "prune: a prune that removed :previous is reported failed" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/3.json' && grep -q 'poisti version' '$S/reports/3.json'"
  rm -f "$S/prune-eats-previous"; touch "$S/prunefail"; poll prune op_4444444444444444; tick
  check "prune: a failing command is reported failed" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/4.json'"
}
t_helper_renew() {
  new_world; local policy; policy=$(cat "$CL/ops/policy")
  poll helper-renew; tick
  check "renew: reported ok" bash -c "grep -q '\"status\":\"ok\"' '$S/reports/1.json' && grep -q 'Apuri asennettu uudelleen' '$S/reports/1.json'"
  check "renew: one cron line for this instance, in this clone, with the marker" bash -c "[[ \$(grep -c '# talous-ops:banking-app\$' '$S/crontab') = 1 ]] && grep -q ' $W/home/.local/share/omatalous/banking-app/launcher.sh $CL >/dev/null' '$S/crontab'"
  check "renew: the policy (remote, branch) is kept, not rewritten from the clone" test "$(cat "$CL/ops/policy")" = "$policy"
  poll helper-renew "$ID2"; tick
  check "renew: a second renewal does not duplicate the line" test "$(grep -c '# talous-ops:banking-app$' "$S/crontab")" = 1
  : >"$S/calls.log"; touch "$S/systemd"; poll helper-renew op_3333333333333333; tick
  check "renew: with systemd the unit files are written and the timer enabled" bash -c "[[ -f '$W/home/.config/systemd/user/talous-ops-banking-app.timer' ]] && grep -q 'systemctl --user enable --now talous-ops-banking-app.timer' '$S/calls.log'"
  check "renew: the running service is not stopped (it is this very run)" bash -c "! grep -q 'systemctl --user stop' '$S/calls.log'"
  check "renew: no cron line left once systemd took over" bash -c "! grep -q 'talous-ops:' '$S/crontab' 2>/dev/null"
  rm -f "$S/systemd"; printf '0 3 * * * echo mine\n' >"$S/crontab"
  (cd "$CL" && env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/bin:/bin" ./scripts/install.sh --ops-helper >/dev/null 2>&1)
  check "renew: other cron lines of the user are untouched" bash -c "grep -q 'echo mine' '$S/crontab' && grep -q 'talous-ops:banking-app' '$S/crontab'"
}
t_update_renews_helper() {
  new_world; release 0.2.0
  printf '* * * * * cd %s && ./scripts/ops-helper.sh >/dev/null 2>&1 # talous-ops:banking-app\n' "$CL" >"$S/crontab"
  poll update; tick
  check "update: reported ok" reported ok
  check "update: the helper was renewed after the update" grep -q 'Maintenance helper renewed' "$S/reports/1.json"
  check "update: still one cron line" test "$(grep -c 'talous-ops:banking-app' "$S/crontab")" = 1
  new_world; release 0.2.0
  poll update; tick
  check "update: an install without the helper schedule is not given one" bash -c "[[ ! -e '$S/crontab' ]] && ! grep -q 'Maintenance helper renewed' '$S/reports/1.json'"
}
t_scrub() {
  new_world; poll backup; tick
  local r; r=$(cat "$S/reports/1.json")
  check "scrub: ANSI codes gone" bash -c "! grep -q $'\\033' '$S/reports/1.json'"
  check "scrub: long token-like run hidden" bash -c "! grep -q 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuv' '$S/reports/1.json' "
  check "scrub: Authorization and TOKEN lines dropped" bash -c "! grep -qiE 'Authorization|TUNNEL_TOKEN' '$S/reports/1.json'"
  check "scrub: ordinary lines kept" grep -q 'kept line' <<<"$r"
}
t_heartbeat() {
  new_world; release 0.2.0; tick
  check "heartbeat: first tick after boot sends a state snapshot" grep -q '"checked_at"' "$S/state.last"
  check "heartbeat: snapshot has mode, version and the address after remote access goes off" grep -qE '"version".*"mode":"local".*"lanAddress":"http://localhost:8080"' "$S/state.last"
  check "heartbeat: no secrets or paths in the snapshot" bash -c "! grep -qE 'PASSWORD|/home|secret' '$S/state.last'"
}
# ── the call sites of the libs under scripts/lib. A probe replaces a lib function and logs its calls, so these scenarios
# keep showing where the helper calls it whatever the lib does later.
lib_add() { # lib_add LIB CODE: CODE goes to the end of scripts/lib/ops-LIB.sh in the seed and is pulled into the clone (the tree stays clean)
  printf '%s\n' "$2" >>"$W/seed/scripts/lib/ops-$1.sh"
  git -C "$W/seed" commit -qam "lib $1" && git -C "$W/seed" push -q origin main 2>/dev/null && git -C "$CL" pull -q --ff-only 2>/dev/null
}
probe() { lib_add "$1" "$2() { echo \"$2 \$*\" >>\"\$OPS_STUB_DIR/calls.log\"; return ${3:-0}; }"; } # probe LIB FUNC [RC]: FUNC logs its call and returns RC
run_helper() { # the helper once with ARGS in the clone: its output in OUT, its status in RC
  OUT=$(cd "$CL" && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/ops-helper.sh "$@" 2>&1); RC=$?
}
report_watchdog() { # report_watchdog AT FROM TO REASON: watchdog_report in the clone, loaded the way the helper loads it
  (cd "$CL" && env OPS_STUB_DIR="$S" PATH="$S/bin:/usr/bin:/bin" OPS=ops bash -c '. scripts/lib/dbcopy.sh; . scripts/lib/ops-watchdog.sh; watchdog_report "$@"' x "$@")
}
t_callsite_selftest() {
  new_world; run_helper --self-test
  check "self-test: the helper's only argument runs self_test, which answers" test "$OUT" = "self-test ok" -a "$RC" = 0
  run_helper --self-test now
  check "self-test: with another argument it is a usage error" test "$RC" = 2 -a "$OUT" = "Usage: ops-helper.sh"
  probe selftest self_test 3; : >"$S/calls.log"; run_helper --self-test
  check "self-test: self_test is called once, with no arguments, and its status is the helper's" test "$(calls)" = "self_test " -a "$RC" = 3
  check "self-test: no tick ran (no lock, no journal, no docker)" bash -c "[[ ! -e '$CL/ops/.lock' && ! -e '$CL/ops/journal' ]] && [[ \$(grep -c '^docker' '$S/calls.log') = 0 ]]"
  chmod 775 "$CL/scripts/lib"; : >"$S/calls.log"; run_helper --self-test
  check "self-test: files others can write are refused before any lib is read" test "$RC" = 1 -a "${OUT##*$'\n'}" = "self-test failed: the helper's files are not safe or do not load" -a -z "$(calls)"
}
t_callsite_after_update_check() {
  new_world; probe selftest after_update_check; release 0.2.0; poll update; tick
  check "after_update_check: called once, with no arguments, when the update went through" test "$(n_calls '^after_update_check $')" = 1 -a "$(cver)" = 0.2.0
  check "after_update_check: after the new version was started and had answered" test "$(line_of '^after_update_check')" -gt "$(line_of '^docker compose up')" -a "$(line_of '^after_update_check')" -gt "$(grep -n 'api/health' "$S/calls.log" | tail -1 | cut -d: -f1)"
  new_world; probe selftest after_update_check; release 0.2.0; touch "$S/bad_0.2.0"; poll update; tick
  check "after_update_check: not called when the new version does not answer" test "$(n_calls '^after_update_check')" = 0
}
t_callsite_watchdog_tick() {
  new_world; probe watchdog watchdog_tick; tick
  check "watchdog_tick: called once a tick, with no arguments" test "$(n_calls '^watchdog_tick $')" = 1
  rm -f "$S/running"; : >"$S/calls.log"; tick
  check "watchdog_tick: also when the app is down, where the tick ends" test "$(n_calls '^watchdog_tick $')" = 1 -a "$(n_calls 'ops poll')" = 0
}
t_callsite_address_tick() {
  new_world; probe watchdog watchdog_tick; probe address address_tick; poll backup; tick
  check "address_tick: called once a tick, with no arguments, after watchdog_tick and before the poll" test "$(n_calls '^address_tick $')" = 1 -a "$(line_of '^watchdog_tick')" -lt "$(line_of '^address_tick')" -a "$(line_of '^address_tick')" -lt "$(line_of 'ops poll')"
  rm -f "$S/running"; : >"$S/calls.log"; tick
  check "address_tick: also when the app is down, where the tick ends" test "$(n_calls '^address_tick $')" = 1 -a "$(n_calls 'ops poll')" = 0
}
t_callsite_housekeeping() {
  new_world; probe housekeeping housekeeping; tick
  check "housekeeping: called once in the daily block of the first heartbeat, with no arguments" test "$(n_calls '^housekeeping $')" = 1
  check "housekeeping: after the version check, before the snapshot goes out" test "$(line_of '^curl ')" -lt "$(line_of '^housekeeping')" -a "$(line_of '^housekeeping')" -lt "$(line_of 'ops state')"
  tick
  check "housekeeping: not again within the day" test "$(n_calls '^housekeeping')" = 1
  touch -d '2 days ago' "$CL/ops/last-check"; poll backup; tick
  check "housekeeping: not in a tick that ran a request" test "$(n_calls '^housekeeping')" = 1
  tick
  check "housekeeping: again once the daily check is due" test "$(n_calls '^housekeeping')" = 2
}
t_libs_see_the_test_hooks() {
  new_world; lib_add watchdog 'watchdog_tick() { echo "hooks ${OPS_T_SELFTEST:-} ${OPS_T_ADDRESS:-}" >>"$OPS_STUB_DIR/calls.log"; }'
  tick env OPS_T_SELFTEST=11 OPS_T_ADDRESS=33
  check "hooks: OPS_T_SELFTEST and OPS_T_ADDRESS reach the libs through the clean environment" test "$(n_calls '^hooks 11 33$')" = 1
}
t_libs_load_or_stop() {
  new_world; lib_add watchdog 'watchdog_tick() { if then; }'; : >"$S/calls.log"
  tick
  check "libs: a lib that does not load stops the tick before Docker is asked anything" test "$TICK_RC" = 1 -a "$(n_calls '^docker')" = 0
  check "libs: and the helper log says so" grep -q 'A part of the helper does not load' "$CL/ops/helper.log"
  run_helper --self-test
  check "libs: the self-test says so too, and does not claim to be ok" test "$RC" = 1 -a "${OUT##*$'\n'}" = "self-test failed: the helper's files are not safe or do not load"
}
t_watchdog_frag() {
  new_world; local frag=$CL/ops/watchdog.frag want_frag='{"at":"2026-01-02T00:00:00Z","from":"0.9.1","to":"0.9.0","reason":"self_test"}' bad=0 args
  tick
  check "watchdog_report: with no report the state has no watchdog" bash -c "! grep -q watchdog '$S/state.last'"
  report_watchdog 20260101T120000Z 0.2.0 0.1.0 unhealthy
  check "watchdog_report: one JSON object, the time of .last-update as an ISO time" test "$(cat "$frag")" = '{"at":"2026-01-01T12:00:00Z","from":"0.2.0","to":"0.1.0","reason":"unhealthy"}'
  check "watchdog_report: nothing is left beside it" test "$(find "$CL/ops" -name 'watchdog*' | wc -l)" = 1
  report_watchdog 2026-01-02T00:00:00Z 0.9.1 0.9.0 self_test
  check "watchdog_report: an ISO time and the reason self_test are taken as they are, the file is replaced" test "$(cat "$frag")" = "$want_frag"
  for args in "yesterday 0.9.1 0.9.0 unhealthy" "2026-01-02T00:00:00Z 0.9 0.9.0 unhealthy" "2026-01-02T00:00:00Z 0.9.1 v0.9.0 unhealthy" "2026-01-02T00:00:00Z 0.9.1 0.9.0 other" "2026-01-02T00:00:00Z 0.9.1 0.9.0" ""; do
    report_watchdog $args && bad=1
  done
  check "watchdog_report: an argument of another form returns 1 and changes nothing" test "$bad" = 0 -a "$(cat "$frag")" = "$want_frag"
  rm -f "$S/state.last" "$CL/ops/boot_id"; tick
  check "watchdog_report: state_json sends the file as \"watchdog\", in a state that is JSON" bash -c "grep -q '\"watchdog\":$want_frag' '$S/state.last' && jq -e . '$S/state.last' >/dev/null"
  release 0.2.0; poll update; tick
  check "watchdog_report: an update that went through removes it, and its result does not carry it" bash -c "[[ ! -e '$frag' ]] && ! grep -q watchdog '$S/reports/1.json'"
  new_world; release 0.2.0; report_watchdog 20260101T120000Z 0.2.0 0.1.0 unhealthy; touch "$S/bad_0.2.0"; poll update; tick
  check "watchdog_report: an update that failed leaves it" test -s "$CL/ops/watchdog.frag"
}
t_no_dangerous_constructs() {
  check "helper: no eval, source, bash -c or sudo" bash -c "! grep -vE '^[[:space:]]*#' '$SRC/scripts/ops-helper.sh' | grep -nE '(^|[;&|(])[[:space:]]*(eval|source)[[:space:]]|bash -c|sudo '"
  check "helper: actions are a case with a refusing default" grep -q '\*) fail "Tuntematon toiminto."' "$SRC/scripts/ops-helper.sh"
  check "installer scheduling: no sudo outside printed hints" bash -c "! grep -vE '^[[:space:]]*(#|OPS_[A-Z]+=)' '$SRC/scripts/lib/ops-schedule.sh' | grep -n 'sudo'"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
