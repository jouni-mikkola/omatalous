# shellcheck shell=bash
# The helper's self-test, and what an update does when the helper it brought fails that test, for scripts/ops-helper.sh.
# The helper's load_libs sources this file after check_permissions has passed on scripts/lib; it defines functions and
# four constants and nothing else.
#
# Decision: an update that brings a helper that cannot run is undone at once, by the helper that is still in memory, so a
# household is never left with an app nobody can update.
#
#   self_test            `ops-helper.sh --self-test` (the helper's only argument) calls it, with no arguments, after the
#                        files were checked and loaded and without the lock. It prints `self-test ok` or
#                        `self-test failed: <reason>`, its exit status (0 or 1) is the helper's, and it writes one line
#                        into ops/helper.log and nothing else.
#   after_update_check   act_update calls it, with no arguments, once the new version answers (wait_healthy passed), after
#                        SUMMARY, ops/check.frag and the removal of ops/watchdog.frag. It runs the self-test of the helper
#                        on the disk, which is the new one. When that fails it takes the update back and makes the request
#                        a failed one (fail); its own status is not read.
#
# It uses the helper's SELF, ROOT, OPS, NODE, OPS_HELPER_VERSION, ENV_ERR, T_ROLLBACK, t_for, now_iso, log, say_log,
# pol_get, check_permissions, env_check, app_up, current_version, semver_gt, wait_healthy, run_cap, fail and
# write_recovery, watchdog_report of lib/ops-watchdog.sh, and the locals before and after of act_update.

# Room for two looks at Docker and the app (20 + 20 + 30 s each at the worst), the wait between them and the dry poll.
T_SELFTEST=$(t_for 240 SELFTEST)
# Seconds before the one second look at Docker, the app's health and its version.
SELFTEST_RETRY_WAIT=10
# The first version whose `ops poll` knows --dry. An older app polls for real: it would hand out a queued request and
# count the helper as seen. With nothing queued both answer the same line, so the version is asked first.
SELFTEST_DRY_FROM=0.9.0
# The update is taken back only with the record of that same update, and only this fresh (seconds): the rollback may
# put the database copy of the record in place of the database.
SELFTEST_COPY_MAX_AGE=3600

