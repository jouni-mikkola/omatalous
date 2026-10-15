# shellcheck shell=bash
# The helper's watchdog over an update, for scripts/ops-helper.sh. The helper's load_libs sources this file after
# check_permissions has passed on scripts/lib (and scripts/lib/dbcopy.sh, for atomic_write). It defines functions and
# three numbers and runs nothing, so all of it is in memory before a rollback swaps the files on disk. It also holds the
# helper's one rollback (rollback_run, with write_recovery, and recover) and the one count of "in a row" (in_a_row),
# which the helper's other parts call.
#
# Decision it serves: an update that starts and then stops answering is undone by the helper within minutes, once, while
# the household sleeps. A watchdog that rolls back a healthy or deliberately stopped app is worse than none, so every
# doubt means no rollback.
#
#   watchdog_tick                       main calls it, with no arguments, every tick, under the helper's lock, before the
#                                       app_running check, so also when the app is down. Its status is not read. A tick
#                                       in which it ran the rollback ends inside it (exit 0), see watchdog_rollback.
#   watchdog_report AT FROM TO REASON   the helper rolled the app back by itself, from version FROM to version TO.
#   rollback_run LOOK [STEP]            update.sh --rollback, a look at the app, and ops/RECOVERY.txt when it is left down.
#   recover [BEFORE]                    rollback_run wait for an update that failed with the app down, and what to tell of it.
#   in_a_row SECONDS LAST NOW GAP PAUSE the seconds something has lasted in a row, one look later.
#
# Its files in ops/:
#   watchdog-since          "START SECONDS LAST JOURNAL" while the app is unhealthy: when that began, how many seconds of
#                           it count so far, the time of the last look (- after a pause) and what the journal held then
#                           (watchdog_journal). One healthy look removes it.
#   watchdog-<AT>           the update of <AT> (the AT of backups/.last-update) is settled: it was rolled back, or the
#                           watchdog decided never to. Written before the rollback starts, so there is one rollback an
#                           update whatever follows.
#   run/watchdog-<AT>.log   the app's last log lines before the rollback, and the rollback's output.

# Seconds. The wait is ten minutes, no more and no less: the server's sentence about the rollback says "10 minuuttiin".
WATCHDOG_WAIT=600      # unhealthy this long in a row, then one rollback
WATCHDOG_GAP=180       # two looks further apart than this: the helper was not looking, so the time between does not count
# An update is rolled back only within an hour of its AT. A rollback over a changed database puts back the copy from
# before the update, and what was entered since then leaves the live database: an hour of that is the most to risk, and a
# bad ten minutes many hours later is rarely the update's doing.
WATCHDOG_WINDOW=3600

