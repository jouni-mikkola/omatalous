#!/usr/bin/env bash
# Tests for scripts/lib/ops-schedule.sh (the timer or cron line of the maintenance helper) with stub
# systemctl, loginctl and crontab. Nothing touches the real user manager or crontab.
#
#   tools/test/ops-schedule.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=$(cd "$HERE/../../scripts" && pwd)/lib/ops-schedule.sh
PASS=0; FAILED=0
check() { local n=$1; shift; if "$@"; then PASS=$((PASS + 1)); echo "ok   $n"; else FAILED=$((FAILED + 1)); echo "FAIL $n"; fi; }

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/home" "$T/clone-a/scripts" "$T/clone-b/scripts" "$T/clone-c"
# clone-a and clone-b have the launcher, clone-c is a clone from before it
cp "$HERE/../../scripts/ops-launcher.sh" "$T/clone-a/scripts/"; cp "$HERE/../../scripts/ops-launcher.sh" "$T/clone-b/scripts/"
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
unset XDG_DATA_HOME
LD=$T/home/.local/share/omatalous
# shellcheck source=../lib/ops-schedule.sh
. "$LIB"
reset() { rm -f "$T"/{nosystemd,enablefail,lingerfail,linger,nocron,crontab} "$T"/enabled-*; rm -rf "$T/home/.config" "$T/home/.local"; }
units() { ls "$T/home/.config/systemd/user" 2>/dev/null | wc -l; }
not() { ! "$@"; }
lines() { grep -c 'talous-ops:' "$T/crontab" 2>/dev/null || true; }

# systemd, linger on
reset; touch "$T/linger"
ops_scheduler_install banking "$T/clone-a"; rc=$?
check "systemd: installed with a timer" test "$rc" = 0 -a "$OPS_KIND" = systemd -a -e "$T/enabled-talous-ops-banking.timer"
check "systemd: one unit pair" test "$(units)" = 2
check "systemd: the unit runs the launcher with the clone" grep -qxF "ExecStart=$LD/banking/launcher.sh $T/clone-a" "$T/home/.config/systemd/user/talous-ops-banking.service"
check "systemd: the launcher is in its own folder, both mode 700" test "$(stat -c %a "$LD/banking")" = 700 -a "$(stat -c %a "$LD/banking/launcher.sh")" = 700 -a "$OPS_LAUNCHER" = "$LD/banking/launcher.sh"
check "systemd: the launcher is the clone's file" cmp -s "$T/clone-a/scripts/ops-launcher.sh" "$LD/banking/launcher.sh"
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
check "cron: the line runs the launcher with the clone" grep -qxF "* * * * * $LD/banking/launcher.sh $T/clone-a >/dev/null 2>&1 # talous-ops:banking" "$T/crontab"
check "cron: the schedule is seen to run the launcher" test "$(ops_scheduled_launcher banking)" = "$LD/banking/launcher.sh"
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

# an install from before the launcher: its unit ran the clone's helper itself, and a re-run writes it again
reset; touch "$T/linger"; U=$T/home/.config/systemd/user; mkdir -p "$U"
printf '[Service]\nType=oneshot\nWorkingDirectory=%s\nExecStart=%s/scripts/ops-helper.sh\n' "$T/clone-a" "$T/clone-a" >"$U/talous-ops-banking.service"
printf '[Timer]\nOnUnitActiveSec=1min\n' >"$U/talous-ops-banking.timer"
check "old unit: seen as not running the launcher" not ops_scheduled_launcher banking
ops_scheduler_install banking "$T/clone-a"
check "old unit: rewritten to run the launcher" bash -c "grep -qxF 'ExecStart=$LD/banking/launcher.sh $T/clone-a' '$U/talous-ops-banking.service' && ! grep -q 'ops-helper.sh' '$U/talous-ops-banking.service' && [[ $(units) = 2 ]]"
check "old unit: now seen to run the launcher" test "$(ops_scheduled_launcher banking)" = "$LD/banking/launcher.sh"
reset; touch "$T/lingerfail"
printf '* * * * * cd %s && ./scripts/ops-helper.sh >/dev/null 2>&1 # talous-ops:banking\n' "$T/clone-a" >"$T/crontab"
ops_scheduler_install banking "$T/clone-a"
check "old cron line: rewritten to run the launcher" bash -c "[[ $(lines) = 1 ]] && grep -qxF '* * * * * $LD/banking/launcher.sh $T/clone-a >/dev/null 2>&1 # talous-ops:banking' '$T/crontab'"

