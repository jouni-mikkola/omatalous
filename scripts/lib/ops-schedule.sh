# Scheduling of the maintenance helper (scripts/ops-helper.sh), sourced by install.sh and reset.sh.
# One timer or one crontab line per instance, named after INSTANCE_NAME, so clones do not collide.
# No sudo here: a systemd user timer is used only when the user's services already run without a login
# (linger) or it can be switched on without root, and when the user's systemd manager has the docker group
# (see ops_manager_lacks_docker), else cron, which needs neither.
# shellcheck shell=bash disable=SC2034

ops_unit() { printf 'talous-ops-%s' "$1"; }
ops_cron_marker() { printf '# talous-ops:%s' "$1"; }
ops_unit_dir() { printf '%s/systemd/user' "${XDG_CONFIG_HOME:-$HOME/.config}"; }

ops_systemd_ok() { command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; }
ops_linger() { # prints yes, no or unknown
  command -v loginctl >/dev/null 2>&1 || { echo unknown; return; }
  local v; v=$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)
  echo "${v:-unknown}"
}
ops_cron_ok() { command -v crontab >/dev/null 2>&1; }

# the crontab without this instance's line (an exact match on the marker at the end of the line)
ops_cron_without() {
  local marker; marker=$(ops_cron_marker "$1")
  crontab -l 2>/dev/null | awk -v m="$marker" '{ n = length($0) - length(m); if (n >= 0 && substr($0, n + 1) == m) next; print }'
}

# True when this instance has a timer or a crontab line (the helper is on).
ops_scheduler_present() { # ops_scheduler_present INSTANCE
  local unit dir; unit=$(ops_unit "$1"); dir=$(ops_unit_dir)
  [[ -f $dir/$unit.timer ]] && return 0
  ops_cron_ok && crontab -l 2>/dev/null | grep -qF "$(ops_cron_marker "$1")"
}

# Removes this instance's timer and crontab line, and nothing of any other instance. Safe to repeat.
# With "keep-running" a tick that is running right now is left alone: the helper renews itself from inside
# a tick (the helper-renew action), and stopping the service would kill that run before it reports.
ops_scheduler_remove() { # ops_scheduler_remove INSTANCE [keep-running]
  local inst=$1 unit dir rest
  unit=$(ops_unit "$inst"); dir=$(ops_unit_dir)
  if [[ -f $dir/$unit.timer || -f $dir/$unit.service ]]; then
    if ops_systemd_ok; then
      systemctl --user disable --now "$unit.timer" >/dev/null 2>&1 || true
      [[ ${2:-} == keep-running ]] || systemctl --user stop "$unit.service" >/dev/null 2>&1 || true
    fi
    rm -f "$dir/$unit.timer" "$dir/$unit.service"
    ops_systemd_ok && systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  if ops_cron_ok && crontab -l 2>/dev/null | grep -qF "$(ops_cron_marker "$inst")"; then
    rest=$(ops_cron_without "$inst")
    if [[ -n $rest ]]; then printf '%s\n' "$rest" | crontab - ; else crontab -r 2>/dev/null || true; fi
  fi
}