# in_a_row SECONDS LAST NOW GAP PAUSE: something was so for SECONDS in a row at the look of LAST and is so at the look of
# NOW (times in seconds). Prints for how long it has been so now. The time between the two looks counts when it is 0 to
# GAP seconds. When it does not count (LAST is no time, which is how a caller says there is no look to count from; a
# longer pause; a clock that went back) PAUSE decides: with `wait` the count stays as it was (the watchdog: the helper
# was not looking, and the app may have been unhealthy all along), with `again` it starts from 0 (the address: ten
# minutes that nobody watched are no ten minutes in a row).
in_a_row() {
  if [[ $2 =~ ^[0-9]{1,12}$ ]] && (($3 >= 10#$2 && $3 - 10#$2 <= $4)); then echo $(($1 + $3 - 10#$2))
  elif [[ $5 == again ]]; then echo 0
  else echo "$1"; fi
}

write_recovery() {
  {
    printf 'Omatalous: the update failed and the previous version could not be restored (%s).\n\n' "$(now_iso)"
    printf 'Run on the machine, in the folder %s:\n' "$ROOT"
    printf '  ./scripts/update.sh --rollback\n'
    printf '  docker compose logs --tail 60 banking\n'
    printf '  ./scripts/doctor.sh\n\n'
    printf 'Database copies are kept in /data/backups in the app volume (pre-update-*.db) and in the backups folder of this folder.\n'
  } >"$OPS/RECOVERY.txt"
  log "RECOVERY.txt written: $ROOT/$OPS/RECOVERY.txt"
}
# rollback_run LOOK [STEP]: the helper's one rollback. update.sh --rollback runs with its output in LOGF, the app is
# looked at, and ops/RECOVERY.txt is written when the app is left down. ROLLBACK_RC is what update.sh ended with.
# Returns 0 when update.sh ended with 0 and the app answers (RECOVERY.txt is then removed), 2 when update.sh failed and
# the app answers all the same (nothing is written or removed), 1 when the app does not answer or was not looked at
# (RECOVERY.txt is written). The four callers differ in the look after an update.sh that failed, and LOOK says which:
#   wait   fifteen looks whatever update.sh ended with (recover of the helper, and the watchdog)
#   look   one look (the rollback request: update.sh may have refused before it stopped anything)
#   none   no look: the app that runs is the version being taken back, with a helper that does not work (the self-test)
# After an update.sh that ended with 0 it is always fifteen looks, and STEP, when given, goes into LOGF before them.
rollback_run() {
  local up=no
  ROLLBACK_RC=0
  run_cap "$T_ROLLBACK" ./scripts/update.sh --rollback --yes || ROLLBACK_RC=$?
  if ((ROLLBACK_RC == 0)) && [[ -n ${2:-} ]]; then step_say "$2"; fi
  if ((ROLLBACK_RC == 0)) || [[ $1 == wait ]]; then if wait_healthy 15; then up=yes; fi
  elif [[ $1 == look ]]; then if app_up; then up=yes; fi; fi
  if [[ $up == no ]]; then write_recovery; return 1; fi
  ((ROLLBACK_RC == 0)) || return 2
  rm -f "$OPS/RECOVERY.txt"
}
# recover [BEFORE]: after a failed or killed update, if the app is not answering, go back to the previous version
# (rollback_run wait). An app that answers counts whatever update.sh ended with (status 2) and recover returns 0 for it,
# but it is the previous version only when its version is BEFORE, the one that ran before the update. Another version,
# or one that cannot be read, is left in RECOVER_VERSION ("?" for the latter) for the summary; "" says the previous
# version runs. Returns 1 when the app is left down.
recover() {
  local r=0 now
  RECOVER_VERSION=""
  if app_up; then return 0; fi
  say_log "The app does not respond, restoring the previous version."
  rollback_run wait || r=$?
  ((r != 1)) || return 1
  rm -f "$OPS/RECOVERY.txt"
  if ((r == 2)) && now=$(current_version || true) && [[ -z $now || $now != "${1:-}" ]]; then
    RECOVER_VERSION=${now:-?}; say_log "The rollback ended with $ROLLBACK_RC, and the version that answers is $RECOVER_VERSION."
  else say_log "The previous version is running."; fi
  return 0 # a line that cannot be added to the log (a full disk) does not undo a rollback that worked
}
# install.sh and update.sh (an update or a rollback by hand) hold a lock on scripts/install.sh while they run. An update
# replaces that file and keeps its lock on the old one, which a probe by name does not see, so a running process of
# either script counts as well.
watchdog_installer_idle() {
  (declare -F installer_lock >/dev/null && installer_lock) 2>/dev/null || return 1 # lib/release.sh: the folder's lock, and the one on that file
  ! pgrep -u "$EUID" -f '(update|install)\.sh' >/dev/null 2>&1
}
watchdog_since_write() { printf '%s %s %s %s\n' "$1" "$2" "$3" "$4" >"$OPS/watchdog-since.new" && mv -f "$OPS/watchdog-since.new" "$OPS/watchdog-since"; }
# What the journal holds, as one number. It changes when a request starts, ends or is reported, so two looks with the
# same number had no request between them. It is compared for sameness and never by file time: the clock can step back
# (a time sync), and a count written after the step is then older than a journal entry written before it.
watchdog_journal() { find "$OPS/journal" -type f -printf '%f %s %T@\n' 2>/dev/null | sort | cksum | tr -d ' '; }
watchdog_image_version() { # watchdog_image_version IMAGE: its version label, when it is X.Y.Z
  local v
  v=$(image_label "$1" talous.version) # lib/release.sh
  [[ $v =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && printf '%s' "$v"
}

# watchdog_look ASK: what the app is doing right now, in one word.
#   ok     it runs, and answers when asked
#   bad    it is restarting, or Docker reports it unhealthy, or (ASK=true) it runs and does not answer
#   down   there is no container, or it is not running: stopped by hand, which is not the watchdog's business
#   blind  Docker did not say
# The app is asked over HTTP only (app_up), never through `ops`: every `ops` call opens the database and applies pending
# migrations. With ASK=false Docker's own verdict is enough, so a host with no recent update gets no extra exec a minute.
watchdog_look() {
  local ask=$1 cid st="" health=""
  cid=$(timeout 20 docker compose ps -a -q banking 2>/dev/null | head -1) || { echo blind; return 0; }
  [[ -n $cid ]] || { echo down; return 0; }
  [[ $cid =~ ^[A-Za-z0-9]+$ ]] || { echo blind; return 0; }
  IFS='|' read -r st health < <(timeout 20 docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null) || true
  case $st in
    restarting) echo bad ;;
    running) if [[ $health == unhealthy ]] || { [[ $ask == true ]] && ! app_up; }; then echo bad; else echo ok; fi ;;
    created | exited | paused | dead | removing) echo down ;;
    *) echo blind ;;
  esac
}