# the installed launcher: replaced only by a higher version that parses, and a re-run keeps the last good copy
mkdir -p "$LD/banking/last-good"; echo kept >"$LD/banking/last-good/x"; echo '# local' >>"$LD/banking/launcher.sh"
ops_scheduler_install banking "$T/clone-a"
check "launcher: a re-run keeps the folder, the copy and a launcher of the same version" bash -c "grep -qx '# local' '$LD/banking/launcher.sh' && [[ \$(cat '$LD/banking/last-good/x') = kept ]]"
sed -i 's/^LAUNCHER_VERSION=.*/LAUNCHER_VERSION=7/' "$T/clone-a/scripts/ops-launcher.sh"; echo 'if then (' >>"$T/clone-a/scripts/ops-launcher.sh"
ops_scheduler_install banking "$T/clone-a"
check "launcher: a higher version that does not parse is not taken" bash -c "grep -qx '# local' '$LD/banking/launcher.sh' && [[ '$OPS_LAUNCHER' = '$LD/banking/launcher.sh' ]]"
sed -i '$d' "$T/clone-a/scripts/ops-launcher.sh"
ops_scheduler_install banking "$T/clone-a"
check "launcher: a higher version replaces it" bash -c "grep -qx 'LAUNCHER_VERSION=7' '$LD/banking/launcher.sh' && ! grep -qx '# local' '$LD/banking/launcher.sh' && [[ \$(stat -c %a '$LD/banking/launcher.sh') = 700 ]]"
ops_scheduler_install banking "$T/clone-b"
check "launcher: a lower version does not" grep -qx 'LAUNCHER_VERSION=7' "$LD/banking/launcher.sh"
echo 'if then (' >"$LD/banking/launcher.sh"
ops_scheduler_install banking "$T/clone-b"
check "launcher: one that does not parse is replaced" cmp -s "$T/clone-b/scripts/ops-launcher.sh" "$LD/banking/launcher.sh"

# removal takes the launcher's folder, and only this instance's
ops_scheduler_install banking-2 "$T/clone-b"
ops_scheduler_remove banking
check "remove: the launcher's folder goes, the other instance's stays" test ! -e "$LD/banking" -a -f "$LD/banking-2/launcher.sh"
ops_scheduler_remove banking-2; ops_scheduler_remove banking-2
check "remove: nothing is left" test ! -e "$LD"
XDG_DATA_HOME=$T/data ops_scheduler_install banking "$T/clone-b"
check "remove: a folder named by another XDG_DATA_HOME at the install is read from the schedule" test "$(ops_scheduled_launcher banking)" = "$T/data/omatalous/banking/launcher.sh"
ops_scheduler_remove banking
check "remove: and it goes too" test ! -e "$T/data/omatalous"

# a clone with no launcher (or a home the schedule cannot name): the helper runs as before
reset; touch "$T/linger"
ops_scheduler_install banking "$T/clone-c"; rc=$?
check "no launcher: the unit runs the clone's helper itself" bash -c "[[ $rc = 0 && -z '$OPS_LAUNCHER' ]] && grep -qxF 'ExecStart=$T/clone-c/scripts/ops-helper.sh' '$T/home/.config/systemd/user/talous-ops-banking.service'"
check "launcher folder: XDG_DATA_HOME when it is absolute, else the home" test "$(XDG_DATA_HOME=$T/data ops_launcher_dir a1)" = "$T/data/omatalous/a1" -a "$(XDG_DATA_HOME=rel ops_launcher_dir a1)" = "$LD/a1"
check "launcher folder: no name but an instance name" not eval "ops_launcher_dir ../x || ops_launcher_dir 'a b' || ops_launcher_dir ''"

# the code path has no sudo (a message line that tells the user to run it is not code)
check "no sudo in the scheduling code" bash -c "! grep -vE '^[[:space:]]*(#|OPS_[A-Z]+=)' '$LIB' | grep sudo >/dev/null"

echo; echo "$PASS passed, $FAILED failed"
((FAILED == 0))
