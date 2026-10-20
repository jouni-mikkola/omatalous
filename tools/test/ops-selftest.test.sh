#!/usr/bin/env bash
# Tests for scripts/lib/ops-selftest.sh: the helper's self-test (`ops-helper.sh --self-test`) and what an update does
# when the helper it brought fails that test. Against the stub world of tools/test/ops-world.sh: nothing here touches the
# network, a real container or a real registry.
#
#   tools/test/ops-selftest.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged ops-selftest.test.sh "$@"

HV=$(bash "$SRC/scripts/ops-helper.sh" --version)
# the helper once with ARGS in the clone: what it printed (stdout and stderr) in OUT, its status in RC
run_helper() {
  OUT=$(cd "$CL" && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/ops-helper.sh "$@" 2>&1); RC=$?
}
selftest() { : >"$S/calls.log"; run_helper --self-test; }
answer() { printf '%s' "${OUT##*$'\n'}"; }
line_of() { grep -nE "$1" "$S/calls.log" | head -1 | cut -d: -f1; }
summary() { report | jq -r .summary; }
BROKEN='broken() { if then; }'
# A docker in front of the world's that fails the first N calls whose arguments match the shell pattern PAT, and only
# while the version VER runs when that is given. The world's docker always answers `info`, and what it fails it fails
# every time.
docker_fails() { # docker_fails PAT N [VER]
  mv "$S/bin/docker" "$S/bin/docker.world"; echo "$2" >"$S/fails"
  # the folder is written into the stub: the helper also runs docker with an empty environment
  printf '#!/bin/sh\nS=%s; n=$(cat "$S/fails"); v=%s\ncase "$*" in %s) if [ "$n" -gt 0 ] && { [ -z "$v" ] || [ "$v" = "$(cat "$S/cver")" ]; }; then echo "docker $*" >>"$S/calls.log"; echo $((n - 1)) >"$S/fails"; exit 1; fi ;; esac\nexec "$S/bin/docker.world" "$@"\n' "'$S'" "'${3:-}'" "$1" >"$S/bin/docker"
  chmod +x "$S/bin/docker"
}
docker_down() { docker_fails info 1000; }
# The world's sleep returns at once. This one also tells how long it was asked to wait.
told_sleep() { printf '#!/bin/sh\necho "sleep $*" >>"$OPS_STUB_DIR/calls.log"\n'>"$S/bin/sleep"; chmod +x "$S/bin/sleep"; }
# Every file, folder, size, mode and time of the world, but the helper's log and the stubs' own record of calls.
manifest() { (cd "$W" && find . \( -name helper.log -o -name calls.log -o -name tick.out \) -prune -o -printf '%p %y %s %m %T@\n' | sort); }
# The release about to be cut gets a helper whose self-test fails with REASON. CODE runs first, in the clone, as the
# new helper: the scenarios use it to change what the helper from before the update finds afterwards.
new_helper_fails() { # new_helper_fails REASON [CODE]
  printf 'self_test() { %s\n  echo "self-test failed: %s"; return 1; }\n' "${2:-:}" "$1" >>"$W/seed/scripts/lib/ops-selftest.sh"
}
ROLLBACK_TAG='^docker image tag banking-app:previous banking-app:latest'

