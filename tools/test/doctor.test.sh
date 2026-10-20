#!/usr/bin/env bash
# Tests for the maintenance helper checks of scripts/doctor.sh on a fake host: the permissions the helper's own check
# wants, and a systemd user manager without the docker group. The terminal gets English, --json gets Finnish.
# See tools/test/fake-host.sh.
#
#   tools/test/doctor.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by fake-host.sh
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
# shellcheck source=fake-host.sh
. "$HERE/fake-host.sh"
unprivileged doctor.test.sh "$FILTER"
host_init
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

doctor_json() { in_clone ./scripts/doctor.sh --json 2>&1 | tr '{' '\n' >"$W/doctor.json"; }
doctor_text() { in_clone ./scripts/doctor.sh >"$W/doctor.txt" 2>&1; }
# the helper is on, as the installer would leave it
with_cron() { cron_on; printf '* * * * * cd %s && ./scripts/ops-helper.sh >/dev/null 2>&1 # talous-ops:banking-app\n' "$CL" >"$S/crontab"; }
with_timer() { touch "$S/systemd" "$S/timer-enabled"; }
fix_permissions() { in_clone ./scripts/install.sh --ops-helper >/dev/null 2>&1; }
RESTART="sudo systemctl restart user@$(id -u).service"

t_group_writable_clone() {
  new_host; with_cron
  doctor_json; doctor_text
  check "json: a group writable clone is a Finnish warning naming the first path and the rest" grep -Eq '"level":"warn","title":"Apuri ei käynnisty: tiedostojen oikeudet eivät kelpaa \(\., ja [0-9]+ muuta\)\."' "$W/doctor.json"
  check "json: the hint explains and gives the installer command" grep -q '"title":"Apuri ei käynnisty.*"hint":"Muut voivat kirjoittaa niihin tai ne ovat jonkun muun\. Aja: \./scripts/install\.sh --ops-helper"' "$W/doctor.json"
  check "text: the same warning in English" grep -Eq 'The helper does not run: file permissions are not safe \(\., and [0-9]+ more\)\.' "$W/doctor.txt"
  check "text: with the fix underneath" bash -c "grep -A1 'The helper does not run' '$W/doctor.txt' | grep 'Run: ./scripts/install.sh --ops-helper' >/dev/null"
  fix_permissions
  doctor_json
  check "json: no such warning once the installer took the write access away" bash -c "! grep -q 'Apuri ei käynnisty' '$W/doctor.json'"
  check "json: the helper counts as scheduled" grep -q '"level":"ok","title":"Ylläpitoapuri ajastettu (cron)"' "$W/doctor.json"
}
t_path_of_another_user() {
  new_host; with_cron; fix_permissions; echo scripts/backup.sh >"$S/foreign"
  doctor_json
  check "json: a path owned by someone else gets the chown command before the installer's" grep -Eq "\"hint\":\"Muut voivat kirjoittaa niihin tai ne ovat jonkun muun\\. Aja: sudo chown -R [a-z0-9_]+ \\.   ja sitten: \\./scripts/install\\.sh --ops-helper\"" "$W/doctor.json"
}
t_only_when_the_helper_is_on() {
  new_host; cron_off
  doctor_json
  check "a clone with no helper scheduled gets no permission warning, only the missing helper" bash -c "! grep -q 'Apuri ei käynnisty' '$W/doctor.json' && grep -q 'Ylläpitoapuri ei ole käytössä' '$W/doctor.json'"
}
t_user_manager_without_docker_group() {
  new_host; with_timer; gid_manager_lacks; fix_permissions
  doctor_json; doctor_text
  check "json: a manager without the docker group is a Finnish warning with the command" grep -q "\"level\":\"warn\",\"title\":\"Käyttäjän systemd käynnistyi ennen kuin käyttäjä liitettiin docker-ryhmään.*\"hint\":\"$RESTART   tai käynnistä kone uudelleen\"" "$W/doctor.json"
  check "text: the same in English" grep -q "The systemd user manager started before this user joined the docker group" "$W/doctor.txt"
  check "text: the command to run" grep -q "$RESTART   or reboot the machine" "$W/doctor.txt"
  gid_shared
  doctor_json
  check "json: no warning when the manager has the group" bash -c "! grep -q 'docker-ryhmään' '$W/doctor.json'"
  gid_shell_lacks
  doctor_json
  check "json: none for a shell without the docker group either" bash -c "! grep -q 'docker-ryhmään' '$W/doctor.json'"
  new_host; with_cron; gid_manager_lacks; fix_permissions
  doctor_json
  check "json: cron does not need the manager's group, so no warning" bash -c "! grep -q 'docker-ryhmään' '$W/doctor.json'"
}
t_old_refusal_in_the_log() {
  new_host; with_cron; fix_permissions
  printf '2026-01-01T10:00:00Z File permissions: .git is not safe (owner or write access). The helper does not run.\n' >"$CL/ops/helper.log"
  doctor_json
  check "a refusal and no tick since: the log line is a warning" grep -q 'Apuri kieltäytyy toimimasta' "$W/doctor.json"
  echo 2026-01-02T10:00:00Z >"$CL/ops/helper-seen"
  doctor_json
  check "a tick passed after the refusal: the old line is not a warning" bash -c "! grep -q 'Apuri kieltäytyy toimimasta' '$W/doctor.json'"
  printf '2026-01-03T10:00:00Z .env is invalid: bad line. The helper does not run until it is fixed.\n' >>"$CL/ops/helper.log"
  doctor_json
  check "a newer refusal of another kind is a warning again" grep -q 'Apuri kieltäytyy toimimasta' "$W/doctor.json"
  new_host; with_cron
  mkdir -p "$CL/ops"
  printf '2026-01-01T10:00:00Z File permissions: .git is not safe (owner or write access). The helper does not run.\n' >"$CL/ops/helper.log"
  doctor_json
  check "the permission warning is not said twice when the paths are unsafe now" bash -c "grep -q 'Apuri ei käynnisty' '$W/doctor.json' && ! grep -q 'Apuri kieltäytyy toimimasta' '$W/doctor.json'"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