# watchdog_settle AT WHY: from now on the watchdog never rolls this update back. Returns 1 when the mark cannot be
# written, and then nothing may be rolled back either.
watchdog_settle() {
  rm -f "$OPS"/watchdog-[0-9]*Z   # the marks of earlier updates
  printf '%s %s\n' "$(now_iso)" "$2" | atomic_write "$OPS/watchdog-$1" || { log "watchdog: $OPS/watchdog-$1 cannot be written, so nothing is rolled back"; return 1; }
}

# watchdog_doctor_item AT FROM TO: one more item, first in the stored doctor result. A page of 0.8.x knows nothing of the
# report and lists these items, so after a rollback to 0.8.x this is where an admin reads about it. The next doctor run
# writes the result again without the item.
watchdog_doctor_item() {
  local f=$OPS/doctor.frag body item
  [[ -s $f ]] || return 0
  body=$(sed -E 's/\{"id":"watchdog"[^}]*\},?//' "$f") || return 0
  item="{\"id\":\"watchdog\",\"level\":\"error\",\"title\":\"Edellinen versio palautettiin, koska sovellus ei vastannut 10 minuuttiin\""
  item+=",\"detail\":\"Ylläpitoapuri vaihtoi itse version $2 takaisin versioon $3. Rivi poistuu seuraavassa tarkistuksessa.\""
  item+=",\"hint\":\"Loki ajalta ennen palautusta on palvelimella: ops/run/watchdog-$1.log\"}"
  case $body in
    '"doctor":{"at":"'*'","items":[]}') body=${body/'"items":[]'/"\"items\":[$item]"} ;;
    '"doctor":{"at":"'*'","items":['*']}') body=${body/'"items":['/"\"items\":[$item,"} ;;
    *) return 0 ;;
  esac
  printf '%s' "$body" | atomic_write "$f"
}

# watchdog_rollback AT: the one rollback of this update. The mark comes first. After update.sh the files on disk are the
# previous release's and the functions in memory are this one's. So nothing below update.sh reads a script, and the tick
# ends here once the state is sent (exit 0): no request, no update check and no doctor run follow in this process.
watchdog_rollback() {
  local at=$1 from to latest previous r=0
  # shellcheck disable=SC2034 # run_cap writes there
  local LOGF=$OPS/run/watchdog-$at.log
  # A rollback has failed here already (recover, or a rollback request): a second one would be a loop.
  if [[ -e $OPS/RECOVERY.txt ]]; then
    watchdog_settle "$at" "no rollback: one has failed already" && log "watchdog: the app is unhealthy, but a rollback has failed already ($OPS/RECOVERY.txt). The update of $at is left alone."
    return 0
  fi
  latest=$(image_id "$INSTANCE:latest"); previous=$(image_id "$INSTANCE:previous")
  if [[ -z $previous || $latest == "$previous" ]]; then
    watchdog_settle "$at" "no rollback: no other version to go back to" && log "watchdog: the app is unhealthy, but there is no other version to go back to. The update of $at is left alone."
    return 0
  fi
  from=$(watchdog_image_version "$INSTANCE:latest"); to=$(watchdog_image_version "$INSTANCE:previous")
  watchdog_settle "$at" "rollback" || return 0
  log "watchdog: the app has been unhealthy for 10 minutes after the update of $at. Going back from ${from:-?} to ${to:-the previous version}."
  : >"$LOGF"
  run_cap "$T_LOGS" docker compose logs --no-color --tail 60 banking || true
  rollback_run wait || r=$?
  if ((r == 1)); then
    log "watchdog: the rollback did not bring the app back (update.sh ended with $ROLLBACK_RC). Its output: $ROOT/$LOGF"
    exit 0
  fi
  if ((r != 0)); then
    log "watchdog: the rollback ended with $ROLLBACK_RC, and the app answers. Nothing is reported. Its output: $ROOT/$LOGF"
    exit 0
  fi
  # The stored answer about a new version is from before the rollback. The next check asks again, but the heartbeat's checks
  # do not offer the version taken back for 24 hours (taken_back_mark, lib/ops-hourly.sh). ops/last-check stays, because that
  # check also runs doctor, which writes its result again without the item below.
  rm -f "$OPS/watchdog-since" "$OPS/check.frag"; taken_back_mark "$from"
  [[ -n $to ]] || to=$(current_version || true)
  log "watchdog: version ${to:-?} is running again. The app's last log lines and the rollback's output: $ROOT/$LOGF"
  if watchdog_report "$at" "$from" "$to" unhealthy; then
    watchdog_doctor_item "$at" "$from" "$to" || true
  else
    log "watchdog: the rollback cannot be reported, the versions are not known (${from:-?}, ${to:-?})"
  fi
  send_state # the heartbeat's own: the report does not wait for the tenth tick
  exit 0
}

