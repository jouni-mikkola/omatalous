#!/usr/bin/env bash
# Tests for the maintenance helper's watchdog (scripts/lib/ops-watchdog.sh): one rollback when the app has been unhealthy
# for ten minutes in a row after an update, and none in every other case. They run the real helper and the real
# update.sh against the stub world of ops-world.sh. Nothing here touches the network, a real container or a real registry.
#
#   tools/test/ops-watchdog.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # ops-world.sh copies the scripts from there
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged ops-watchdog.test.sh "$@"

# ── the world, with a clock and a container state ───────────────────────────
# The clock is the world's (set_clock, later): nothing moves it but the scenario, so 9 min 59 s and 10 min are exact on a
# slow machine too. The world has no container state, so it is added here: `docker inspect` of the container's state
# answers stub/state (default: running or exited, as the world has it) and stub/health (default: no health check); an
# empty stub/state is a Docker that does not say.
AT0=20260101T120000Z   # the AT of an update made at T0
WAIT_MAX=60            # seconds a scenario waits for something it started in the background
world() {
  new_world
  set_clock
  mv "$S/bin/docker" "$S/bin/docker.world"
  cat >"$S/bin/docker" <<'EOF'
#!/bin/bash
if [[ ${1:-} == inspect && $* == *State.Status* ]]; then
  S=$OPS_STUB_DIR
  echo "docker inspect State.Status" >>"$S/calls.log"
  if [[ -e $S/state ]]; then st=$(cat "$S/state"); elif [[ -e $S/running ]]; then st=running; else st=exited; fi
  printf '%s|%s\n' "$st" "$(cat "$S/health" 2>/dev/null)"
  exit 0
fi
exec "${0%/*}/docker.world" "$@" # by its own place: the helper also calls docker with an empty environment
EOF
  # The real pgrep, narrowed to processes whose folder is inside this world: other suites run update.sh at the same time
  # as the same user, and the watchdog would wait for them.
  cat >"$S/bin/pgrep" <<'EOF'
#!/bin/bash
found=1
for p in $(/usr/bin/pgrep "$@"); do
  case $(readlink "/proc/$p/cwd" 2>/dev/null) in "${OPS_STUB_DIR%/stub}"*) echo "$p"; found=0 ;; esac
done
exit $found
EOF
  chmod +x "$S/bin/docker" "$S/bin/pgrep"
}
ticks() { local i; for ((i = 0; i < $1; i++)); do later "${2:-60}"; tick; done; } # ticks N [SECONDS]: N ticks, SECONDS apart
# count_to SECONDS: looks a minute apart (the last one sooner) until SECONDS of unhealthy time count. The first look
# starts the count and adds nothing.
count_to() {
  local left=$1
  later 60; tick
  while ((left >= 60)); do later 60; tick; left=$((left - 60)); done
  if ((left > 0)); then later "$left"; tick; fi
}
updated() { release 0.2.0; poll update; tick; } # an update to 0.2.0 that went through, at the clock's time
last_at() { sed -n 's/^AT=//p' "$CL/backups/.last-update"; }
rollbacks() { n_calls '^docker image tag banking-app:previous banking-app:latest'; }
counted() { awk '{print $2}' "$CL/ops/watchdog-since" 2>/dev/null; }
no_count() { [[ ! -e $CL/ops/watchdog-since ]]; }
logged() { grep -e "$1" "$CL/ops/helper.log" >/dev/null 2>&1; }

