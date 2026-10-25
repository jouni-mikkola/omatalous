#!/usr/bin/env bash
# A fake host for install.test.sh and doctor.test.sh. Sourced by them, not a suite of its own (check.sh runs *.test.sh).
# ops-access.test.sh takes only the counters and `unprivileged` from here: it has a stub docker of its own.
# A clone of this repository's scripts under Ubuntu's umask 002, and stubs for what the maintenance helper's
# scheduling asks the host: systemctl, loginctl, crontab, getent, id, jq and docker. Nothing touches the real host.
#
# The caller sets HERE and SRC, calls `unprivileged SUITE "$@"` first (the installer and the helper refuse root, so a
# root run copies the scripts and tools/test and runs the suite again as nobody) and `host_init` once.
#
# A world is a folder with the clone, a stub folder S and a home. Flags are files in S:
#   systemd          systemctl --user works                 timer-enabled   the instance's timer is enabled
#   linger           loginctl says Linger=yes (set by new_host)
#   cron             a crontab command exists (kept in S/crontab)
#   docker-gid GID   the group getent knows as docker       shell-gid GID   `id -G` of the shell lists GID too
#   docker-members   the members getent lists for docker (a user name)
#   manager-pid PID  user@UID.service has this MainPID (its groups are the ones of that process)
#   foreign          lists the paths (as the scripts name them) that stat reports as owned by root

PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }

unprivileged() { # unprivileged SUITE ARGS...
  local suite=$1 base rc; shift
  [[ $EUID -eq 0 && -z ${OPS_TEST_CHILD:-} ]] || return 0
  base=$(mktemp -d); chmod 755 "$base"
  mkdir -p "$base/src/tools"; cp -r "$SRC/scripts" "$base/src/"; cp -r "$SRC/tools/test" "$base/src/tools/"
  chown -R 65534:65534 "$base"
  setpriv --reuid=65534 --regid=65534 --clear-groups env -u TMPDIR HOME="$base" OPS_TEST_CHILD=1 OPS_TEST_SRC="$base/src" bash "$base/src/tools/test/$suite" "$@"
  rc=$?
  rm -rf "$base"
  exit "$rc"
}

host_init() {
  umask 002
  TMPBASE=$(mktemp -d)
  trap 'rm -rf "$TMPBASE"' EXIT
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
  # The system tools without the ones a test decides about, so that "no crontab" is a command that does not exist (sg,
  # newgrp, sudo, usermod and qrencode too: Ubuntu 26.04.1 has no sg, and a test adds the stubs it wants).
  SYS=$TMPBASE/sys; mkdir -p "$SYS"
  # one ln for all of them (a name in both folders is taken from the later, /usr/sbin)
  local f b
  declare -A pick=()
  for f in /usr/bin/* /usr/sbin/*; do
    b=${f##*/}
    case $b in crontab | systemctl | loginctl | getent | id | jq | docker | sg | newgrp | sudo | usermod | qrencode) ;; *) pick[$b]=$f ;; esac
  done
  ln -sf -t "$SYS" "${pick[@]}" 2>/dev/null
}

write_stubs() {
  local b=$S/bin
  cat >"$b/systemctl" <<'EOF'
#!/bin/bash
[[ -e $S/systemd ]] || exit 1
args=" $* "
case $args in
  *" show-environment "*) exit 0 ;;
  *" is-enabled "*) [[ -e $S/timer-enabled ]]; exit $? ;;
  *" enable --now "*) touch "$S/timer-enabled"; echo "enable ${*: -1}" >>"$S/calls.log"; exit 0 ;;
  *" disable --now "*) rm -f "$S/timer-enabled"; exit 0 ;;
  *" show -p MainPID --value "*) [[ -e $S/manager-pid ]] && cat "$S/manager-pid"; exit 0 ;;
esac
exit 0
EOF
  cat >"$b/loginctl" <<'EOF'
#!/bin/bash
case $* in
  *enable-linger*) touch "$S/linger"; exit 0 ;;
  *show-user*) if [[ -e $S/linger ]]; then echo yes; else echo no; fi ;;
esac
EOF
  cat >"$b/getent" <<'EOF'
#!/bin/bash
if [[ ${1:-} == group && ${2:-} == docker ]]; then
  [[ -e $S/docker-gid ]] || exit 2
  echo "docker:x:$(cat "$S/docker-gid"):$(cat "$S/docker-members" 2>/dev/null || true)"; exit 0
fi
exec /usr/bin/getent "$@"
EOF
  cat >"$b/id" <<'EOF'
