#!/usr/bin/env bash
# Tests for the installer's maintenance helper setup (./scripts/install.sh --ops-helper and scripts/lib/ops-schedule.sh)
# on a fake host: the permissions the helper's own check wants, and the choice between a systemd timer and cron when
# the user's systemd manager started before the user joined the docker group. See tools/test/fake-host.sh.
#
#   tools/test/install.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
# shellcheck source=fake-host.sh
. "$HERE/fake-host.sh"
unprivileged install.test.sh "$FILTER"
host_init
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

install_helper() { in_clone ./scripts/install.sh --ops-helper >"$W/install.out" 2>&1; INSTALL_RC=$?; }
out() { cat "$W/install.out"; }
# one tick of the real helper with a docker that does not answer: it gets past its permission check or says why not
tick() { in_clone env OPS_TEST=1 ./scripts/ops-helper.sh >"$W/tick.out" 2>&1; }
units() { ls "$W/home/.config/systemd/user" 2>/dev/null | wc -l; }
cron_lines() { grep -c 'talous-ops:banking-app$' "$S/crontab" 2>/dev/null || true; }
# the words and the kind the scheduling leaves for the installer's last line, from the lib itself
label() { in_clone bash -c ". scripts/lib/ops-schedule.sh; ops_scheduler_install banking-app \"\$PWD\"; echo \"\$OPS_KIND|\$OPS_LABEL|\$OPS_TODO\""; }
RESTART="sudo systemctl restart user@$(id -u).service"