# ── the rollback ────────────────────────────────────────────────────────────
t_watchdog_rolls_back_once() {
  world; updated
  check "once: the update went through and left its record" test "$(cver)" = 0.2.0 -a "$(last_at)" = "$AT0"
  ticks 3
  check "once: a healthy app is left alone" test "$(rollbacks)" = 0
  check "once: and nothing is counted" no_count
  touch "$S/bad_0.2.0"; count_to 599
  check "once: no rollback after 9 min 59 s without an answer" test "$(rollbacks)" = 0 -a "$(counted)" = 599
  later 1; tick
  check "once: at 10 minutes the previous version is restored" test "$(rollbacks)" = 1 -a "$(cver)" = 0.1.0 -a "$(head_commit)" = "$C1"
  check "once: the update is marked as settled" test -s "$CL/ops/watchdog-$AT0"
  check "once: the count is gone" no_count
  check "once: the app answers, so there is no RECOVERY.txt" test ! -e "$CL/ops/RECOVERY.txt"
  check "once: the log on the host has the app's last lines and the rollback's output" bash -c "grep -q 'kept log line' '$CL/ops/run/watchdog-$AT0.log' && grep -q 'Restoring the version' '$CL/ops/run/watchdog-$AT0.log'"
  check "once: helper.log says what was done" logged 'watchdog: .*Going back from 0.2.0 to 0.1.0'
  check "once: and how it ended" logged 'watchdog: version 0.1.0 is running again'
  ticks 3
  check "once: the ticks after it do nothing more" test "$(rollbacks)" = 1
  # installed again, the same version is a new update with its own one rollback
  rm "$S/bad_0.2.0"; poll update "$ID2"; later 60; tick
  local at2; at2=$(last_at)
  check "once: the version can be installed again" test "$(cver)" = 0.2.0 -a -n "$at2" -a "$at2" != "$AT0"
  touch "$S/bad_0.2.0"; count_to 600
  check "once: and that update has its own one rollback" test "$(rollbacks)" = 2 -a "$(cver)" = 0.1.0
  check "once: only the newest update's mark is kept" test -s "$CL/ops/watchdog-$at2" -a ! -e "$CL/ops/watchdog-$AT0"
}
t_watchdog_needs_ten_minutes_in_a_row() {
  world; updated; touch "$S/bad_0.2.0"; count_to 599
  rm "$S/bad_0.2.0"; later 60; tick
  check "in a row: one healthy look clears the count" no_count
  touch "$S/bad_0.2.0"; count_to 599
  check "in a row: 9 min 59 s twice, with one answer between, is no rollback" test "$(rollbacks)" = 0 -a "$(counted)" = 599
  later 1; tick
  check "in a row: the second period reaches 10 minutes by itself" test "$(rollbacks)" = 1
  # ticks can be late: the time between two looks counts, up to three minutes
  world; updated; touch "$S/bad_0.2.0"; ticks 4 150
  check "late ticks: looks 150 s apart count in full" test "$(counted)" = 450 -a "$(rollbacks)" = 0
  ticks 1 150
  check "late ticks: and reach 10 minutes by the clock" test "$(rollbacks)" = 1
  world; updated; touch "$S/bad_0.2.0"; ticks 1; ticks 3 181
  check "late ticks: a look more than 3 minutes after the last one adds nothing" test "$(counted)" = 0
  ticks 1 180
  check "late ticks: exactly 3 minutes still count" test "$(counted)" = 180 -a "$(rollbacks)" = 0
}
# The host's clock steps back (a time sync), and what the helper writes after the step is older, by file time, than the
# update's journal entry written before it. Forced here with a journal dated an hour ahead: by file time a request
# would seem to have run before every look, and nothing would ever count.
t_watchdog_clock_steps_back() {
  world; updated; touch -d '+1 hour' "$CL"/ops/journal/*; touch "$S/bad_0.2.0"; count_to 599
  check "clock: a journal dated after every look does not hold the count back" test "$(counted)" = 599 -a "$(rollbacks)" = 0
  later 1; tick
  check "clock: the rollback comes at its 10 minutes" test "$(rollbacks)" = 1
}
t_watchdog_report() {
  world; tick # the first tick stores a doctor result
  updated; touch "$S/bad_0.2.0"; count_to 540; rm -f "$S/state.last"; poll backup "$ID2"; later 60; tick
  local frag='{"at":"2026-01-01T12:00:00Z","from":"0.2.0","to":"0.1.0","reason":"unhealthy"}'
  check "report: ops/watchdog.frag names the update, both versions and the reason unhealthy" test "$(cat "$CL/ops/watchdog.frag")" = "$frag"
  check "report: the state goes out in the tick of the rollback, with the report, and is JSON" bash -c "grep -q '\"watchdog\":$frag' '$S/state.last' && jq -e . '$S/state.last' >/dev/null"
  check "report: the stored doctor result has the item watchdog first, at level error" test "$(jq -r '.doctor.items[0] | .id + " " + .level' "$S/state.last")" = "watchdog error"
  check "report: its title has the helper's own name for a rollback, and the 10 minutes" test "$(jq -r '.doctor.items[0].title' "$S/state.last")" = "Edellinen versio palautettiin, koska sovellus ei vastannut 10 minuuttiin"
  check "report: its detail names both versions" test "$(jq -r '.doctor.items[0].detail' "$S/state.last")" = "Ylläpitoapuri vaihtoi itse version 0.2.0 takaisin versioon 0.1.0. Rivi poistuu seuraavassa tarkistuksessa."
  check "report: its hint names the log on the host" test "$(jq -r '.doctor.items[0].hint' "$S/state.last")" = "Loki ajalta ennen palautusta on palvelimella: ops/run/watchdog-$AT0.log"
  check "report: doctor's own items stay after it" test "$(jq -r '[.doctor.items[].id] | join(" ")' "$S/state.last")" = "watchdog x-1"
  check "report: the answer about a new version from before the rollback is not sent" bash -c "! grep -q update_available '$S/state.last'"
  # the files on disk are the previous release's now, so the tick ends with the state
  check "report: the tick of the rollback takes no request" test "$(n_calls '^backup.sh ran')" = 0
  rm -f "$S/state.last"; ticks 11
  check "report: the next tick takes it" test "$(n_calls '^backup.sh ran')" = 1
  check "report: later states keep sending the report" grep -q "\"watchdog\":$frag" "$S/state.last"
}

# ── never a loop ────────────────────────────────────────────────────────────
t_watchdog_second_bad_period_no_rollback() {
  world; updated; cp "$CL/backups/.last-update" "$W/last-update"; touch "$S/bad_0.2.0"; count_to 600
  check "second: the first bad period is rolled back" test "$(rollbacks)" = 1 -a "$(cver)" = 0.1.0
  touch "$S/bad_0.1.0"; ticks 6 150
  check "second: the previous version going bad too starts no second rollback" test "$(rollbacks)" = 1
  # the mark alone is enough: the record of the update is back, as after a rollback that ended half way
  cp "$W/last-update" "$CL/backups/.last-update"; ticks 6 150
  check "second: nor does it with the update's record still in place" test "$(rollbacks)" = 1
  check "second: the mark stopped it, no later check had to" bash -c "! grep -q 'no other version' '$CL/ops/helper.log'"
  # a rollback request that failed: the watchdog does not try once more
  world; updated; touch "$S/bad_0.2.0" "$S/bad_0.1.0"; poll rollback "$ID2"; later 60; tick
  check "second: a rollback request failed and left RECOVERY.txt and the update's record" test -s "$CL/ops/RECOVERY.txt" -a -f "$CL/backups/.last-update" -a "$(rollbacks)" = 1
  ticks 6 150
  check "second: the watchdog does not roll back after it" test "$(rollbacks)" = 1
  check "second: it settles the update and says why" bash -c "[[ -s '$CL/ops/watchdog-$AT0' ]] && grep -q 'a rollback has failed already' '$CL/ops/helper.log'"
  # the same with RECOVERY.txt removed by hand: the previous image is already the one in use
  world; updated; touch "$S/bad_0.2.0" "$S/bad_0.1.0"; poll rollback "$ID2"; later 60; tick; rm -f "$CL/ops/RECOVERY.txt"; ticks 6 150
  check "second: with nothing older to go back to there is no rollback either" test "$(rollbacks)" = 1
  check "second: and that is said too" logged 'no other version to go back to'
}
t_watchdog_failed_rollback_recovery() {
  world; updated; touch "$S/bad_0.2.0" "$S/bad_0.1.0"; count_to 600
  check "failed: the rollback was tried" test "$(rollbacks)" = 1
  check "failed: RECOVERY.txt has the commands" grep -q 'update.sh --rollback' "$CL/ops/RECOVERY.txt"
  check "failed: nothing is reported as rolled back" test ! -e "$CL/ops/watchdog.frag"
  check "failed: helper.log says so" logged 'watchdog: the rollback did not bring the app back'
  check "failed: the update is settled all the same" test -s "$CL/ops/watchdog-$AT0"
  ticks 6 150
  check "failed: an app that stays unhealthy is not rolled back again" test "$(rollbacks)" = 1
  echo unhealthy >"$S/health"; ticks 6 150
  check "failed: also when Docker reports it unhealthy" test "$(rollbacks)" = 1
}
t_watchdog_unhealthy_before_update() {
  # an earlier update is being watched, the app goes bad, and a second update is made on top
  world; updated; touch "$S/bad_0.2.0"; count_to 240
  release 0.3.0; poll update "$ID2"; later 60; tick
  local at2; at2=$(last_at)
  check "before: the second update went through while the app was unhealthy" test "$(cver)" = 0.3.0 -a "$at2" = 20260101T120600Z
  touch "$S/bad_0.3.0"; ticks 6 150
  check "before: the app was unhealthy before that update, so it is not rolled back" test "$(rollbacks)" = 0 -a "$(cver)" = 0.3.0
  check "before: the update is settled, and helper.log says why" bash -c "[[ -s '$CL/ops/watchdog-$at2' ]] && grep -q 'was unhealthy before the update of $at2' '$CL/ops/helper.log'"
  # no update to watch yet: Docker reports the container unhealthy, then the first update is made
  world; echo unhealthy >"$S/health"; ticks 2
  check "before: with no update to watch the app is not asked, and Docker's verdict is counted" test "$(n_calls wget)" = 0 -a "$(counted)" = 60
  updated; rm "$S/health"; touch "$S/bad_0.2.0"; ticks 6 150
  check "before: the first update of an app that was unhealthy is not rolled back" test "$(rollbacks)" = 0 -a "$(cver)" = 0.2.0
  check "before: and is settled" test -s "$CL/ops/watchdog-$(last_at)"
}

# ── what does not count ─────────────────────────────────────────────────────
t_watchdog_ignores_stopped() {
  world; updated; rm "$S/running"; ticks 6 150
  check "stopped: a container stopped by hand is not rolled back" test "$(rollbacks)" = 0
  check "stopped: and nothing is counted" no_count
  rm "$S/container"; ticks 6 150
  check "stopped: nor is a missing one" test "$(rollbacks)" = 0
  # a stop in the middle of a bad period starts the count over
  world; updated; touch "$S/bad_0.2.0"; count_to 540
  rm "$S/running"; later 60; tick; touch "$S/running"
  check "stopped: a stop by hand starts the count over" test "$(counted)" = 0
  count_to 599
  check "stopped: the time before the stop is not added" test "$(rollbacks)" = 0 -a "$(counted)" = 599
  echo paused >"$S/state"; later 60; tick; rm "$S/state"
  check "stopped: a paused container is one stopped by hand" test "$(counted)" = 0 -a "$(rollbacks)" = 0
  count_to 600
  check "stopped: started again, and unhealthy for 10 minutes: rolled back" test "$(rollbacks)" = 1
}
t_watchdog_pauses_under_lock() {
  world; updated; touch "$S/bad_0.2.0"; count_to 540
  local looks; looks=$(n_calls 'inspect State.Status')
  exec 7<"$CL/scripts/install.sh"; flock -n 7 # what install.sh and update.sh hold while they run
  ticks 6 150
  check "lock: under the installer's lock nothing is rolled back and the count waits" test "$(rollbacks)" = 0 -a "$(counted)" = 540
  check "lock: the app is not looked at" test "$(n_calls 'inspect State.Status')" = "$looks"
  flock -u 7; exec 7<&-
  later 60; tick
  check "lock: the first look after it adds nothing" test "$(counted)" = 540 -a "$(rollbacks)" = 0
  later 59; tick
  check "lock: the count goes on from where it was" test "$(counted)" = 599 -a "$(rollbacks)" = 0
  later 1; tick
  check "lock: and reaches its 10 minutes" test "$(rollbacks)" = 1
  # An update replaces scripts/install.sh and keeps its lock on the old file, so the lock by name looks free while
  # update.sh still waits for the new version. The running process is seen instead.
  world; updated; touch "$S/bad_0.2.0"; count_to 540
  mkdir "$W/hand"; printf '#!/bin/bash\ntrap "kill \\$s" TERM\nsleep 300 & s=$!\n: >started\nwait\n' >"$W/hand/update.sh"
  (cd "$W/hand" && exec bash ./update.sh) &
  local pid=$! limit=$((SECONDS + WAIT_MAX))
  until [[ -e $W/hand/started ]] || ((SECONDS >= limit)); do sleep 0.1; done
  [[ -e $W/hand/started ]] || fail "process: the stub update.sh did not write hand/started within $WAIT_MAX s, so it was not seen running"
  ticks 6 150
  check "process: while an update.sh runs nothing is rolled back and the count waits" test "$(rollbacks)" = 0 -a "$(counted)" = 540
  kill "$pid"; wait "$pid" 2>/dev/null
  later 60; tick
  check "process: the first look after it adds nothing" test "$(counted)" = 540 -a "$(rollbacks)" = 0
  later 59; tick; later 1; tick
  check "process: the count goes on to its 10 minutes" test "$(rollbacks)" = 1
}
t_watchdog_not_during_update() {
  # another run of the helper holds its lock (an update takes up to 20 minutes): the ticks end at once
  world; updated; touch "$S/bad_0.2.0"; count_to 540
  exec 7>>"$CL/ops/.lock"; flock -n 7
  ticks 12
  check "own lock: ticks under a running helper do nothing" test "$(rollbacks)" = 0 -a "$(counted)" = 540
  flock -u 7; exec 7>&-
  later 60; tick
  check "own lock: the time under it does not count" test "$(counted)" = 540 -a "$(rollbacks)" = 0
  later 59; tick; later 1; tick
  check "own lock: the count goes on to its 10 minutes" test "$(rollbacks)" = 1
  # a request between two looks, short enough to fit between two ticks
  world; updated; touch "$S/bad_0.2.0"; count_to 480
  poll backup "$ID2"; later 60; tick
  check "request: a backup ran in the tick that counted 9 minutes" test "$(counted)" = 540 -a "$(n_calls '^backup.sh ran')" = 1
  later 60; tick
  check "request: the minute it ran in does not count" test "$(counted)" = 540 -a "$(rollbacks)" = 0
  later 59; tick
  check "request: the next one does" test "$(counted)" = 599 -a "$(rollbacks)" = 0
  later 1; tick
  check "request: and the count reaches its 10 minutes" test "$(rollbacks)" = 1
}
t_watchdog_quiet_after_one_hour() {
  world; updated; later 2939; touch "$S/bad_0.2.0"; count_to 600
  check "1 h: one second before the update is an hour old it is still rolled back" test "$(rollbacks)" = 1
  world; updated; later 2940; touch "$S/bad_0.2.0"; count_to 540
  check "1 h: (9 minutes are counted when the update turns an hour old)" test "$(counted)" = 540
  local asked; asked=$(n_calls wget)
  later 60; tick
  check "1 h: at one hour it is not" test "$(rollbacks)" = 0
  ticks 6 150
  check "1 h: and stays so" test "$(rollbacks)" = 0 -a "$(cver)" = 0.2.0
  check "1 h: the app is no longer asked, and Docker's verdict alone is read" bash -c "[[ \$(grep -c wget '$S/calls.log') == '$asked' && ! -e '$CL/ops/watchdog-since' ]]"
}
t_watchdog_docker_states() {
  world; updated; echo restarting >"$S/state"; count_to 300
  check "docker: a restarting container counts" test "$(counted)" = 300
  rm "$S/state"; echo unhealthy >"$S/health"; ticks 4
  check "docker: so does one that Docker reports unhealthy" test "$(counted)" = 540 -a "$(rollbacks)" = 0
  : >"$S/state"; ticks 3
  check "docker: when Docker does not say, the count waits" test "$(counted)" = 540 -a "$(rollbacks)" = 0
  rm "$S/state"; echo starting >"$S/health"; touch "$S/bad_0.2.0"; later 60; tick
  check "docker: the first look after that adds nothing" test "$(counted)" = 540 -a "$(rollbacks)" = 0
  later 60; tick
  check "docker: a container that runs and does not answer counts, and the three make the 10 minutes" test "$(rollbacks)" = 1
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
