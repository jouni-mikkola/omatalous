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
  new_host; cron_on; echo scripts/update.sh >"$S/foreign"
  install_helper
  check "a checked path owned by someone else: the installer still succeeds" test "$INSTALL_RC" = 0
  check "it names the path and the command that fixes it" bash -c "grep -q 'refuses to run while these are owned by someone else or writable by others: .*scripts/update.sh' '$W/install.out' && grep -q 'sudo chown -R .* \\.   and then: ./scripts/install.sh --ops-helper' '$W/install.out'"
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

# ── a whole install ───────────────────────────────────────────────────────────────────────────────────────────────
# A full install runs in the fake world with a docker that answers what the install asks and logs every call
# (S/docker.log). Names and addresses are made up.
XENV=(); INPUT=/dev/null
# the stub docker of the whole install, in S/bin/docker
write_docker() {
  cat >"$S/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$S/docker.log"
case $1 in
  version) echo 27.0.0 ;;
  info) if [[ -e $S/no-access && ! -e $S/group-applied ]]; then echo "permission denied while trying to connect to the Docker daemon socket" >&2; exit 1; fi ;;
  container) exit 1 ;;
  compose)
    case $2 in
      version) echo 2.29.0 ;;
      ps) [[ -e $S/container ]] && echo abc123 ;;
      exec) [[ $* == *" setup-code" ]] && echo k3f9-2mxq-8hzt-p4wa ;;
    esac ;;
esac
exit 0
EOF
  chmod +x "$S/bin/docker"
}
install_world() { # a first install: no .env yet, a docker for the whole install
  new_host; rm -f "$CL/.env"; XENV=(); INPUT=/dev/null
  write_docker
}
run_install() { # the whole install with these arguments; XENV holds extra environment, INPUT the answers
  in_clone env TALOUS_OPS_HELPER=0 ${XENV[@]+"${XENV[@]}"} ./scripts/install.sh "$@" <"$INPUT" >"$W/install.out" 2>&1; INSTALL_RC=$?
}
why() { [[ $INSTALL_RC = 0 ]] || tail -n 12 "$W/install.out" | sed 's/^/       | /'; }
installed() { test "$INSTALL_RC" = 0; }
said() { local x; for x in "$@"; do grep -qF -- "$x" "$W/install.out" || return 1; done; }
env_has() { grep -qxF -- "$1" "${2:-$CL}/.env"; }

t_access_menu_has_no_tunnel() {
  install_world
  run_install --yes --access tunnel --name home
  check "--access tunnel is refused: the choice is gone" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'Unknown --access: tunnel (lan, local or domain).' '$W/install.out'"
  run_install --yes --access-emails a@example.fi --name home
  check "--access-emails is refused: no Cloudflare Access rule is made by the installer" test "$INSTALL_RC" != 0
  run_install --cloudflare-down
  check "--cloudflare-down is refused" test "$INSTALL_RC" != 0
  check "the script names no Cloudflare setting any more" bash -c "! grep -qiE 'cloudflare|TUNNEL_TOKEN|CF_ACCESS' '$SRC/scripts/install.sh' '$SRC/scripts/lib/install-host.sh'"
}
t_domain_install() {
  install_world
  run_install --yes --access domain --domain talous.example.fi --email mother@example.fi --name home; why
  check "a domain install succeeds" installed
  check ".env names the domain, the Caddy profile and no tunnel line" bash -c "grep -qx 'DOMAIN=talous.example.fi' '$CL/.env' && grep -qx 'COMPOSE_PROFILES=caddy' '$CL/.env' && ! grep -qiE 'CLOUDFLARE|CF_ACCESS|tunnel' '$CL/.env'"
}