# ── the self-test ───────────────────────────────────────────────────────────
t_selftest_ok() {
  new_world; selftest
  check "ok: a healthy install answers one line, self-test ok, and exit 0" test "$OUT" = "self-test ok" -a "$RC" = 0
  check "ok: Docker is asked first, then the app's health, then its version" test "$(line_of '^docker info')" -lt "$(line_of 'api/health')" -a "$(line_of 'api/health')" -lt "$(line_of 'dist/node.js version')"
  check "ok: an app older than 0.9.0 is not polled" test "$(n_calls 'ops poll')" = 0
  check "ok: the helper's log has the answer" grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z self-test ok$' "$CL/ops/helper.log"
  # 0.8.7 does not know --dry: it would hand the queued request to the self-test
  echo 0.8.7 >"$S/cver"; poll backup; selftest
  check "ok: on 0.8.7 a queued request stays queued" test "$OUT" = "self-test ok" -a -f "$S/poll" -a "$(n_calls 'ops poll')" = 0
  rm -f "$S/poll"; echo 0.9.0 >"$S/cver"; selftest
  check "ok: 0.9.0 is asked the dry poll once, with the helper's version" test "$OUT" = "self-test ok" -a "$(n_calls "dist/node.js ops poll --dry --helper $HV \$")" = 1
  check "ok: and only after it answered and told its version" test "$(line_of 'api/health')" -lt "$(line_of 'dist/node.js version')" -a "$(line_of 'dist/node.js version')" -lt "$(line_of 'ops poll --dry')"
  echo 0.10.2 >"$S/cver"; selftest
  check "ok: 0.10.2 is newer than 0.9.0 and is asked too" test "$OUT" = "self-test ok" -a "$(n_calls 'ops poll --dry')" = 1
  under_lock() { (flock -n 8 || exit 1; selftest; [[ $OUT == "self-test ok" ]]) 8>"$CL/ops/.lock"; }
  check "ok: it answers while a tick holds the lock, as the one that runs an update does" under_lock
  rm -rf "$CL/ops"; selftest
  check "ok: an install where the helper never ran passes, and gets no ops folder from the test" test "$OUT" = "self-test ok" -a ! -e "$CL/ops"
}
t_selftest_bad_env() {
  new_world; setenv 'DOCKER_HOST=tcp://example.com:2375'; selftest
  check "bad env: a key that would point Docker elsewhere fails the test, with the reason" test "$OUT" = "self-test failed: .env is invalid: key DOCKER_HOST is not allowed" -a "$RC" = 1
  check "bad env: Docker and the app were not asked anything" test "$(n_calls '^docker')" = 0
  check "bad env: the log has the same line" grep -qE 'Z self-test failed: \.env is invalid: key DOCKER_HOST is not allowed$' "$CL/ops/helper.log"
  # shellcheck disable=SC2016 # the text is the point: a value with shell syntax, never run
  setenv 'APP_BASE_URL=http://$(id).example'; selftest
  check "bad env: a value with shell syntax fails it, and the value is not printed" bash -c "[[ \$1 == 'self-test failed: .env is invalid: the value of APP_BASE_URL has a '* && \$1 != *example* ]]" x "$OUT"
  setenv 'INSTANCE_NAME=Not A Name'; selftest
  check "bad env: an invalid INSTANCE_NAME fails it" test "$OUT" = "self-test failed: .env is invalid: INSTANCE_NAME is invalid" -a "$RC" = 1
  setenv 'HOST_PORT=8081'; selftest
  check "bad env: a plain .env passes" test "$OUT" = "self-test ok" -a "$RC" = 0
}
t_selftest_syntax_error_in_lib() {
  # ops-access.sh is read only when a request needs it, so a tick would not notice
  new_world; echo "$BROKEN" >>"$CL/scripts/lib/ops-access.sh"; selftest
  check "syntax: a lib the helper reads only when it needs it is parsed too, and named" test "$OUT" = "self-test failed: scripts/lib/ops-access.sh has a syntax error" -a "$RC" = 1
  check "syntax: found before Docker or the app is asked" test "$(n_calls '^docker')" = 0
  new_world; echo "$BROKEN" >>"$CL/scripts/update.sh"; selftest
  check "syntax: a script the helper runs is parsed and named" test "$OUT" = "self-test failed: scripts/update.sh has a syntax error" -a "$RC" = 1
  # bash runs a script as it reads it: a broken line after the place where the self-test starts never stops the run
  new_world; echo "$BROKEN" >>"$CL/scripts/ops-helper.sh"; selftest
  check "syntax: a broken line at the end of the helper itself is found" test "$OUT" = "self-test failed: scripts/ops-helper.sh has a syntax error" -a "$RC" = 1
  new_world; sed -i "/^set +x\$/a $BROKEN" "$CL/scripts/ops-helper.sh"; selftest
  check "syntax: a broken line early in the helper ends it with an error and no answer" test "$RC" != 0 -a "$(answer)" != "self-test ok"
  new_world; echo "$BROKEN" >>"$CL/scripts/lib/ops-address.sh"; selftest
  check "syntax: a lib the helper loads at its start fails the test before self_test runs" test "$(answer)" = "self-test failed: the helper's files are not safe or do not load" -a "$RC" = 1
}
t_selftest_dry_poll_wrong() {
  # the stub hands out what is queued whatever the flags, like an app that does not know --dry
  new_world; echo 0.9.0 >"$S/cver"; poll backup; selftest
  check "dry poll: a request for an answer fails the test" test "$OUT" = "self-test failed: the app does not answer the dry poll" -a "$RC" = 1
  : >"$S/poll"; selftest
  check "dry poll: no answer fails it" test "$OUT" = "self-test failed: the app does not answer the dry poll" -a "$RC" = 1
  printf '{"request":null}\n{"ok":true}\n' >"$S/poll"; selftest
  check "dry poll: a second line after the answer fails it" test "$OUT" = "self-test failed: the app does not answer the dry poll" -a "$RC" = 1
  printf '{"request": null}\n' >"$S/poll"; selftest
  check "dry poll: the same JSON spelled another way fails it" test "$OUT" = "self-test failed: the app does not answer the dry poll" -a "$RC" = 1
  printf '{"request":null}\n' >"$S/poll"; selftest
  check "dry poll: exactly {\"request\":null} passes" test "$OUT" = "self-test ok" -a "$RC" = 0
}
t_selftest_docker_or_app_down() {
  new_world; docker_down; selftest
  check "down: Docker that does not respond fails the test, and the app is not asked" test "$OUT" = "self-test failed: Docker does not respond" -a "$RC" = 1 -a "$(n_calls 'compose exec')" = 0
  new_world; rm -f "$S/running"; selftest
  check "down: a stopped app fails it" test "$OUT" = "self-test failed: the app does not respond" -a "$RC" = 1
  check "down: and nothing is run in an app that did not answer (its first command would open the database)" test "$(n_calls 'dist/node.js')" = 0
  new_world; touch "$S/bad_0.1.0"; selftest
  check "down: an app that runs and fails its health check fails it" test "$OUT" = "self-test failed: the app does not respond" -a "$(n_calls 'dist/node.js')" = 0
  new_world; echo unknown >"$S/cver"; selftest
  check "down: an app that does not tell its version fails it, and is not polled" test "$OUT" = "self-test failed: the app does not tell its version" -a "$RC" = 1 -a "$(n_calls 'ops poll')" = 0
}
t_selftest_second_try() {
  new_world; docker_fails info 1; told_sleep; selftest
  check "second try: Docker that fails once and then answers passes" test "$OUT" = "self-test ok" -a "$RC" = 0 -a "$(n_calls '^docker info')" = 2
  check "second try: after one wait of ten seconds" test "$(n_calls '^sleep')" = 1 -a "$(n_calls '^sleep 10$')" = 1
  new_world; docker_fails info 2; told_sleep; selftest
  check "second try: Docker that fails twice fails the test, with no third try" test "$OUT" = "self-test failed: Docker does not respond" -a "$RC" = 1 -a "$(n_calls '^docker info')" = 2 -a "$(n_calls '^sleep')" = 1
  new_world; docker_fails '*api/health*' 1; told_sleep; selftest
  check "second try: an app that fails its health check once passes" test "$OUT" = "self-test ok" -a "$(n_calls 'api/health')" = 2 -a "$(n_calls '^sleep 10$')" = 1
  new_world; docker_fails '*dist/node.js\ version*' 1; told_sleep; selftest
  check "second try: an app that tells its version on the second try passes" test "$OUT" = "self-test ok" -a "$(n_calls '^sleep 10$')" = 1
  new_world; told_sleep; selftest
  check "second try: a healthy install is looked at once, with no wait" test "$OUT" = "self-test ok" -a "$(n_calls '^docker info')" = 1 -a "$(n_calls '^sleep')" = 0
  # a second look does not mend a file
  new_world; echo "$BROKEN" >>"$CL/scripts/doctor.sh"; told_sleep; selftest
  check "second try: a broken file gets none" test "$OUT" = "self-test failed: scripts/doctor.sh has a syntax error" -a "$(n_calls '^sleep')" = 0
}
t_selftest_writes_nothing() {
  local before lines
  new_world; echo 0.9.0 >"$S/cver"; tick; selftest
  before=$(manifest); lines=$(wc -l <"$CL/ops/helper.log"); selftest
  check "writes nothing: a run that passes leaves every file, folder and time of the install and of Docker as it was" test "$OUT" = "self-test ok" -a "$(manifest)" = "$before"
  check "writes nothing: but one line in ops/helper.log" test "$(wc -l <"$CL/ops/helper.log")" = $((lines + 1)) -a "$(tail -1 "$CL/ops/helper.log" | cut -d' ' -f2-)" = "self-test ok"
  check "writes nothing: it asks Docker four things and each only reads" test "$(n_calls '^docker')" = 4 \
    -a "$(grep -cvE "^docker (info|compose exec -T banking (wget -qO- http://127.0.0.1:8080/api/health|node [^ ]+ dist/node.js (version|ops poll --dry --helper $HV))) \$" "$S/calls.log")" = 0
  rm -f "$S/running"; before=$(manifest); lines=$(wc -l <"$CL/ops/helper.log"); selftest
  check "writes nothing: nor does a run that fails" test "$RC" = 1 -a "$(manifest)" = "$before"
  check "writes nothing: but its one line in ops/helper.log" test "$(wc -l <"$CL/ops/helper.log")" = $((lines + 1)) -a "$(tail -1 "$CL/ops/helper.log" | cut -d' ' -f2-)" = "self-test failed: the app does not respond"
}
t_selftest_reasons_in_finnish() {
  local why bad=""
  new_world
  in_fi() { (cd "$CL" && bash -c 't_for() { echo "$1"; }; . scripts/lib/ops-selftest.sh; selftest_why_fi "$1"' x "$1"); }
  # every reason the self-test and its caller in the helper can give has a sentence of its own for the page
  for why in "scripts/lib/ops-access.sh has a syntax error" "the helper's files are not safe or do not load" "File permissions: scripts is not safe (owner or write access)." \
    ".env is invalid: key DOCKER_HOST is not allowed" "timeout or flock is missing (coreutils, util-linux)" "Docker does not respond" "the app does not respond" \
    "the app does not tell its version" "the app does not answer the dry poll" "no answer in 120 s"; do
    [[ $(in_fi "$why") != "itsetesti epäonnistui" && -n $(in_fi "$why") ]] || bad+="$why; "
  done
  check "reasons: each reason of the self-test has its own Finnish sentence" test -z "$bad"
  check "reasons: one this helper does not know gets the plain sentence" test "$(in_fi "the moon is in the wrong phase")" = "itsetesti epäonnistui"
  check "reasons: all of them are distinct" test "$(for why in "x has a syntax error" "they do not load" "x is not safe" ".env is invalid: x" "x is missing" "Docker does not respond" "the app does not respond" "the app does not tell its version" "the app does not answer the dry poll" "no answer in 5 s" other; do in_fi "$why"; done | sort -u | wc -l)" = 11
}

# ── an update, and the self-test of the helper it brought ───────────────────
t_update_selftest_passes() {
  new_world; release 0.9.1; poll update; tick
  check "update: with a helper that passes, the update is reported ok as before" test "$(summary)" = "Päivitetty: 0.1.0 → 0.9.1." -a "$(cver)" = 0.9.1
  check "update: the new helper was asked after the new version had started" test "$(line_of 'ops poll --dry')" -gt "$(line_of '^docker compose up')"
  check "update: the request's log has the answer" grep -qx 'self-test ok' <<<"$(report | jq -r .output)"
  check "update: nothing was taken back" test "$(n_calls "$ROLLBACK_TAG")" = 0 -a -f "$CL/backups/.last-update" -a ! -e "$CL/ops/watchdog.frag" -a ! -e "$CL/ops/RECOVERY.txt"
}
t_update_selftest_fails_rolls_back() {
  local at
  # the release brings a lib that does not load. The helper that runs the update was read before it, and is whole.
  new_world; echo "$BROKEN" >>"$W/seed/scripts/lib/ops-address.sh"; release 0.2.0; tick; poll update; tick
  check "rolls back: the update is reported failed, with the reason in Finnish" test "$(summary)" = "Edellinen versio palautettiin, koska uusi ylläpitoapuri ei toiminut (apurin tiedostot eivät kelpaa)." -a "$(report | jq -r .status)" = failed
  check "rolls back: the new version ran first, then the previous image was put back" test "$(n_calls "$ROLLBACK_TAG")" = 1 -a "$(line_of "$ROLLBACK_TAG")" -gt "$(line_of '^docker compose up')"
  check "rolls back: the previous version runs, from the previous version's files" test "$(cver)" = 0.1.0 -a "$(head_commit)" = "$C1"
  check "rolls back: the record of the update is used up, and there is no RECOVERY.txt" test ! -e "$CL/backups/.last-update" -a ! -e "$CL/ops/RECOVERY.txt"
  check "rolls back: the result tells the app, as a watchdog report with the reason self_test" bash -c "jq -e '.state.watchdog | (.at | test(\"^20[0-9-]{8}T[0-9:]{8}Z\$\")) and .from == \"0.2.0\" and .to == \"0.1.0\" and .reason == \"self_test\" and (keys | length) == 4' <<<\"\$1\" >/dev/null" x "$(report)"
  check "rolls back: the saved answer of the version check is dropped" bash -c "[[ ! -e '$CL/ops/check.frag' && ! -e '$CL/ops/last-check' ]] && ! grep -q update_available <<<\"\$1\"" x "$(report)"
  check "rolls back: the request's log has the new helper's answer and what was done" bash -c "grep -q \"self-test failed: the helper's files are not safe or do not load\" <<<\"\$1\" && grep -q 'Restoring the previous version' <<<\"\$1\"" x "$(report | jq -r .output)"
  check "rolls back: the helper's log says both" bash -c "grep -q \"update: the new helper failed its self-test (the helper's files are not safe or do not load)\" '$CL/ops/helper.log' && grep -q 'update: the previous version was restored' '$CL/ops/helper.log'"
  selftest
  check "rolls back: the helper on the disk passes its own test again" test "$OUT" = "self-test ok"
  rm -f "$S/state.last" "$CL/ops/boot_id"; tick
  check "rolls back: the next tick runs, offers the update again and keeps sending the report" bash -c "[[ $TICK_RC == 0 ]] && grep -q '\"update_available\":true' '$S/state.last' && grep -q '\"watchdog\":{\"at\":\"[0-9TZ:-]*\",\"from\":\"0.2.0\",\"to\":\"0.1.0\",\"reason\":\"self_test\"}' '$S/state.last'"
  # the report's time is the time of the update's own record, which the rollback removes
  new_world; new_helper_fails "Docker does not respond" 'cp backups/.last-update "$OPS_STUB_DIR/seen"; [[ ! -e /proc/$$/fd/8 ]] || touch "$OPS_STUB_DIR/has-lock"'; release 0.2.0; poll update; tick
  check "rolls back: the new helper ran its test without the lock of the tick" test -f "$S/seen" -a ! -e "$S/has-lock"
  at=$(sed -n -E 's/^AT=(....)(..)(..)T(..)(..)(..)Z$/\1-\2-\3T\4:\5:\6Z/p' "$S/seen")
  check "rolls back: the report carries the time of the update's record" test -n "$at" -a "$(cat "$CL/ops/watchdog.frag")" = "{\"at\":\"$at\",\"from\":\"0.2.0\",\"to\":\"0.1.0\",\"reason\":\"self_test\"}"
  check "rolls back: a reason of the new helper's self-test is told in Finnish" test "$(summary)" = "Edellinen versio palautettiin, koska uusi ylläpitoapuri ei toiminut (Docker ei vastaa)." -a "$(cver)" = 0.1.0
}
t_update_selftest_slow_start() {
  # Docker is slow right after the switch to the new version, when the new helper is tested
  new_world; release 0.2.0; docker_fails info 1 0.2.0; poll update; tick
  check "slow start: Docker that fails once and then answers does not take the update back" test "$(summary)" = "Päivitetty: 0.1.0 → 0.2.0." -a "$(cver)" = 0.2.0 -a "$(n_calls "$ROLLBACK_TAG")" = 0
  check "slow start: the new helper asked Docker a second time" test "$(cat "$S/fails")" = 0 -a "$(n_calls '^docker info$')" = 1
  new_world; release 0.2.0; docker_fails info 2 0.2.0; poll update; tick
  check "slow start: Docker that fails twice does, and the previous version is put back" test "$(summary)" = "Edellinen versio palautettiin, koska uusi ylläpitoapuri ei toiminut (Docker ei vastaa)." -a "$(cver)" = 0.1.0 -a "$(n_calls "$ROLLBACK_TAG")" = 1
  check "slow start: after two looks and no more" test "$(cat "$S/fails")" = 0 -a "$(n_calls '^docker info$')" = 2
}
t_update_selftest_no_answer() {
  new_world; new_helper_fails "never said" '/bin/sleep 1000'; release 0.2.0; poll update; tick OPS_T_SELFTEST=2
  check "no answer: a helper that does not answer in time is a failed one, and the update is taken back" test "$(summary)" = "Edellinen versio palautettiin, koska uusi ylläpitoapuri ei toiminut (itsetesti ei valmistunut ajoissa)." -a "$(cver)" = 0.1.0
  check "no answer: the helper's log has the time limit" grep -q 'update: the new helper failed its self-test (no answer in 2 s)' "$CL/ops/helper.log"
  # a helper that cannot even be run: the file lost its execute bit in the release
  new_world; chmod 644 "$W/seed/scripts/ops-helper.sh"; release 0.2.0; poll update; tick
  check "no answer: a helper that cannot be run is a failed one too" test "$(summary)" = "Edellinen versio palautettiin, koska uusi ylläpitoapuri ei toiminut (itsetesti epäonnistui)." -a "$(cver)" = 0.1.0
  new_world; new_helper_fails "x" 'echo "self-test ok"; exit 1'; release 0.2.0; poll update; tick
  check "no answer: the word ok with a failing status is not a pass" test "$(report | jq -r .status)" = failed -a "$(cver)" = 0.1.0
}
t_update_selftest_old_copy_no_rollback() {
  local old fresh
  old=$(date -u -d '61 minutes ago' +%Y%m%dT%H%M%SZ); fresh=$(date -u -d '58 minutes ago' +%Y%m%dT%H%M%SZ)
  new_world; new_helper_fails "Docker does not respond" "sed -i 's/^AT=.*/AT=$old/' backups/.last-update"; release 0.2.0; poll update; tick
  check "old copy: the request fails and says the update stays" test "$(summary)" = "Päivitetty: 0.1.0 → 0.2.0, mutta uusi ylläpitoapuri ei toimi (Docker ei vastaa). Päivitystä ei palautettu, koska tuoretta varmuuskopiota ei ole." -a "$(report | jq -r .status)" = failed
  check "old copy: the summary fits the 200 characters the app keeps" test "$(report | jq '.summary | length')" -le 200
  check "old copy: nothing was taken back, the new version runs" test "$(n_calls "$ROLLBACK_TAG")" = 0 -a "$(cver)" = 0.2.0 -a "$(head_commit)" = "$(git -C "$W/seed" rev-parse v0.2.0)"
  check "old copy: the record stays for a rollback by hand, and no rollback is reported" test -f "$CL/backups/.last-update" -a ! -e "$CL/ops/watchdog.frag" -a ! -e "$CL/ops/RECOVERY.txt"
  check "old copy: the request's log says why" grep -q 'The update is not taken back: backups/.last-update is missing, older than 60 minutes or of another update.' <<<"$(report | jq -r .output)"
  new_world; new_helper_fails "Docker does not respond" 'rm -f backups/.last-update'; release 0.2.0; poll update; tick
  check "old copy: no record at all is the same" bash -c "[[ \$1 == *'Päivitystä ei palautettu, koska tuoretta varmuuskopiota ei ole.' ]]" x "$(summary)"
  check "old copy: and nothing was taken back" test "$(n_calls "$ROLLBACK_TAG")" = 0 -a "$(cver)" = 0.2.0
  new_world; new_helper_fails "Docker does not respond" "sed -i 's/^PREV_VERSION=.*/PREV_VERSION=0.0.9 (x)/' backups/.last-update"; release 0.2.0; poll update; tick
  check "old copy: a record that names another version than the one updated from is not this update's" test "$(n_calls "$ROLLBACK_TAG")" = 0 -a "$(cver)" = 0.2.0 -a "$(report | jq -r .status)" = failed
  new_world; new_helper_fails "Docker does not respond" "sed -i 's/^AT=.*/AT=not-a-time/' backups/.last-update"; release 0.2.0; poll update; tick
  check "old copy: a record with no readable time is not fresh" test "$(n_calls "$ROLLBACK_TAG")" = 0 -a "$(cver)" = 0.2.0
  new_world; new_helper_fails "Docker does not respond" "sed -i 's/^AT=.*/AT=$fresh/' backups/.last-update"; release 0.2.0; poll update; tick
  check "old copy: a record under 60 minutes old is fresh, and the update is taken back" test "$(n_calls "$ROLLBACK_TAG")" = 1 -a "$(cver)" = 0.1.0
}
t_update_selftest_rollback_fails_recovery() {
  # the rollback refuses a damaged copy before it stops anything: the new version keeps running
  new_world; new_helper_fails "the app does not respond"; release 0.2.0; touch "$S/snapshot-bad"; poll update; tick
  check "recovery: a rollback that fails is said in the summary" test "$(summary)" = "Uusi ylläpitoapuri ei toiminut (sovellus ei vastaa apurille). Palautus epäonnistui, katso ops/RECOVERY.txt." -a "$(report | jq -r .status)" = failed
  check "recovery: RECOVERY.txt has the commands" grep -q '^  ./scripts/update.sh --rollback$' "$CL/ops/RECOVERY.txt"
  check "recovery: nothing is reported as taken back, and the record stays" test ! -e "$CL/ops/watchdog.frag" -a -f "$CL/backups/.last-update" -a "$(cver)" = 0.2.0
  check "recovery: the helper's log names the file" grep -q 'RECOVERY.txt written' "$CL/ops/helper.log"
  # the previous version does not start either
  new_world; new_helper_fails "the app does not respond"; release 0.2.0; touch "$S/bad_0.1.0"; poll update; tick
  check "recovery: a previous version that does not answer after the rollback gets RECOVERY.txt too" bash -c "[[ -f '$CL/ops/RECOVERY.txt' && ! -e '$CL/ops/watchdog.frag' && \$1 == *'Palautus epäonnistui, katso ops/RECOVERY.txt.' ]]" x "$(summary)"
  # the rollback is cut by its time limit, after it stopped the app: the result waits in the journal for an app to tell
  new_world; new_helper_fails "the app does not respond"; release 0.2.0; touch "$S/previous-hang" "$S/restore-needed"; poll update; tick OPS_T_ROLLBACK=2
  check "recovery: a rollback cut by its time limit gets RECOVERY.txt" bash -c "[[ -f '$CL/ops/RECOVERY.txt' && ! -e '$CL/ops/watchdog.frag' && \$1 == *'Palautus epäonnistui, katso ops/RECOVERY.txt.' ]]" x "$(jq -r .summary "$CL/ops/journal/$ID.result")"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