# One look a tick. The count is in seconds between looks, because ticks can be late. What does not count:
#   - an install, update or rollback by hand is running (the installer's lock, or its process): no look at all, the
#     count waits
#   - a request ran since the last look (the helper's own lock was held), or the last look is more than WATCHDOG_GAP ago
#   - Docker did not say what the container is doing: the count waits
#   - the container is stopped or gone: the count starts over
# The look itself runs on every tick, also with no recent update, so that it is known whether the app was unhealthy
# before an update began: such an update did not cause it and is never rolled back.
watchdog_tick() {
  local now at at_s="" watched=false start="" secs=0 last="" seen="" journal look
  now=$(date +%s) && [[ $now =~ ^[1-9][0-9]{0,11}$ ]] || return 0
  if [[ -f $OPS/watchdog-since ]]; then
    read -r start secs last seen <"$OPS/watchdog-since" || true
    [[ $start =~ ^[1-9][0-9]{0,11}$ && $secs =~ ^(0|[1-9][0-9]{0,8})$ && $last =~ ^([1-9][0-9]{0,11}|-)$ ]] || { start=""; secs=0; last=""; }
  fi
  journal=$(watchdog_journal)
  if ! watchdog_installer_idle; then [[ -z $start ]] || watchdog_since_write "$start" "$secs" - "$journal"; return 0; fi

  at=$(last_update AT)
  if [[ $at =~ ^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$ ]]; then
    at_s=$(date -u -d "${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]} ${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}" +%s 2>/dev/null) || at_s=""
  fi
  if [[ $at_s =~ ^[1-9][0-9]{0,11}$ && ! -e $OPS/watchdog-$at ]] && ((now >= at_s && now - at_s < WATCHDOG_WINDOW)); then watched=true; fi
  if [[ $watched == true && -n $start ]] && ((start <= at_s)); then
    watched=false
    watchdog_settle "$at" "no rollback: unhealthy before the update" && log "watchdog: the app was unhealthy before the update of $at began, so that update is never rolled back for it."
  fi

  look=$(watchdog_look "$watched")
  case $look in
    ok) rm -f "$OPS/watchdog-since"; return 0 ;;
    bad) ;;
    down) [[ -z $start ]] || watchdog_since_write "$start" 0 - "$journal"; return 0 ;;
    *) [[ -z $start ]] || watchdog_since_write "$start" "$secs" - "$journal"; return 0 ;;
  esac
  # a request since the last look (the journal differs) is a look that does not count, like the - of a pause
  if [[ -z $start ]]; then start=$now; secs=0
  else [[ $seen == "$journal" ]] || last=-; secs=$(in_a_row "$secs" "$last" "$now" "$WATCHDOG_GAP" wait); fi
  watchdog_since_write "$start" "$secs" "$now" "$journal" || return 0
  [[ $watched == true ]] && ((secs >= WATCHDOG_WAIT)) || return 0
  watchdog_rollback "$at"
}

# watchdog_report AT FROM TO REASON: AT is the time of the update, as backups/.last-update holds it (20260101T000000Z) or
# as an ISO time (2026-01-01T00:00:00Z), FROM and TO are versions (X.Y.Z) and REASON is unhealthy or self_test. Writes
# ops/watchdog.frag, one JSON object {"at","from","to","reason"} with AT as an ISO time, through atomic_write. state_json
# sends the file as "watchdog" when it exists, with the next snapshot and with the result of a request; act_update removes
# it when a later update has gone through. An argument of any other form writes nothing and returns 1.
watchdog_report() {
  local at=${1:-} from=${2:-} to=${3:-} reason=${4:-}
  if [[ $at =~ ^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$ ]]; then
    at="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}T${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}Z"
  fi
  [[ $at =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 1
  [[ $from =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $to =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  case $reason in unhealthy | self_test) ;; *) return 1 ;; esac
  printf '{"at":"%s","from":"%s","to":"%s","reason":"%s"}' "$at" "$from" "$to" "$reason" | atomic_write "$OPS/watchdog.frag"
}