# ── the first install: questions first, the docker group without sg, the settings file, the QR code ─────────────────────
# The host-level commands a first install meets. sudo logs what it was asked (S/sudo.log) and runs it; "-u USER" is a new
# login, so the docker group applies from there (S/group-applied: the stub docker lets `info` through once it exists).
ME=${USER:-$(id -un)}
stub_sudo() {
  cat >"$S/bin/sudo" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$S/sudo.log"
[[ -e $S/sudo-refuses ]] && exit 1
while [[ ${1:-} == -* ]]; do case $1 in -u) touch "$S/group-applied"; shift 2 ;; *) shift ;; esac; done
exec "$@"
EOF
  printf '#!/bin/sh\necho "$*" >>"$S/usermod.log"\n' >"$S/bin/usermod"
  chmod +x "$S/bin/sudo" "$S/bin/usermod"
}
stub_sg() { # sg docker -c COMMAND: the command runs with the group
  cat >"$S/bin/sg" <<'EOF'
#!/bin/sh
echo "$*" >>"$S/sg.log"
touch "$S/group-applied"
exec sh -c "$3"
EOF
  chmod +x "$S/bin/sg"
}
# Docker is not on the host. Docker's install script comes from a stub curl and puts the stub docker in place; it also
# notes whether the last answer was given and the .env was not written yet (S/order.log).
no_docker() {
  mv "$S/bin/docker" "$S/docker-real"
  cat >"$S/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=""; url=""
while (($#)); do case $1 in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done
echo "curl $url" >>"$S/curl.log"
[[ $url == https://get.docker.com ]] || exit 22
cat >"$out" <<'INNER'
echo docker-install >>"$S/order.log"
if grep -qF 'Address: ' "$S/../install.out"; then echo asked-before >>"$S/order.log"; else echo asked-after >>"$S/order.log"; fi
if [ -e "$S/../clone/.env" ]; then echo env-before >>"$S/order.log"; fi
cp "$S/docker-real" "$S/bin/docker"
INNER
EOF
  chmod +x "$S/bin/curl"
}
temp_dir() { mkdir -p "$W/tmp"; XENV=("TMPDIR=$W/tmp"); }   # where mktemp puts the answers file: it must be gone at the end
temp_left() { ls "$W/tmp" 2>/dev/null | wc -l; }

t_questions_before_docker() {
  install_world; stub_sudo; no_docker; touch "$S/no-access"; temp_dir
  # Docker's install, the docker group, the access choice, the domain and the email: all asked before anything is installed
  printf 'y\ny\n3\ntalous.example.fi\nmother@example.fi\n' >"$W/answers"; INPUT=$W/answers
  run_install --reconfigure --name home; why
  check "no Docker on the host, every answer given: the install succeeds" installed
  check "Docker's install script ran once, after the last answer and before .env was written" bash -c "[[ \$(grep -c '^docker-install\$' '$S/order.log') = 1 ]] && grep -qx asked-before '$S/order.log' && ! grep -qx env-before '$S/order.log'"
  check "it came from get.docker.com, over curl, once" test "$(grep -c '^curl https://get.docker.com$' "$S/curl.log")" = 1
  check "the docker group was agreed to with the other answers: one usermod" bash -c "[[ \$(wc -l <'$S/usermod.log') = 1 ]] && grep -qx -- '-aG docker $ME' '$S/usermod.log'"
  check "the second run, started by sudo as the user, took the answers along: nothing was asked twice" bash -c "grep -qE '^-u $ME env TALOUS_REEXEC=1 TALOUS_ANSWERS=[^ ]+ $CL/scripts/install.sh --reconfigure --name home\$' '$S/sudo.log' && grep -qx 'DOMAIN=talous.example.fi' '$CL/.env' && grep -qx 'ACME_EMAIL=mother@example.fi' '$CL/.env' && grep -qx 'COMPOSE_PROFILES=caddy' '$CL/.env'"
  check "the answers file is gone" test "$(temp_left)" = 0
  check "no hint names newgrp" bash -c "! grep -qi newgrp '$W/install.out'"
  # a no to the install, and a no to the group
  install_world; stub_sudo; no_docker; printf 'n\n' >"$W/answers"; INPUT=$W/answers
  run_install --reconfigure --name home
  check "no to Docker's install: it stops with the manual command and runs nothing" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'Docker is missing. Install it:' '$W/install.out' && [[ ! -e '$S/order.log' ]]"
  install_world; stub_sudo; no_docker; printf 'y\nn\n' >"$W/answers"; INPUT=$W/answers
  run_install --reconfigure --name home
  check "no to the group: it stops before Docker is installed and says what to run" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'without the docker group' '$W/install.out' && [[ ! -e '$S/order.log' ]]"
}
t_docker_group_without_sg() {
  install_world; stub_sudo; touch "$S/no-access"; temp_dir
  check "world: the host has no sg" bash -c "! PATH='$S/bin:$SYS' command -v sg"
  run_install --yes --access local --name home; why
  check "no sg, the user not in the docker group: the install succeeds" installed
  check "the user is added to the group with sudo -n" grep -qx -- "-n usermod -aG docker $ME" "$S/sudo.log"
  check "the second run is sudo -n -u USER env TALOUS_REEXEC=1 <script> <args>" bash -c "grep -qE '^-n -u $ME env TALOUS_REEXEC=1 TALOUS_ANSWERS=[^ ]+ $CL/scripts/install.sh --yes --access local --name home\$' '$S/sudo.log'"
  check "the output says it goes on in a new session, and the app is started there" said 'Continuing in a new session with the docker group' 'The app is running.'
  check "the answers file is gone" test "$(temp_left)" = 0
  # with sg the old way stays: sg docker -c, and sudo only adds the group
  install_world; stub_sudo; stub_sg; touch "$S/no-access"
  run_install --yes --access local --name home; why
  check "with sg: the second run is sg docker -c <script and args>" bash -c "[[ \$(wc -l <'$S/sg.log') = 1 ]] && grep -qE '^docker -c .*install.sh --yes --access local --name home' '$S/sg.log' && ! grep -q -- ' -u ' '$S/sudo.log'"
  check "with sg: the install succeeds" installed
}
t_no_newgrp_hint() {
  check "no script names newgrp" bash -c "! grep -n newgrp '$SRC/scripts/install.sh' '$SRC/scripts/update.sh' '$SRC/scripts/doctor.sh'"
  check "update.sh and doctor.sh say to open the SSH connection again" bash -c "grep -qF 'close the SSH connection and open it again' '$SRC/scripts/update.sh' && grep -qF 'close the SSH connection and open it again' '$SRC/scripts/doctor.sh' && grep -qF 'sulje SSH-yhteys' '$SRC/scripts/doctor.sh'"
  # a member of the group whose login lacks it, and no way to start a new session: neither sg nor sudo
  install_world; touch "$S/no-access"; echo "$ME" >"$S/docker-members"; echo 4242 >"$S/docker-gid"; temp_dir
  run_install --yes --access local --name home
  check "no way works: the install stops and says to open the SSH connection again, then to run it again" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'Close the SSH connection and open it again (or log out and in), then run ./scripts/install.sh again.' '$W/install.out'"
  check "the message names no newgrp" bash -c "! grep -qi newgrp '$W/install.out'"
  # sudo is there and refuses: the same message, nothing left behind
  install_world; stub_sudo; touch "$S/no-access" "$S/sudo-refuses"; echo "$ME" >"$S/docker-members"; echo 4242 >"$S/docker-gid"; temp_dir
  run_install --yes --access local --name home
  check "sudo refuses: the same message" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'Close the SSH connection and open it again' '$W/install.out' && ! grep -qi newgrp '$W/install.out'"
  check "sudo refuses: the answers file is removed" test "$(temp_left)" = 0
  check "sudo refuses: it was asked once, and nothing was started" bash -c "[[ \$(grep -c . '$S/sudo.log') = 1 ]] && ! grep -q '^compose up' '$S/docker.log'"
}
t_answers_file_only_for_a_reexec() {
  install_world; temp_dir; printf 'PORT=8123\nACCESS=2\n' >"$W/answers.in"
  XENV+=("TALOUS_ANSWERS=$W/answers.in")
  run_install --yes --access local --name home; why
  check "TALOUS_ANSWERS without TALOUS_REEXEC is not read: the port is not 8123 and the file stays" bash -c "! grep -qx 'HOST_PORT=8123' '$CL/.env' && [[ -s '$W/answers.in' ]]"
  install_world; temp_dir; printf 'PORT=8123\n' >"$W/real.in"; ln -s "$W/real.in" "$W/answers.in"
  XENV+=("TALOUS_REEXEC=1" "TALOUS_ANSWERS=$W/answers.in")
  run_install --yes --access local --name home; why
  check "a link is not read either" bash -c "! grep -qx 'HOST_PORT=8123' '$CL/.env' && [[ -s '$W/real.in' ]]"
  install_world; temp_dir; printf 'PORT=8123\nOPS_HELPER=false\nBOGUS=1\n' >"$W/answers.in"
  XENV+=("TALOUS_REEXEC=1" "TALOUS_ANSWERS=$W/answers.in")
  run_install --yes --name home --access local; why
  check "a re-exec reads its file once, takes the names it knows and deletes it" bash -c "grep -qx 'HOST_PORT=8123' '$CL/.env' && [[ ! -e '$W/answers.in' ]]"
}

stub_qrencode() { # records its arguments and what it was given on stdin
  printf '#!/usr/bin/env bash\necho "$*" >>"$S/qr.args"\ncat >"$S/qr.in"\necho QR-BLOCK\n' >"$S/bin/qrencode"
  chmod +x "$S/bin/qrencode"
}
t_qr_when_qrencode() {
  install_world; stub_qrencode
  run_install --yes --access domain --name home --domain talous.example.fi --email mother@example.fi; why
  check "the install succeeds and prints the setup link" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qF 'Set up: ' '$W/install.out'"
  check "qrencode is run once, with the setup link on its standard input" bash -c "[[ \$(grep -c . '$S/qr.args') = 1 ]] && [[ \$(cat '$S/qr.in') = 'https://talous.example.fi/#koodi=k3f9-2mxq-8hzt-p4wa' ]]"
  check "the one-time code is not in qrencode's arguments, so not in the process list" bash -c "! grep -q 'k3f9' '$S/qr.args'"
  check "the code is printed after the link, and no hint to install qrencode is shown" bash -c "grep -qF QR-BLOCK '$W/install.out' && ! grep -qF 'apt install qrencode' '$W/install.out'"
}
t_qr_absent_is_quiet() {
  install_world
  run_install --yes --access domain --name home --domain talous.example.fi --email mother@example.fi; why
  check "no qrencode: the install succeeds and prints the setup link" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qF 'Set up: ' '$W/install.out' && grep -qF 'https://talous.example.fi/#koodi=k3f9-2mxq-8hzt-p4wa' '$W/install.out'"
  check "one line says how to get the code, and it is no warning" bash -c "[[ \$(grep -c 'apt install qrencode' '$W/install.out') = 1 ]] && ! grep 'qrencode' '$W/install.out' | grep \$'\\e\\[33m' >/dev/null"
  check "the script installs nothing for it" bash -c "! grep -qiE 'installing (qrencode|jq)' '$W/install.out' && ! grep -q qrencode '$S/docker.log'"
}

# the release an install builds: the vX.Y.Z tag at HEAD when the checkout sits on one (a bootstrap clone holds every tag,
# a release candidate tag among them), else the newest tag as before
t_tag_at_head() {
  install_world
  git -C "$CL" tag v1.0.0; git -C "$CL" tag v1.0.1-rc1
  git -C "$CL" commit -q --allow-empty -m later; git -C "$CL" tag v1.1.0
  git -C "$CL" checkout -q v1.0.0
  printf '#!/bin/sh\nexit 7\n' >"$S/bin/curl"; chmod +x "$S/bin/curl" # a first install asks GitHub which release is out: no answer here
  run_install --yes --access local --name home
  check "HEAD is at v1.0.0, a pre-release tag is on it and v1.1.0 is newer: the release is v1.0.0" said 'Channel: release v1.0.0'
  check "the newer tag and the pre-release are not taken" bash -c "! grep -qE 'release v1\\.1\\.0|rc1' '$W/install.out'"
}
t_newest_tag_when_not_at_head() {
  install_world
  git -C "$CL" commit -q --allow-empty -m later; git -C "$CL" tag v1.1.0
  git -C "$CL" checkout -q HEAD~1
  run_install --yes --access local --name home; why
  check "HEAD carries no tag: the newest tag decides as before (this folder is older than it)" said 'This folder is older than release v1.1.0'
  check "and the source is built here, not a release pulled" bash -c "[[ $INSTALL_RC = 0 ]] && ! grep -qF 'Channel: release' '$W/install.out' && grep -qx 'compose build banking' '$S/docker.log'"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