# The paths ops-helper.sh (check_permissions) refuses to run on when someone else owns them or group or others can
# write to them, relative to the clone (the caller is in it) and only the ones that exist. tools/test/install.test.sh
# compares this list with the helper's: a path added there goes here too.
ops_checked_paths() {
  local p
  for p in . .git .git/config scripts scripts/*.sh scripts/lib scripts/lib/*.sh ops .env ops/policy ops/journal ops/run backups/.last-update; do
    [[ -e $p ]] && printf '%s\n' "$p"
  done
  return 0
}

# The checked paths the helper would refuse now (its own test: not owned by this user, or group or others can write).
ops_unsafe_paths() {
  local p o m uid; uid=$(id -u)
  while IFS= read -r p; do
    read -r o m < <(stat -c '%u %a' "$p" 2>/dev/null) || { printf '%s\n' "$p"; continue; }
    if [[ $o != "$uid" ]] || (((8#$m & 8#022) != 0)); then printf '%s\n' "$p"; fi
  done < <(ops_checked_paths)
}

# Takes group and other write away from the checked paths and from everything under .git (git runs hooks in the
# update). Ubuntu's umask 002 makes them group writable. A path another user owns stays as it is: ops_unsafe_paths.
ops_fix_permissions() {
  local p
  chmod -R go-w .git 2>/dev/null || true
  while IFS= read -r p; do chmod go-w "$p" 2>/dev/null || true; done < <(ops_checked_paths)
}

# True when this shell has the docker group and the user's systemd manager does not. The manager started before
# `usermod -aG docker` and keeps its old groups until it restarts, so every service it runs, the helper's timer
# too, gets "permission denied" from Docker. False when that cannot be told: no docker group, a shell without it
# (rootless Docker), no manager or no way to read its groups.
ops_manager_lacks_docker() {
  local gid pid st
  gid=$(getent group docker 2>/dev/null | cut -d: -f3 || true)
  [[ $gid =~ ^[0-9]+$ && " $(id -G) " == *" $gid "* ]] || return 1
  pid=$(systemctl show -p MainPID --value "user@$(id -u).service" 2>/dev/null || true)
  [[ $pid =~ ^[1-9][0-9]*$ ]] && st=$(cat "/proc/$pid/status" 2>/dev/null) || return 1
  # the Gid line holds the real, effective, saved and file system group, the Groups line the others
  awk -v g="$gid" '/^(Gid|Groups):/ { for (i = 2; i <= NF; i++) if ($i == g) f = 1 } END { exit !f }' <<<"$st" && return 1
  return 0
}

# The systemd user timer. Returns 0 with OPS_KIND, OPS_NOTE and OPS_LABEL set, else 1 and no unit file left.
ops_install_timer() { # ops_install_timer INSTANCE ROOT
  local inst=$1 root=$2 unit dir linger
  unit=$(ops_unit "$inst"); dir=$(ops_unit_dir)
  ops_systemd_ok || return 1
  linger=$(ops_linger)
  if [[ $linger != yes ]] && command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || true
    linger=$(ops_linger)
  fi
  [[ $linger == yes ]] || return 1
  mkdir -p "$dir"
  cat >"$dir/$unit.service" <<UNIT
[Unit]
Description=Omatalous maintenance helper ($inst)

[Service]
Type=oneshot
WorkingDirectory=$root
ExecStart=$root/scripts/ops-helper.sh
TimeoutStartSec=3600
NoNewPrivileges=yes
PrivateTmp=yes
UMask=0077
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UNIT
  cat >"$dir/$unit.timer" <<UNIT
[Unit]
Description=Omatalous maintenance helper ($inst), every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
UNIT
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  if systemctl --user enable --now "$unit.timer" >/dev/null 2>&1; then
    OPS_KIND=systemd; OPS_NOTE="systemd timer $unit.timer"; OPS_LABEL="on (systemd timer)"
    return 0
  fi
  rm -f "$dir/$unit.timer" "$dir/$unit.service"
  return 1
}

# The crontab line. Returns 0 with OPS_KIND, OPS_NOTE and OPS_LABEL set, else 1.
ops_install_cron() { # ops_install_cron INSTANCE ROOT
  local inst=$1 root=$2 rest
  ops_cron_ok || return 1
  rest=$(ops_cron_without "$inst")
  {
    [[ -z $rest ]] || printf '%s\n' "$rest"
    printf '* * * * * cd %s && ./scripts/ops-helper.sh >/dev/null 2>&1 %s\n' "$root" "$(ops_cron_marker "$inst")"
  } | crontab - || return 1
  OPS_KIND=cron; OPS_NOTE="cron (line $(ops_cron_marker "$inst"))"; OPS_LABEL="on (cron)"
}

# Sets OPS_KIND to systemd, cron or none, OPS_NOTE to a line for the user, OPS_LABEL to the words for the installer's
# last line, OPS_TODO to what the user still has to do before the helper works (empty when nothing) and OPS_WHY to
# docker-group when the choice or the todo comes from the user's systemd manager lacking the docker group.
# Returns 1 for none.
ops_scheduler_install() { # ops_scheduler_install INSTANCE ROOT
  local inst=$1 root=$2 nodocker=false
  OPS_KIND=none; OPS_NOTE=""; OPS_LABEL=off; OPS_TODO=""; OPS_WHY=""
  # the path goes into a unit file and a crontab line: only plain characters
  if [[ ! $root =~ ^/[A-Za-z0-9_./-]+$ ]]; then
    OPS_NOTE="The folder path has characters the scheduler does not allow ($root). Move the install to a path without spaces and special characters."
    return 1
  fi
  ops_scheduler_remove "$inst" keep-running
  # Cron reads the groups at every run, so with a manager that lacks the docker group cron goes first. Without cron
  # the timer is set anyway and the user is told what makes it work.
  if ops_systemd_ok && ops_manager_lacks_docker; then nodocker=true; fi
  if $nodocker; then
    ops_install_cron "$inst" "$root" || ops_install_timer "$inst" "$root" || true
  else
    ops_install_timer "$inst" "$root" || ops_install_cron "$inst" "$root" || true
  fi
  if [[ $OPS_KIND == none ]]; then
    OPS_NOTE="Could not set up scheduling (no systemd user service and no crontab). Run the helper yourself every minute: cd $root && ./scripts/ops-helper.sh"
    return 1
  fi
  $nodocker || return 0
  OPS_WHY=docker-group
  if [[ $OPS_KIND == cron ]]; then
    OPS_NOTE="$OPS_NOTE, because the systemd user manager started before this user joined the docker group and a timer would not reach Docker"
    OPS_LABEL="on (cron, because the systemd user manager does not have the docker group yet)"
  else
    OPS_TODO="The systemd timer is set but cannot reach Docker yet: the user manager started before this user joined the docker group. Run: sudo systemctl restart user@$(id -u).service   or reboot."
    OPS_LABEL="not working yet, run: sudo systemctl restart user@$(id -u).service   or reboot (the systemd user manager does not have the docker group)"
  fi
  return 0
}