t_group_writable_git() {
  new_host; cron_on
  mkdir -p "$CL/backups"; echo "SCHEMA_CHANGED=no" >"$CL/backups/.last-update"; chmod 664 "$CL/backups/.last-update"
  chmod 775 "$CL/.git/hooks"; printf '#!/bin/sh\n' >"$CL/.git/hooks/post-merge"; chmod 775 "$CL/.git/hooks/post-merge"
  check "world: git under umask 002 leaves .git and .git/config group writable" bash -c "$(declare -f writable_by_others); CL='$CL'; writable_by_others .git && writable_by_others .git/config"
  tick
  check "world: the helper refuses that clone before the installer ran" grep -q "File permissions: .* is not safe" "$W/tick.out"
  install_helper
  check "ops-helper: the installer succeeds" test "$INSTALL_RC" = 0
  check ".git, its config and everything under it lose group and other write" bash -c "$(declare -f writable_by_others); CL='$CL'; ! writable_by_others .git && ! writable_by_others .git/config && ! writable_by_others .git/hooks && ! writable_by_others .git/hooks/post-merge && ! writable_by_others .git/objects"
  check "the clone, scripts and scripts/lib lose it too" bash -c "$(declare -f writable_by_others); CL='$CL'; ! writable_by_others . && ! writable_by_others scripts && ! writable_by_others scripts/lib && ! writable_by_others scripts/ops-helper.sh && ! writable_by_others scripts/lib/ops-schedule.sh"
  check "backups/.last-update loses it as well" bash -c "$(declare -f writable_by_others); CL='$CL'; ! writable_by_others backups/.last-update"
  tick
  check "the helper's own check now passes (it goes on to Docker)" grep -q "Docker does not respond" "$CL/ops/helper.log"
  check "the helper logs no permission refusal" bash -c "! grep -q 'File permissions' '$CL/ops/helper.log' '$W/tick.out'"
  check "nothing to warn about when the fix worked" bash -c "! grep -q 'refuses to run while' '$W/install.out'"
}
t_path_of_another_user() {
  # a script that belongs to root: chmod cannot fix that, so the installer says what to do
  new_host; cron_on; echo scripts/backup.sh >"$S/foreign"
  install_helper
  check "a checked path owned by someone else: the installer still succeeds" test "$INSTALL_RC" = 0
  check "it names the path and the command that fixes it" bash -c "grep -q 'refuses to run while these are owned by someone else or writable by others: .*scripts/backup.sh' '$W/install.out' && grep -q 'sudo chown -R .* \\.   and then: ./scripts/install.sh --ops-helper' '$W/install.out'"
  check "the paths it could fix are fixed" bash -c "$(declare -f writable_by_others); CL='$CL'; ! writable_by_others .git && ! writable_by_others scripts"
}
t_paths_match_the_helper() {
  # the helper tests these paths (check_permissions); the installer must take write access from the same ones
  local helper lib
  helper=$(sed -n 's/^  for p in \(.*\); do$/\1/p' "$SRC/scripts/ops-helper.sh" | head -n 1 | tr ' ' '\n' | sed 's/"\$SELF"//; s/"\$OPS"/ops/; s/"\$OPS\/\([a-z]*\)"/ops\/\1/' | grep . | sort -u | tr '\n' ' ')
  lib=$(sed -n 's/^  for p in \(.*\); do$/\1/p' "$SRC/scripts/lib/ops-schedule.sh" | head -n 1 | tr ' ' '\n' | grep . | sort -u | tr '\n' ' ')
  check "ops_checked_paths lists the paths check_permissions tests in ops-helper.sh" test -n "$helper" -a "$helper" = "$lib"
}
t_user_manager_without_docker_group_cron() {
  new_host; touch "$S/systemd"; cron_on; gid_manager_lacks
  install_helper
  check "no docker group in the manager, cron present: a cron line, no timer" bash -c "[[ $INSTALL_RC = 0 && \$(grep -c 'talous-ops:banking-app\$' '$S/crontab') = 1 && ! -e '$S/timer-enabled' && \$(ls '$W/home/.config/systemd/user' 2>/dev/null | wc -l) = 0 ]]"
  check "the installer says it is cron and why" bash -c "grep -q 'Maintenance helper on: cron' '$W/install.out' && grep -q 'docker group' '$W/install.out'"
  check "the last line's words name cron and the docker group" test "$(label)" = "cron|on (cron, because the systemd user manager does not have the docker group yet)|"
  gid_shared; touch "$S/systemd"
  install_helper
  check "after the manager restarted the next run moves to the timer and drops the cron line" bash -c "[[ -e '$S/timer-enabled' ]] && ! grep -q 'talous-ops:' '$S/crontab' 2>/dev/null"
}
t_user_manager_without_docker_group_no_cron() {
  new_host; touch "$S/systemd"; cron_off; gid_manager_lacks
  install_helper
  check "no docker group in the manager and no cron: the timer is set and the installer does not fail" bash -c "[[ $INSTALL_RC = 0 && -e '$S/timer-enabled' ]]"
  check "the installer says in one line how to make it work" bash -c "[[ \$(grep -c 'sudo systemctl restart user@' '$W/install.out') = 1 ]] && grep -q 'sudo systemctl restart user@$(id -u).service   or reboot' '$W/install.out'"
  check "it does not claim the helper is on" bash -c "! grep -q 'Maintenance helper on' '$W/install.out'"
  check "the last line's words give the command" test "$(label)" = "systemd|not working yet, run: $RESTART   or reboot (the systemd user manager does not have the docker group)|The systemd timer is set but cannot reach Docker yet: the user manager started before this user joined the docker group. Run: $RESTART   or reboot."
}
t_user_manager_with_docker_group() {
  new_host; touch "$S/systemd"; cron_on; gid_shared
  install_helper
  check "the manager has the docker group: a timer, no cron line" bash -c "[[ $INSTALL_RC = 0 && -e '$S/timer-enabled' && ! -e '$S/crontab' ]]"
  check "the installer says it is a timer and has no restart advice" bash -c "grep -q 'Maintenance helper on: systemd timer' '$W/install.out' && ! grep -q 'systemctl restart' '$W/install.out'"
  check "the last line's words say timer" test "$(label)" = "systemd|on (systemd timer)|"
}
t_shell_without_docker_group() {
  # rootless Docker, or a socket anyone can use: the shell has no docker group, so the manager needs none
  new_host; touch "$S/systemd"; cron_on; gid_shell_lacks
  install_helper
  check "a shell without the docker group does not move the helper to cron" bash -c "[[ $INSTALL_RC = 0 && -e '$S/timer-enabled' && ! -e '$S/crontab' ]]"
  new_host; touch "$S/systemd"; cron_on
  install_helper
  check "no docker group on the host at all: a timer" bash -c "[[ $INSTALL_RC = 0 && -e '$S/timer-enabled' ]]"
  new_host; touch "$S/systemd"; cron_on; gid_manager_lacks; rm -f "$S/manager-pid"
  install_helper
  check "a manager whose groups cannot be read counts as fine" bash -c "[[ $INSTALL_RC = 0 && -e '$S/timer-enabled' ]]"
}
t_without_systemd() {
  new_host; cron_on
  install_helper
  check "no systemd user manager: cron as before, no remark about the docker group" bash -c "[[ $INSTALL_RC = 0 && \$(grep -c 'talous-ops:banking-app\$' '$S/crontab') = 1 ]] && ! grep -q 'docker group' '$W/install.out'"
  new_host; cron_off
  install_helper
  check "neither systemd nor cron: says so and fails" bash -c "[[ $INSTALL_RC = 1 ]] && grep -q 'Could not set up scheduling' '$W/install.out'"
}
t_summary_line() {
  # a full install needs Docker, so this reads the script: its last line prints the words the scheduling left and the
  # installer does not choose them again
  check "the full install's last line about the helper prints the words the scheduling left" bash -c "[[ \$(grep -c 'Maintenance helper: \$OPS_LABEL' '$SRC/scripts/install.sh') = 2 ]] && ! grep -q 'systemd) OPS_LABEL=' '$SRC/scripts/install.sh'"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
