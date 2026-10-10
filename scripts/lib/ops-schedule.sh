# Scheduling of the maintenance helper (scripts/ops-helper.sh), sourced by install.sh and reset.sh.
# One timer or one crontab line per instance, named after INSTANCE_NAME, so clones do not collide.
# No sudo here: a systemd user timer is used only when the user's services already run without a login
# (linger) or it can be switched on without root, else cron, which needs neither.
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

# Removes this instance's timer and crontab line, and nothing of any other instance. Safe to repeat.
ops_scheduler_remove() { # ops_scheduler_remove INSTANCE
  local inst=$1 unit dir rest
  unit=$(ops_unit "$inst"); dir=$(ops_unit_dir)
  if [[ -f $dir/$unit.timer || -f $dir/$unit.service ]]; then
    if ops_systemd_ok; then
      systemctl --user disable --now "$unit.timer" >/dev/null 2>&1 || true
      systemctl --user stop "$unit.service" >/dev/null 2>&1 || true
    fi
    rm -f "$dir/$unit.timer" "$dir/$unit.service"
    ops_systemd_ok && systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  if ops_cron_ok && crontab -l 2>/dev/null | grep -qF "$(ops_cron_marker "$inst")"; then
    rest=$(ops_cron_without "$inst")
    if [[ -n $rest ]]; then printf '%s\n' "$rest" | crontab - ; else crontab -r 2>/dev/null || true; fi
  fi
}

# Sets OPS_KIND to systemd, cron or none and OPS_NOTE to a Finnish line for the user. Returns 1 for none.
ops_scheduler_install() { # ops_scheduler_install INSTANCE ROOT
  local inst=$1 root=$2 unit dir rest
  OPS_KIND=none; OPS_NOTE=""
  unit=$(ops_unit "$inst"); dir=$(ops_unit_dir)
  # the path goes into a unit file and a crontab line: only plain characters
  if [[ ! $root =~ ^/[A-Za-z0-9_./-]+$ ]]; then
    OPS_NOTE="Kansion polussa on merkkejä, joita ajastus ei salli ($root). Siirrä asennus polulle ilman välilyöntejä ja erikoismerkkejä."
    return 1
  fi
  ops_scheduler_remove "$inst"
  if ops_systemd_ok; then
    local linger; linger=$(ops_linger)
    if [[ $linger != yes ]] && command -v loginctl >/dev/null 2>&1; then
      loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || true
      linger=$(ops_linger)
    fi
    if [[ $linger == yes ]]; then
      mkdir -p "$dir"
      cat >"$dir/$unit.service" <<UNIT
[Unit]
Description=Omatalous ylläpitoapuri ($inst)

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
Description=Omatalous ylläpitoapuri ($inst), joka minuutti

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
UNIT
      systemctl --user daemon-reload >/dev/null 2>&1 || true
      if systemctl --user enable --now "$unit.timer" >/dev/null 2>&1; then
        OPS_KIND=systemd; OPS_NOTE="systemd-ajastin $unit.timer"
        return 0
      fi
      rm -f "$dir/$unit.timer" "$dir/$unit.service"
    fi
  fi
  if ops_cron_ok; then
    rest=$(ops_cron_without "$inst")
    {
      [[ -z $rest ]] || printf '%s\n' "$rest"
      printf '* * * * * cd %s && ./scripts/ops-helper.sh >/dev/null 2>&1 %s\n' "$root" "$(ops_cron_marker "$inst")"
    } | crontab - && { OPS_KIND=cron; OPS_NOTE="cron (rivi $(ops_cron_marker "$inst"))"; return 0; }
  fi
  OPS_NOTE="Ajastusta ei saatu käyttöön (ei systemd-käyttäjäpalvelua eikä crontabia). Aja apuri itse minuutin välein: cd $root && ./scripts/ops-helper.sh"
  return 1
}