# The checks. Returns 1 at the first that fails, with the reason in SELFTEST_WHY (English, for the terminal and the
# log). Everything here only reads. The app is asked only after it has answered its health check: every command run in
# the app opens the database and applies pending migrations, and a server that answers has done both already.
selftest_checks() {
  local f out d
  SELFTEST_WHY=""
  # bash reads a script while it runs it, so a broken line shows only when it is reached: parse every script whole
  for f in "$SELF" scripts/*.sh scripts/lib/*.sh; do
    [[ -f $f ]] || continue
    "$BASH" -n "$f" 2>/dev/null || { SELFTEST_WHY="${f#"$ROOT"/} has a syntax error"; return 1; }
  done
  command -v timeout >/dev/null && command -v flock >/dev/null || { SELFTEST_WHY="timeout or flock is missing (coreutils, util-linux)"; return 1; }
  # check_permissions names the file in its log line: the time and the closing sentence are cut off
  if ! out=$(check_permissions 2>&1); then
    out=${out#* }; SELFTEST_WHY=${out% The helper does not run.}
    [[ -n $SELFTEST_WHY ]] || SELFTEST_WHY="File permissions: a file of the helper is not safe (owner or write access)."
    return 1
  fi
  env_check || { SELFTEST_WHY=".env is invalid: $ENV_ERR"; return 1; }
  # the docker binary named at install goes first in PATH, as in a tick
  d=$(pol_get DOCKER)
  if [[ -n $d && $d =~ ^/[A-Za-z0-9_./-]+/docker$ && -x $d && ! -w $(dirname "$d") ]]; then PATH=$(dirname "$d"):$PATH; export PATH; fi
  # One failed look must not take an update back: right after the switch Docker or the app can be slow for a moment.
  # What a second look cannot change (a broken file, .env, a wrong answer to the poll) gets no second look.
  selftest_live || { sleep "$SELFTEST_RETRY_WAIT"; selftest_live; } || return 1
  if ! semver_gt "$SELFTEST_DRY_FROM" "$SELFTEST_V"; then
    out=$(timeout 30 docker compose exec -T banking "${NODE[@]}" dist/node.js ops poll --dry --helper "$OPS_HELPER_VERSION" 2>/dev/null | head -c 200) || true
    [[ $out == '{"request":null}' ]] || { SELFTEST_WHY="the app does not answer the dry poll"; return 1; }
  fi
  return 0
}

# Docker, the app's health and its version, once. The version is left in SELFTEST_V.
selftest_live() {
  SELFTEST_WHY=""; SELFTEST_V=""
  timeout 20 docker info >/dev/null 2>&1 || { SELFTEST_WHY="Docker does not respond"; return 1; }
  app_up || { SELFTEST_WHY="the app does not respond"; return 1; }
  SELFTEST_V=$(APP_TIMEOUT=30 current_version || true)
  [[ -n $SELFTEST_V ]] || { SELFTEST_WHY="the app does not tell its version"; return 1; }
}

self_test() {
  local line="self-test ok"
  selftest_checks || line="self-test failed: $SELFTEST_WHY"
  # the answer is the one line on stdout, so the log line does not go through log (which also writes to the terminal)
  if [[ -d $OPS && -w $OPS ]]; then printf '%s %s\n' "$(now_iso)" "$line" >>"$OPS/helper.log" 2>/dev/null || true; fi
  printf '%s\n' "$line"
  [[ $line == "self-test ok" ]]
}

# The reason for the page, in Finnish. The words come from the new helper, and a reason this helper does not know gets
# the plain sentence.
selftest_why_fi() {
  case $1 in
    *"syntax error"*) echo "apurin tiedostossa on virhe" ;;
    *"do not load"*) echo "apurin tiedostot eivät kelpaa" ;;
    *"not safe"*) echo "apurin tiedostojen oikeudet eivät kelpaa" ;;
    *".env is invalid"*) echo ".env ei kelpaa" ;;
    *"is missing"*) echo "koneelta puuttuu ohjelma" ;;
    *"Docker does not respond"*) echo "Docker ei vastaa" ;;
    *"app does not respond"*) echo "sovellus ei vastaa apurille" ;;
    *"its version"*) echo "sovellus ei kerro versiotaan" ;;
    *"dry poll"*) echo "sovellus ei vastaa apurin kyselyyn" ;;
    "no answer in "*) echo "itsetesti ei valmistunut ajoissa" ;;
    *) echo "itsetesti epäonnistui" ;;
  esac
}

# selftest_copy BEFORE: backups/.last-update is the record of the update that just ran. It names the version the update
# left (BEFORE, when that is known) and its time is under SELFTEST_COPY_MAX_AGE old. Sets SELFTEST_AT and SELFTEST_PREV.
# update.sh writes the record only when it had a previous image to keep, so an update can leave an older one behind.
selftest_copy() {
  local f=backups/.last-update at now
  SELFTEST_AT=""; SELFTEST_PREV=""
  [[ -f $f ]] || return 1
  SELFTEST_AT=$(grep -E '^AT=' "$f" | tail -1 | cut -d= -f2-)
  SELFTEST_PREV=$(grep -E '^PREV_VERSION=' "$f" | tail -1 | cut -d= -f2-); SELFTEST_PREV=${SELFTEST_PREV%% *}
  [[ $SELFTEST_AT =~ ^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$ ]] || return 1
  at=$(date -u -d "${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]} ${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}" +%s 2>/dev/null) || return 1
  now=$(date -u +%s)
  # a time ahead of the clock (the clock was set back) is no proof of a fresh copy either
  ((now - at < SELFTEST_COPY_MAX_AGE && at - now < 300)) || return 1
  [[ -z ${1:-} || $SELFTEST_PREV == "$1" ]]
}

after_update_check() {
  local out rc=0 why why_fi from to
  say_log "Testing the new maintenance helper (./scripts/ops-helper.sh --self-test)."
  # The file on the disk, in its own process: this one still runs the helper from before the update. Without the
  # lock (fd 8): the test does not take it, and a process it left behind must not hold it after this tick.
  out=$(timeout -k 10 "$T_SELFTEST" ./scripts/ops-helper.sh --self-test 8>&- 2>&1 | tail -c 2000) || rc=$?
  [[ -z $out ]] || say_log "$out"
  out=${out##*$'\n'}
  if ((rc == 0)) && [[ $out == "self-test ok" ]]; then return 0; fi
  if [[ $out == "self-test failed: "* ]]; then why=${out#self-test failed: }
  elif ((rc == 124 || rc == 137)); then why="no answer in $T_SELFTEST s"
  else why="it ended with status $rc and no answer"; fi
  why=$(printf '%s' "$why" | tr -cd "A-Za-z0-9 .,:/_()='-" | head -c 160)
  why_fi=$(selftest_why_fi "$why")
  log "update: the new helper failed its self-test ($why)"
  if ! selftest_copy "${before:-}"; then
    say_log "The new helper does not work ($why). The update is not taken back: backups/.last-update is missing, older than $((SELFTEST_COPY_MAX_AGE / 60)) minutes or of another update."
    fail "Päivitetty: ${before:-?} → ${after:-?}, mutta uusi ylläpitoapuri ei toimi ($why_fi). Päivitystä ei palautettu, koska tuoretta varmuuskopiota ei ole."
    return 0
  fi
  # From here on the files on the disk are the previous version's: everything called below is in memory already.
  say_log "The new helper does not work ($why). Restoring the previous version."
  rc=0; run_cap "$T_ROLLBACK" ./scripts/update.sh --rollback --yes || rc=$?
  if ((rc == 0)) && wait_healthy 15; then
    # as after the rollback action: the saved answer of the version check says "no update", and the update is there again
    rm -f "$OPS/RECOVERY.txt" "$OPS/check.frag" "$OPS/last-check"
    from=${after:-}; to=$(current_version || true); to=${to:-${before:-}}; to=${to:-$SELFTEST_PREV}
    watchdog_report "$SELFTEST_AT" "$from" "$to" self_test || log "update: the rollback could not be reported to the app (from \"$from\" to \"$to\")"
    say_log "The previous version is running."
    log "update: the previous version was restored"
    fail "Edellinen versio palautettiin, koska uusi ylläpitoapuri ei toiminut ($why_fi)."
  else
    write_recovery
    fail "Uusi ylläpitoapuri ei toiminut ($why_fi). Palautus epäonnistui, katso ops/RECOVERY.txt." "$((rc ? rc : 1))"
  fi
}