#!/bin/bash
if [[ ${1:-} == -G && -e $S/shell-gid ]]; then echo "$(/usr/bin/id -G) $(cat "$S/shell-gid")"; exit 0; fi
exec /usr/bin/id "$@"
EOF
  cat >"$b/stat" <<'EOF'
#!/bin/bash
all=("$@"); L=(); [[ ${1:-} == -L ]] && { L=(-L); shift; }
# an open file (stat -L /dev/fd/N) is named by the path it was opened by
p=${*: -1}; [[ $p == /dev/fd/* ]] && p=$(readlink -f -- "$p")
if [[ ${1:-} == -c && -e $S/foreign ]] && grep -qxF -- "$p" "$S/foreign"; then exec /usr/bin/stat "${L[@]}" -c "${2//%u/0}" "${@: -1}"; fi
exec /usr/bin/stat "${all[@]}"
EOF
  # The scripts' waits (a poll once a second, a retry after two) return at once, the way ops-world's sleep does.
  printf '#!/bin/sh\nexec /bin/sleep 0.01\n' >"$b/sleep"
  printf '#!/bin/sh\nexit 0\n' >"$b/jq"
  printf '#!/bin/sh\nexit 1\n' >"$b/docker"
  # A scenario that lets a script reach the network writes its own $S/bin/curl over this one. Without it a call is the
  # scenario's mistake, and it must not reach the real host: it fails and names the URL.
  cat >"$b/curl" <<'EOF'
#!/bin/bash
url=""; for a in "$@"; do case $a in http*) url=$a ;; esac; done
echo "curl stub: no answer given for ${url:-(no URL)}; the scenario writes its own bin/curl" >&2
exit 7
EOF
  # What listens on the machine is the scenario's to say (S/listening, the lines `ss -H -ltn` prints), nothing by default:
  # the real host has listeners of its own, such as another container on 8080, and an install must not meet them.
  cat >"$b/ss" <<'EOF'
#!/bin/bash
cat "${0%/*}/../listening" 2>/dev/null
exit 0
EOF
  chmod +x "$b"/*
}
# cron on or off: a crontab command kept in a file, or none at all
cron_on() {
  cat >"$S/bin/crontab" <<'EOF'
#!/bin/bash
f=$S/crontab
case ${1:-} in -l) [[ -s $f ]] && cat "$f"; exit 0 ;; -r) rm -f "$f"; exit 0 ;; -) cat >"$f"; exit 0 ;; esac
exit 1
EOF
  chmod +x "$S/bin/crontab"
}
cron_off() { rm -f "$S/bin/crontab" "$S/crontab"; }

# a world with the clone (checked out under umask 002, so .git and the scripts are group writable) and a .env
new_host() {
  W=$(mktemp -d "$TMPBASE/w.XXXXXX"); S=$W/stub; CL=$W/clone
  mkdir -p "$S/bin" "$W/home" "$W/seed/scripts/lib"
  write_stubs; touch "$S/linger"
  cp "$SRC"/scripts/*.sh "$W/seed/scripts/"; cp "$SRC"/scripts/lib/*.sh "$W/seed/scripts/lib/"
  printf '/ops/\n/backups/\n.env\n' >"$W/seed/.gitignore"
  git init -q --bare -b main "$W/origin.git"
  git -C "$W/seed" init -q -b main
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm start
  git -C "$W/seed" push -q "file://$W/origin.git" main 2>/dev/null
  git clone -q "file://$W/origin.git" "$CL" 2>/dev/null
  printf 'INSTANCE_NAME=banking-app\n' >"$CL/.env"; chmod 600 "$CL/.env"
}
# the group the shell and the user manager share (a normal host), the group the shell has and the manager lacks, a
# shell without the docker group (rootless Docker)
gid_shared() { id -g >"$S/docker-gid"; rm -f "$S/shell-gid"; echo $$ >"$S/manager-pid"; }
gid_manager_lacks() { echo 4242 >"$S/docker-gid"; echo 4242 >"$S/shell-gid"; echo $$ >"$S/manager-pid"; }
gid_shell_lacks() { echo 4242 >"$S/docker-gid"; rm -f "$S/shell-gid"; echo $$ >"$S/manager-pid"; }

# a command of the clone with the stubs and nothing else on PATH, as the timer or a login would run it
in_clone() { (cd "$CL" && env S="$S" HOME="$W/home" XDG_CONFIG_HOME="$W/home/.config" XDG_DATA_HOME="$W/home/.local/share" PATH="$S/bin:$SYS" "$@"); }
# group or others can write to a path of the clone: what the helper refuses
writable_by_others() { (((8#$(stat -c %a "$CL/$1") & 8#022) != 0)); }
