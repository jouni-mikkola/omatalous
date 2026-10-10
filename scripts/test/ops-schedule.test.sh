#!/usr/bin/env bash
# Tests for scripts/lib/ops-schedule.sh (the timer or cron line of the maintenance helper) with stub
# systemctl, loginctl and crontab. Nothing touches the real user manager or crontab.
#
#   scripts/test/ops-schedule.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=$(cd "$HERE/.." && pwd)/lib/ops-schedule.sh
PASS=0; FAILED=0
check() { local n=$1; shift; if "$@"; then PASS=$((PASS + 1)); echo "ok   $n"; else FAILED=$((FAILED + 1)); echo "FAIL $n"; fi; }

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/home" "$T/clone-a" "$T/clone-b"
cat >"$T/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
[[ -e $STUB/nosystemd ]] && exit 1
args=" $* "
case $args in
  *" show-environment "*) exit 0 ;;
  *" enable --now "*) [[ -e $STUB/enablefail ]] && exit 1; touch "$STUB/enabled-${@: -1}"; exit 0 ;;
  *" disable --now "*) rm -f "$STUB/enabled-${@: -1}"; exit 0 ;;
esac
exit 0
EOF
cat >"$T/bin/loginctl" <<'EOF'
#!/usr/bin/env bash
case $* in
  *enable-linger*) [[ -e $STUB/lingerfail ]] && exit 1; touch "$STUB/linger"; exit 0 ;;
  *show-user*) if [[ -e $STUB/linger ]]; then echo yes; else echo no; fi ;;
esac
EOF
cat >"$T/bin/crontab" <<'EOF'
#!/usr/bin/env bash
[[ -e $STUB/nocron ]] && exit 127
case ${1:-} in
  -l) [[ -f $STUB/crontab ]] && cat "$STUB/crontab" || { echo "no crontab" >&2; exit 1; } ;;
  -r) rm -f "$STUB/crontab" ;;
  -) cat >"$STUB/crontab" ;;
esac
EOF
chmod +x "$T"/bin/*
export STUB=$T HOME=$T/home XDG_CONFIG_HOME=$T/home/.config
export PATH=$T/bin:$PATH
# shellcheck source=../lib/ops-schedule.sh
. "$LIB"
reset() { rm -f "$T"/{nosystemd,enablefail,lingerfail,linger,nocron,crontab} "$T"/enabled-*; rm -rf "$T/home/.config"; }
units() { ls "$T/home/.config/systemd/user" 2>/dev/null | wc -l; }
lines() { grep -c 'talous-ops:' "$T/crontab" 2>/dev/null || true; }

# systemd, linger on
reset; touch "$T/linger"
ops_scheduler_install banking "$T/clone-a"; rc=$?
check "systemd: installed with a timer" test "$rc" = 0 -a "$OPS_KIND" = systemd -a -e "$T/enabled-talous-ops-banking.timer"
check "systemd: one unit pair" test "$(units)" = 2
check "systemd: unit runs the clone's helper, hardened" grep -q "ExecStart=$T/clone-a/scripts/ops-helper.sh" "$T/home/.config/systemd/user/talous-ops-banking.service"
check "systemd: NoNewPrivileges and UMask set" bash -c "grep -q NoNewPrivileges=yes '$T/home/.config/systemd/user/talous-ops-banking.service' && grep -q UMask=0077 '$T/home/.config/systemd/user/talous-ops-banking.service'"
ops_scheduler_install banking "$T/clone-a"
check "systemd: a re-run does not add units" test "$(units)" = 2
ops_scheduler_install banking-2 "$T/clone-b"
check "systemd: a second instance gets its own pair" test "$(units)" = 4
ops_scheduler_remove banking
check "systemd: remove takes only this instance" bash -c "[[ \$(ls '$T/home/.config/systemd/user' | grep -c banking-2) = 2 && \$(ls '$T/home/.config/systemd/user' | grep -vc banking-2) = 0 ]]"
ops_scheduler_remove banking-2
check "systemd: all gone" test "$(units)" = 0

# linger off and cannot be switched on: cron
reset; touch "$T/lingerfail"
ops_scheduler_install banking "$T/clone-a"; rc=$?
check "no linger: falls back to cron" test "$rc" = 0 -a "$OPS_KIND" = cron
check "cron: one line with the marker and no stray unit files" bash -c "[[ \$(grep -c 'talous-ops:banking\$' '$T/crontab') = 1 ]] && [[ $(units) = 0 ]]"
ops_scheduler_install banking "$T/clone-a"
check "cron: a re-run keeps one line" test "$(lines)" = 1
echo '0 3 * * * something-else' >>"$T/crontab"
ops_scheduler_install banking-2 "$T/clone-b"
check "cron: a second instance adds its own line, other lines stay" bash -c "[[ \$(grep -c 'talous-ops:' '$T/crontab') = 2 ]] && grep -q something-else '$T/crontab'"
ops_scheduler_remove banking
check "cron: removing banking leaves banking-2 (no prefix match)" bash -c "grep -q 'talous-ops:banking-2\$' '$T/crontab' && ! grep -q 'talous-ops:banking\$' '$T/crontab' && grep -q something-else '$T/crontab'"
ops_scheduler_remove banking-2; ops_scheduler_remove banking-2
check "cron: repeated remove is fine, foreign line kept" bash -c "[[ \$(grep -c . '$T/crontab') = 1 ]] && grep -q something-else '$T/crontab'"

# systemd that cannot enable the timer: cron, no leftovers
reset; touch "$T/linger" "$T/enablefail"
ops_scheduler_install banking "$T/clone-a"
check "timer refused by systemd: cron, unit files removed" bash -c "[[ $OPS_KIND = cron && \$(ls '$T/home/.config/systemd/user' 2>/dev/null | wc -l) = 0 ]]"

# nothing available
reset; touch "$T/nosystemd" "$T/nocron"
ops_scheduler_install banking "$T/clone-a"; rc=$?
check "no systemd and no cron: says so, returns 1" test "$rc" = 1 -a "$OPS_KIND" = none -a -n "$OPS_NOTE"

# paths the scheduler cannot carry
reset; touch "$T/linger"
ops_scheduler_install banking "/tmp/with space/x"; rc=$?
check "unsafe path refused" test "$rc" = 1 -a "$OPS_KIND" = none
ops_scheduler_install banking '/tmp/x$(id)'; rc=$?
check "path with shell characters refused" test "$rc" = 1

# the code path has no sudo
check "no sudo in the scheduling code" bash -c "! grep -vE '^[[:space:]]*#' '$LIB' | grep -q sudo"

echo; echo "$PASS passed, $FAILED failed"
((FAILED == 0))
