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

# ── the Cloudflare part of a whole install ────────────────────────────────────────────────────────────────────────
# A full install runs in the fake world with a docker that answers what the install asks, logs every call (S/docker.log)
# and plays the app image's `cloudflare up` and `cloudflare down`: it answers `up` with the JSON line,
# or with exit 3 or 4 (S/cf-mode), and logs the emails it was given. Names and addresses are made up.
# The process id of this run is in each token that the process list is searched for: another run of this suite or of
# another one on the same machine (two checks at once, every scenario of a check is a job of its own) has other values,
# so it cannot show them. t_cloudflare_watcher_sees_argv puts one in an argument list on purpose, and every check that
# compares .env with a token has it in a bash -c argument. The form is the same as before (letters, digits, _ and =).
API_TOKEN=cfapi_example_$$_0123456789abcdefghij
TUN_TOKEN=$(printf '{"a":"example","t":"example-tunnel","s":"example%s"}' "$$" | base64 -w0)
MANUAL_TOKEN=$(printf '{"manual":"token%s"}' "$$" | base64 -w0)
EMAILS="anna@example.fi,pekka@example.fi"   # the file's list, the default of every copy
# what `cloudflare up` adds for the app's own check of Access: the application's audience tag and the team's host
AUD_TAG=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
TEAM_DOMAIN=kotitiimi.cloudflareaccess.com
XENV=(); INPUT=/dev/null
cf_file() { echo "$W/home/.config/omatalous/cloudflare.env"; }
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
      up) if grep -qxFf "$S/envline" .env; then echo "up: .env has the tunnel token" >>"$S/docker.log"; else echo "up: .env has no tunnel token" >>"$S/docker.log"; fi
          if grep -q '^CF_ACCESS_AUD=.' .env && grep -q '^CF_ACCESS_TEAM_DOMAIN=.' .env; then echo "up: .env has the Access pair" >>"$S/docker.log"; else echo "up: .env has no Access pair" >>"$S/docker.log"; fi ;;
      ps) [[ -e $S/container ]] && echo abc123 ;;
      exec) [[ $* == *" setup-code" ]] && echo k3f9-2mxq-8hzt-p4wa ;;
    esac ;;
  run)
    [[ $* == "run --rm --log-driver none -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCESS_EMAILS "* ]] || { echo "stub: wrong docker run flags" >&2; exit 2; }
    [[ ${CLOUDFLARE_API_TOKEN:-} == "$(cat "$S/api-token")" ]] || { echo "stub: no API token in the environment" >&2; exit 2; }
    echo "emails: ${CLOUDFLARE_ACCESS_EMAILS:-}" >>"$S/docker.log"
    host=""; prev=""; for a in "$@"; do [[ $prev == --hostname ]] && host=$a; prev=$a; done
    sleep 1
    case $(cat "$S/cf-mode" 2>/dev/null || echo ok) in
      exit3) echo "Cloudflare refused: the record $host points somewhere else" >&2; exit 3 ;;
      exit4) echo "turn on Zero Trust (Free) in the dashboard" >&2; exit 4 ;;
    esac
    # S/made: the hosts Cloudflare has a tunnel for (`cloudflare up --new` stops on those before it writes)
    if [[ $* == *" cloudflare down "* ]]; then sed -i "/^$host\$/d" "$S/made" 2>/dev/null; echo "Removed the tunnel of $host" >&2; exit 0; fi
    if [[ $* == *" --new" ]] && grep -qxF "$host" "$S/made" 2>/dev/null; then echo "$host is already set up in Cloudflare" >&2; exit 3; fi
    grep -qxF "$host" "$S/made" 2>/dev/null || echo "$host" >>"$S/made"
    echo "Tunnel ready for $host" >&2
    printf '{"hostname":"%s","tunnelToken":"%s","changed":["tunnel","dns","access"]%s}\n' "$host" "$(cat "$S/tunnel-token")" "$(cat "$S/access-pair" 2>/dev/null)" ;;
esac
exit 0
EOF
  chmod +x "$S/bin/docker"
}
cf_world() { # a first install: no .env yet, the Cloudflare file (mode 600), a docker for the whole install
  new_host; rm -f "$CL/.env"; XENV=(); INPUT=/dev/null
  mkdir -p "$W/home/.config/omatalous"; chmod 755 "$W/home/.config"; chmod 700 "$W/home/.config/omatalous"
  printf '# made up\nCLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ACCESS_EMAILS=%s\nCLOUDFLARE_BASE_DOMAIN=example.fi\n' "$API_TOKEN" "$EMAILS" >"$(cf_file)"
  chmod 600 "$(cf_file)"
  printf '%s' "$API_TOKEN" >"$S/api-token"; printf '%s' "$TUN_TOKEN" >"$S/tunnel-token"
  # S/access-pair: what the JSON line of `up` has after "changed" (without the file: the line of an image before 0.8.7)
  printf ',"accessAud":"%s","teamDomain":"%s"' "$AUD_TAG" "$TEAM_DOMAIN" >"$S/access-pair"
  printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' "$TUN_TOKEN" >"$S/envline"; printf '%s\n%s\n' "$API_TOKEN" "$TUN_TOKEN" >"$W/secrets"
  write_docker
}
# the secrets in any process's argument list while the install runs (ps shows arguments, not the environment)
# The watcher says by a file that it has taken its first sample (ps.first), and the caller starts the command only then. It
# says by another that a sample began after ps.begun was written (ps.seen), so a command that writes ps.begun can wait for
# it. unwatch_ps takes the stop flag first, then the watcher takes one more sample and ends. No sleep decides what is seen.
watch_ps() {
  rm -f "$W"/ps.{stop,first,begun,seen}; : >"$W/ps.hits"
  ( while :; do
      stop=0; seen=0; [[ ! -e $W/ps.stop ]] || stop=1; [[ ! -e $W/ps.begun ]] || seen=1
      ps -eo args 2>/dev/null | grep -F -f "$W/secrets" >>"$W/ps.hits"
      : >"$W/ps.first"; ((seen == 0)) || : >"$W/ps.seen"
      ((stop == 0)) || break
      sleep 0.01
    done ) &
  WATCH=$!
  while [[ ! -e $W/ps.first ]] && kill -0 "$WATCH" 2>/dev/null; do sleep 0.01; done
}
unwatch_ps() { touch "$W/ps.stop"; wait "$WATCH" 2>/dev/null; }
cf_install() { # the whole install with these arguments; XENV holds extra environment, INPUT the answers
  watch_ps
  in_clone env TALOUS_OPS_HELPER=0 ${XENV[@]+"${XENV[@]}"} ./scripts/install.sh "$@" <"$INPUT" >"$W/install.out" 2>&1; INSTALL_RC=$?
  unwatch_ps
}
why() { [[ $INSTALL_RC = 0 ]] || tail -n 12 "$W/install.out" | sed 's/^/       | /'; }
installed() { test "$INSTALL_RC" = 0; }
refused() { test "$INSTALL_RC" != 0; }
said() { local x; for x in "$@"; do grep -qF -- "$x" "$W/install.out" || return 1; done; }
logged() { grep -qxF -- "$1" "$S/docker.log"; }
runs() { grep -c '^run ' "$S/docker.log" 2>/dev/null || true; }
leaks() { cat "$W/install.out" "$S/docker.log" "$W/ps.hits" 2>/dev/null | grep -cF -f "$W/secrets" || true; }
env_has() { grep -qxF -- "$1" "${2:-$CL}/.env"; }
up_line() { echo "run --rm --log-driver none -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCESS_EMAILS $1:latest node dist/node.js cloudflare up --name $1 --hostname $2${3:+ $3}"; }
down_line() { echo "run --rm --log-driver none -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCESS_EMAILS $1:latest node dist/node.js cloudflare down --name $1 --hostname $2"; }
# the first of the docker calls that start with a word is before the second
before() { local a b; a=$(grep -n -m1 -- "^$1" "$S/docker.log" | cut -d: -f1); b=$(grep -n -m1 -- "^$2" "$S/docker.log" | cut -d: -f1); [[ -n $a && -n $b ]] && ((a < b)); }
order_ok() { before 'compose build' 'run ' && before 'run ' 'compose up'; }
env_mode_600() { [[ $(stat -c %a "$CL/.env") = 600 && ! -e "$CL/.env.new" ]]; }
# the pair that turns on the app's own check of Access: both lines as `up` gave them, or no line of either
has_pair() { env_has "CF_ACCESS_AUD=$AUD_TAG" && env_has "CF_ACCESS_TEAM_DOMAIN=$TEAM_DOMAIN" && [[ $(grep -c '^CF_ACCESS_' "$CL/.env") = 2 ]]; }
no_pair() { ! grep -q '^CF_ACCESS_' "$CL/.env"; }

t_cloudflare_watcher_sees_argv() {
  cf_world
  watch_ps
  # the command has the secret in its arguments and ends only after a sample that began once it was there, and after the
  # file WATCH_HOLD names when a caller (t_other_run_is_not_seen) sets one
  bash -c 'touch "$1"; while [[ ! -e $2 || (-n $3 && ! -e $3) ]]; do sleep 0.01; done' "$API_TOKEN" "$W/ps.begun" "$W/ps.seen" "${WATCH_HOLD:-}"
  unwatch_ps
  check "the process list check does see a secret in an argument list" test -s "$W/ps.hits"
}
t_cloudflare_first_install() {
  cf_world
  cf_install --yes --access tunnel --name home --domain talous.example.fi; why
  check "first install with the file: the install succeeds" installed
  check "it runs cloudflare up in the app image for talous.<base domain>, the values through the environment" logged "$(up_line home talous.example.fi --new)"
  check "the emails passed on are the file's list, the default" logged "emails: $EMAILS"
  check ".env has the tunnel token the command returned" env_has "CLOUDFLARE_TUNNEL_TOKEN=$TUN_TOKEN"
  check ".env has this copy's emails (no secret)" env_has "CLOUDFLARE_ACCESS_EMAILS=$EMAILS"
  check ".env has the address, the tunnel profile and TRUST_PROXY" bash -c "grep -qx 'APP_BASE_URL=https://talous.example.fi' '$CL/.env' && grep -qx 'COMPOSE_PROFILES=tunnel' '$CL/.env' && grep -qx 'TRUST_PROXY=true' '$CL/.env' && grep -qx 'DOMAIN=talous.example.fi' '$CL/.env'"
  check ".env stays mode 600 and no .env.new is left" env_mode_600
  check "the image is built, then Cloudflare is asked, then the containers start" order_ok
  check "the containers start with the token already in .env" logged "up: .env has the tunnel token"
  check "the output gives the address and the Enable Banking redirect URL" said 'Omatalous is running:' 'https://talous.example.fi' 'redirect URL: ' 'https://talous.example.fi/api/connections/callback'
  check "the output says who Access lets in and that the PIN comes by email" said 'anna@example.fi,pekka@example.fi' 'one-time PIN'
  check "the API token and the tunnel token are not in the output, the docker calls or the process list" test "$(leaks)" = 0
  check "the host is this copy's: no CLOUDFLARE_NEW_HOST is left in .env" bash -c "! grep -q '^CLOUDFLARE_NEW_HOST=' '$CL/.env'"
  check "the docker run of the cloudflare command has no log driver (its stdout has the tunnel token)" bash -c "[[ \$(grep -c '^run ' '$S/docker.log') = 1 && \$(grep -c '^run --rm --log-driver none ' '$S/docker.log') = 1 ]]"
}
t_cloudflare_new_instance() {
  cf_world
  cf_install --new-instance isa --yes --access tunnel; why
  check "--new-instance with the file: the copy is installed" installed
  check "the copy's address is <name>.<base domain>, with no question" logged "$(up_line isa isa.example.fi --new)"
  check "the copy's .env has its address and token" bash -c "grep -qx 'APP_BASE_URL=https://isa.example.fi' '$W/isa/.env' && grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$TUN_TOKEN' '$W/isa/.env' && grep -qx 'COMPOSE_PROFILES=tunnel' '$W/isa/.env' && grep -qx 'TRUST_PROXY=true' '$W/isa/.env'"
  check "without a list of its own it takes the file's" env_has "CLOUDFLARE_ACCESS_EMAILS=$EMAILS" "$W/isa"
  check "the output names the copy's address and its redirect URL" said "https://isa.example.fi/api/connections/callback"
  check "only one tunnel was made" test "$(runs)" = 1
  check "no secret in the output, the docker calls or the process list" test "$(leaks)" = 0
  # a name with an underscore: the host label has no underscore, the copy keeps its name
  cf_world
  cf_install --new-instance isa_two --yes --access tunnel
  check "an underscore in the name becomes a hyphen in the address only" logged "$(up_line isa_two isa-two.example.fi --new)"
}
t_cloudflare_copy_with_its_own_emails() {
  cf_world
  cf_install --new-instance isa --yes --access tunnel --access-emails "mother@example.fi, father@example.fi"; why
  check "a copy with --access-emails: the copy is installed" installed
  check "Cloudflare gets that list (trimmed), not the file's" logged "emails: mother@example.fi,father@example.fi"
  check "the copy's .env keeps it" env_has "CLOUDFLARE_ACCESS_EMAILS=mother@example.fi,father@example.fi" "$W/isa"
  check "the output names those addresses and not the file's" bash -c "grep -qF 'mother@example.fi,father@example.fi' '$W/install.out' && ! grep -qF 'anna@example.fi' '$W/install.out'"
  cf_world; XENV=("TALOUS_ACCESS_EMAILS=sister@example.fi")
  cf_install --new-instance isa --yes --access tunnel
  check "TALOUS_ACCESS_EMAILS does the same as the flag" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qx 'CLOUDFLARE_ACCESS_EMAILS=sister@example.fi' '$W/isa/.env'"
  cf_world
  cf_install --yes --access tunnel --name home --domain talous.example.fi --access-emails "a@example.fi"
  check "a first install can have its own list too" env_has "CLOUDFLARE_ACCESS_EMAILS=a@example.fi"
}
t_cloudflare_change_the_emails() {
  cf_world
  cf_install --yes --access tunnel --name home --domain talous.example.fi; touch "$S/container"; : >"$S/docker.log"
  cf_install --yes --access-emails "new@example.fi,other@example.fi"; why
  check "--access-emails alone in the copy's folder succeeds" installed
  check "it runs cloudflare up again for the same address with the new list" bash -c "[[ \$(grep -c '^run ' '$S/docker.log') = 1 ]] && grep -qxF '$(up_line home talous.example.fi)' '$S/docker.log' && grep -qxF 'emails: new@example.fi,other@example.fi' '$S/docker.log'"
  check "the new list replaces the old one in .env, once" bash -c "[[ \$(grep -c '^CLOUDFLARE_ACCESS_EMAILS=' '$CL/.env') = 1 ]] && grep -qx 'CLOUDFLARE_ACCESS_EMAILS=new@example.fi,other@example.fi' '$CL/.env'"
  check "the address, the token and the profile are as before" bash -c "grep -qx 'APP_BASE_URL=https://talous.example.fi' '$CL/.env' && grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$TUN_TOKEN' '$CL/.env' && grep -qx 'COMPOSE_PROFILES=tunnel' '$CL/.env'"
  check "the closing lines show the new list" said "new@example.fi,other@example.fi"
  # an install that no tunnel reaches is not switched by the way
  cf_world
  cf_install --yes --access local --name home; touch "$S/container"; : >"$S/docker.log"
  cf_install --yes --access-emails "new@example.fi"
  check "--access-emails on an install without a tunnel is refused and says how to switch" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'not reached by a tunnel' '$W/install.out' && grep -qF -- '--access tunnel --access-emails' '$W/install.out' && [[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 ]]"
}
t_cloudflare_asks_for_the_emails() {
  cf_world; printf '\nmother@example.fi\n' >"$W/answers"; INPUT=$W/answers
  cf_install --access tunnel --name home; why
  check "without --yes the answers are the copy's address and list, and Cloudflare gets the list" bash -c "grep -qx 'CLOUDFLARE_ACCESS_EMAILS=mother@example.fi' '$CL/.env' && grep -qxF 'emails: mother@example.fi' '$S/docker.log'"
  check "an empty answer to the address takes talous.<base domain>" env_has "DOMAIN=talous.example.fi"
  cf_world; printf '\n\n' >"$W/answers"; INPUT=$W/answers
  cf_install --access tunnel --name home
  check "an empty answer to the emails takes the file's list" bash -c "grep -qx 'CLOUDFLARE_ACCESS_EMAILS=$EMAILS' '$CL/.env'"
  cf_world; printf '\n\n' >"$W/answers"; INPUT=$W/answers; printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_BASE_DOMAIN=example.fi\n' "$API_TOKEN" >"$(cf_file)"
  cf_install --access tunnel --name home
  check "a file without emails and no answer: the install stops and says how to give them" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'No email address for Cloudflare Access' '$W/install.out' && grep -qF -- '--access-emails' '$W/install.out' && [[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 ]]"
  cf_world; printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_BASE_DOMAIN=example.fi\n' "$API_TOKEN" >"$(cf_file)"
  cf_install --yes --access tunnel --name home --domain talous.example.fi --access-emails "a@example.fi"
  check "a file without emails is enough when the list is given" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qx 'CLOUDFLARE_ACCESS_EMAILS=a@example.fi' '$CL/.env'"
}
t_cloudflare_email_check() {
  local bad
  for bad in "not-an-address" "a@example.fi,b" "a@@example.fi" "a@example" ","; do
    cf_world
    cf_install --yes --access tunnel --name home --domain talous.example.fi --access-emails "$bad"
    check "emails '$bad' are refused before anything is made" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'The email addresses for Cloudflare Access' '$W/install.out' && [[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 && ! -e '$CL/.env' ]]"
  done
  cf_world
  cf_install --yes --access tunnel --name home --domain talous.example.fi --access-emails " a@example.fi ,, b.c+d@sub.example.fi , "
  check "spaces and empty items are dropped from a good list" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qx 'CLOUDFLARE_ACCESS_EMAILS=a@example.fi,b.c+d@sub.example.fi' '$CL/.env'"
  cf_world; sed -i 's/^CLOUDFLARE_ACCESS_EMAILS=.*/CLOUDFLARE_ACCESS_EMAILS=oops/' "$(cf_file)"
  cf_install --yes --access tunnel --name home --domain talous.example.fi
  check "a bad list in the file stops the install and names the file" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'CLOUDFLARE_ACCESS_EMAILS in' '$W/install.out' && grep -qF 'cloudflare.env' '$W/install.out'"
}
t_cloudflare_file_readable_by_others() {
  local mode
  for mode in 640 644 604; do
    cf_world; chmod "$mode" "$(cf_file)"
    cf_install --yes --access tunnel --name home --domain talous.example.fi
    check "file mode $mode: the install is refused" refused
    check "file mode $mode: the message names the file and chmod 600" bash -c "grep -qF 'cloudflare.env can be read by others' '$W/install.out' && grep -qF 'chmod 600' '$W/install.out'"
    check "file mode $mode: Cloudflare is not asked and nothing is written" bash -c "[[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 && ! -e '$CL/.env' ]]"
  done
  cf_world; mv "$(cf_file)" "$W/real.env"; ln -s "$W/real.env" "$(cf_file)"
  cf_install --yes --access tunnel --name home --domain talous.example.fi
  check "a link to the file is refused too" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'cloudflare.env is a link' '$W/install.out' && [[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 ]]"
  cf_world; echo "$(cf_file)" >"$S/foreign"
  cf_install --yes --access tunnel --name home --domain talous.example.fi
  check "a file that belongs to someone else is refused" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'belongs to someone else' '$W/install.out' && [[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 ]]"
  cf_world; : >"$(cf_file)"; chmod 600 "$(cf_file)"
  cf_install --yes --access tunnel --name home --domain talous.example.fi
  check "an incomplete file names the missing key" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'CLOUDFLARE_API_TOKEN is missing' '$W/install.out'"
}
t_cloudflare_manual_path_unchanged() {
  cf_world; rm -f "$(cf_file)"
  cf_install --yes --access tunnel --domain talous.example.fi --name home
  check "no file, no token: the install stops as before and asks for the token" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'The tunnel token is missing' '$W/install.out' && [[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 ]]"
  cf_world; rm -f "$(cf_file)"; XENV=("TALOUS_TUNNEL_TOKEN=$MANUAL_TOKEN")
  cf_install --yes --access tunnel --domain talous.example.fi --name home; why
  check "no file, a token given: the install succeeds" installed
  check "Cloudflare is not asked and the token is the one given" bash -c "[[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 ]] && grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$MANUAL_TOKEN' '$CL/.env' && grep -qx 'DOMAIN=talous.example.fi' '$CL/.env' && grep -qx 'COMPOSE_PROFILES=tunnel' '$CL/.env'"
  check "no emails line is written for a tunnel made by hand" bash -c "! grep -q 'CLOUDFLARE_ACCESS_EMAILS' '$CL/.env'"
  check "the closing line still tells what to do in the dashboard, and the token is not printed" bash -c "grep -qF 'Public hostname http://banking:8080' '$W/install.out' && ! grep -qF '$MANUAL_TOKEN' '$W/install.out'"
  cf_world; XENV=("TALOUS_TUNNEL_TOKEN=$MANUAL_TOKEN")
  cf_install --yes --access tunnel --domain talous.example.fi --name home
  check "a token given by hand wins over the file" bash -c "[[ $INSTALL_RC = 0 && \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 ]] && grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$MANUAL_TOKEN' '$CL/.env'"
  cf_world
  cf_install --yes --access local --name home
  check "another access does not read the file or ask Cloudflare" bash -c "[[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 ]]"
}
t_cloudflare_refused_then_resumed() {
  cf_world; echo exit3 >"$S/cf-mode"
  cf_install --yes --access tunnel --name home --domain talous.example.fi
  check "exit 3: the install stops and says Cloudflare refused" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'points somewhere else' '$W/install.out' && grep -qF 'Cloudflare refused' '$W/install.out'"
  check "exit 3: no container was started and .env has no token yet" bash -c "! grep -q '^compose up' '$S/docker.log' && grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=' '$CL/.env'"
  check "exit 3: .env says the host is not this copy's yet" env_has "CLOUDFLARE_NEW_HOST=talous.example.fi"
  : >"$S/docker.log"; echo exit4 >"$S/cf-mode"
  cf_install --yes
  check "exit 4: the install stops and says to turn on Zero Trust" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'turn on Zero Trust (Free)' '$W/install.out' && grep -qF 'Turn on Zero Trust' '$W/install.out'"
  check "exit 4: the run without flags went on with the saved address and emails, still as a new host" bash -c "grep -qxF '$(up_line home talous.example.fi --new)' '$S/docker.log' && grep -qxF 'emails: $EMAILS' '$S/docker.log'"
  : >"$S/docker.log"; echo ok >"$S/cf-mode"
  cf_install --yes; why
  check "after the fix a run with no flags finishes the install" installed
  check "it made the tunnel, wrote the token and started the containers" bash -c "grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$TUN_TOKEN' '$CL/.env' && grep -qx 'up: .env has the tunnel token' '$S/docker.log'"
  check "the host is this copy's now" bash -c "! grep -q '^CLOUDFLARE_NEW_HOST=' '$CL/.env'"
  touch "$S/container"; : >"$S/docker.log"
  cf_install --yes
  check "a plain re-run of the finished install does not ask Cloudflare" bash -c "[[ $INSTALL_RC = 0 && \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 ]]"
  check "no secret in the output, the docker calls or the process list" test "$(leaks)" = 0
}
t_cloudflare_reconfigure() {
  cf_world
  cf_install --yes --access tunnel --name home --domain talous.example.fi --access-emails "mother@example.fi"; touch "$S/container"; : >"$S/docker.log"
  echo "ACCESS_LAN_BIND=192.168.1.20" >>"$CL/.env" # what the helper remembers of a copy the app put behind the tunnel
  cf_install --reconfigure --yes --access tunnel; why
  check "--reconfigure keeps the address and the copy's list, and asks Cloudflare again (idempotent)" bash -c "grep -qxF '$(up_line home talous.example.fi)' '$S/docker.log' && grep -qxF 'emails: mother@example.fi' '$S/docker.log'"
  check "the token and the list are in .env after it" bash -c "grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$TUN_TOKEN' '$CL/.env' && grep -qx 'CLOUDFLARE_ACCESS_EMAILS=mother@example.fi' '$CL/.env'"
  check "the home network bind the helper remembered is in .env after it" env_has "ACCESS_LAN_BIND=192.168.1.20"
  : >"$S/docker.log"
  cf_install --reconfigure --yes --access tunnel --domain home.example.fi
  check "--domain gives the address instead of the default" logged "$(up_line home home.example.fi --new)"
}
t_cloudflare_down() {
  cf_world
  cf_install --yes --access tunnel --name home --domain talous.example.fi; touch "$S/container"
  : >"$S/docker.log"; cp "$CL/.env" "$W/env.before"
  cf_install --cloudflare-down; why
  check "--cloudflare-down succeeds" installed
  check "it runs cloudflare down for the copy and its address, and nothing else that makes or changes anything" bash -c "[[ \$(grep -c '^run ' '$S/docker.log') = 1 ]] && grep -qxF '$(down_line home talous.example.fi)' '$S/docker.log' && ! grep -q '^compose' '$S/docker.log'"
  check ".env is left as it is, but for the line that says the host is not this copy's any more and the pair of the app's own Access check" bash -c "diff <(grep -v '^CLOUDFLARE_NEW_HOST=' '$CL/.env') <(grep -v '^CF_ACCESS_' '$W/env.before') && grep -qx 'CLOUDFLARE_NEW_HOST=talous.example.fi' '$CL/.env'"
  check "the pair was there before and is gone after: the Access application it names is removed" bash -c "[[ \$(grep -c '^CF_ACCESS_' '$W/env.before') = 2 ]] && ! grep -q '^CF_ACCESS_' '$CL/.env'"
  : >"$S/docker.log"
  cf_install --cloudflare-down
  check "a second --cloudflare-down removes nothing: the host may be another copy's by now" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'is not this copy' '$W/install.out' && ! grep -q '^run ' '$S/docker.log'"
  cp "$W/env.before" "$CL/.env"
  check "no secret in the output, the docker calls or the process list" test "$(leaks)" = 0
  rm -f "$(cf_file)"; : >"$S/docker.log"
  cf_install --cloudflare-down
  check "without the file it says where the file is and asks nothing of Cloudflare" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'cloudflare.env is missing' '$W/install.out' && ! grep -q '^run ' '$S/docker.log'"
  cf_world; chmod 644 "$(cf_file)"; printf 'INSTANCE_NAME=home\nCOMPOSE_PROFILES=tunnel\nDOMAIN=talous.example.fi\nCLOUDFLARE_ACCESS_EMAILS=a@example.fi\n' >"$CL/.env"; chmod 600 "$CL/.env"
  cf_install --cloudflare-down
  check "a file others can read is refused here too" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'can be read by others' '$W/install.out' && ! grep -q '^run ' '$S/docker.log' 2>/dev/null"
  cf_world; printf 'INSTANCE_NAME=home\nCOMPOSE_PROFILES=tunnel\nDOMAIN=talous.example.fi\nCLOUDFLARE_ACCESS_EMAILS=a@example.fi\n' >"$CL/.env"; chmod 600 "$CL/.env"; echo exit3 >"$S/cf-mode"
  cp "$CL/.env" "$W/env.before"
  cf_install --cloudflare-down
  check "a refusal from Cloudflare fails the command" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'Cloudflare refused' '$W/install.out'"
  # exit 3 is also what down answers when something still routes the address and it kept Access
  check "after exit 3 there is no line that says the address is gone, and .env is as it was" bash -c "! grep -qF 'any more' '$W/install.out' && ! grep -qF 'cannot be reached' '$W/install.out' && cmp -s '$CL/.env' '$W/env.before'"
  check "it says the address is still the copy's and to run it again, and does not blame the API token" bash -c "grep -qF 'is still this copy' '$W/install.out' && grep -qF 'run this again' '$W/install.out' && ! grep -qF 'needs the permissions' '$W/install.out'"
}
t_cloudflare_access_check() {
  # CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN in .env turn on the app's own check of Cloudflare Access
  cf_world
  cf_install --yes --access tunnel --name home --domain talous.example.fi; why
  check "a first install writes the audience tag and the team domain that cloudflare up returned" has_pair
  check "the containers start with the pair and the token already in .env" bash -c "grep -qx 'up: .env has the Access pair' '$S/docker.log' && grep -qx 'up: .env has the tunnel token' '$S/docker.log'"
  check "the output says the app checks Access itself and that the port of the machine gets 403" said 'checks the signature of Cloudflare Access itself' 'only through talous.example.fi' 'gets 403'
  check ".env stays mode 600 and no .env.new is left" env_mode_600
  # an answer without the pair, as an image from before the check gives
  touch "$S/container"; rm -f "$S/access-pair"; : >"$S/docker.log"
  cf_install --yes --access tunnel; why
  check "an answer without the pair: the install succeeds with the token, leaves no pair and says the app does not check Access itself" bash -c "[[ $INSTALL_RC = 0 ]] && ! grep -q '^CF_ACCESS_' '$CL/.env' && grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$TUN_TOKEN' '$CL/.env' && grep -qF 'does not check the signature of Access itself' '$W/install.out' && grep -qx 'up: .env has no Access pair' '$S/docker.log'"
  # that is also an install made before the check existed: the tunnel and its token, no pair. A plain re-run asks
  # Cloudflare nothing (t_cloudflare_refused_then_resumed), so the check comes on with --access tunnel.
  printf ',"accessAud":"%s","teamDomain":"%s"' "$AUD_TAG" "$TEAM_DOMAIN" >"$S/access-pair"; : >"$S/docker.log"
  cf_install --yes --access tunnel; why
  check "--access tunnel on an install without the pair asks Cloudflare again for the same host and writes the pair" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qxF '$(up_line home talous.example.fi)' '$S/docker.log' && grep -qx 'up: .env has the Access pair' '$S/docker.log'"
  check "the pair is there once, with the token" bash -c "[[ \$(grep -c '^CF_ACCESS_' '$CL/.env') = 2 ]] && grep -qx 'CF_ACCESS_AUD=$AUD_TAG' '$CL/.env' && grep -qx 'CF_ACCESS_TEAM_DOMAIN=$TEAM_DOMAIN' '$CL/.env' && grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$TUN_TOKEN' '$CL/.env'"
  # a move away from tunnel access
  : >"$S/docker.log"
  cf_install --reconfigure --yes --access local; why
  check "another way in removes the pair: the install succeeds and the app starts without it" bash -c "[[ $INSTALL_RC = 0 ]] && ! grep -q '^CF_ACCESS_' '$CL/.env' && grep -qx 'COMPOSE_PROFILES=' '$CL/.env' && grep -qx 'up: .env has no Access pair' '$S/docker.log'"
  check "no secret in the output, the docker calls or the process list" test "$(leaks)" = 0
}
# what cf_up takes from a JSON line of `cloudflare up`, from the lib itself
pair_from() { bash -c "source '$SRC/scripts/lib/cloudflare.sh'; cf_access_from \"\$1\"" _ "{\"hostname\":\"talous.example.fi\",\"tunnelToken\":\"$TUN_TOKEN\",\"changed\":[]$1}"; }
t_cloudflare_access_pair_form() {
  check "a line with both values gives the pair" test "$(pair_from ",\"accessAud\":\"$AUD_TAG\",\"teamDomain\":\"$TEAM_DOMAIN\"")" = "$AUD_TAG $TEAM_DOMAIN"
  check "a line of an image before the check gives nothing" test -z "$(pair_from "")"
  # half a pair is no pair, and a value the app would refuse at start never reaches .env
  local bad
  for bad in "\"accessAud\":\"$AUD_TAG\"" "\"teamDomain\":\"$TEAM_DOMAIN\"" "\"accessAud\":\"\",\"teamDomain\":\"$TEAM_DOMAIN\"" "\"accessAud\":\"$AUD_TAG\",\"teamDomain\":\"\"" \
    "\"accessAud\":\"${AUD_TAG:1}\",\"teamDomain\":\"$TEAM_DOMAIN\"" "\"accessAud\":\"${AUD_TAG}0\",\"teamDomain\":\"$TEAM_DOMAIN\"" "\"accessAud\":\"${AUD_TAG^^}\",\"teamDomain\":\"$TEAM_DOMAIN\"" \
    "\"accessAud\":\"${AUD_TAG:1}g\",\"teamDomain\":\"$TEAM_DOMAIN\"" "\"accessAud\":\"$AUD_TAG\",\"teamDomain\":\"$TEAM_DOMAIN.example.fi\"" "\"accessAud\":\"$AUD_TAG\",\"teamDomain\":\"example.fi/$TEAM_DOMAIN\"" \
    "\"accessAud\":\"$AUD_TAG\",\"teamDomain\":\"a.$TEAM_DOMAIN\"" "\"accessAud\":\"$AUD_TAG\",\"teamDomain\":\"https://$TEAM_DOMAIN\"" "\"accessAud\":\"$AUD_TAG\",\"teamDomain\":\"$TEAM_DOMAIN:8443\"" \
    "\"accessAud\":\"$AUD_TAG\",\"teamDomain\":\"${TEAM_DOMAIN^^}\"" "\"accessAud\":\"$AUD_TAG\",\"teamDomain\":\"-koti.cloudflareaccess.com\"" "\"accessAud\":\"$AUD_TAG\",\"teamDomain\":\"kotitiimi.example.fi\""; do
    check "no pair from ${bad//\"/}" test -z "$(pair_from ",$bad")"
  done
}
# env_set from the lib itself, on a file of its own, with every rename counted
env_set_run() { bash -c "source '$SRC/scripts/lib/cloudflare.sh'; ENV_FILE=\$1; shift; mv() { echo x >>\"\$ENV_FILE.renames\"; command mv \"\$@\"; }; env_set \"\$@\"" _ "$@"; }
t_cloudflare_env_one_rename() {
  local f; f=$(mktemp "$TMPBASE/env.XXXXXX")
  printf 'A=1\nCF_ACCESS_AUD=old\nB=2\nCLOUDFLARE_NEW_HOST=x.example.fi\n' >"$f"
  env_set_run "$f" "CF_ACCESS_AUD=$AUD_TAG" "CF_ACCESS_TEAM_DOMAIN=$TEAM_DOMAIN" "CLOUDFLARE_TUNNEL_TOKEN=a=b=" CLOUDFLARE_NEW_HOST
  check "several keys are set and one is removed: a line that was there keeps its place, a new one goes last" \
    test "$(cat "$f")" = "$(printf 'A=1\nCF_ACCESS_AUD=%s\nB=2\nCF_ACCESS_TEAM_DOMAIN=%s\nCLOUDFLARE_TUNNEL_TOKEN=a=b=' "$AUD_TAG" "$TEAM_DOMAIN")"
  check "all of it in one rename: a stop leaves every change or none, never half an Access pair" test "$(wc -l <"$f.renames" 2>/dev/null)" = 1
  check "the file stays the owner's alone" test "$(stat -c %a "$f")" = 600
  rm -f "$f.renames"; env_set_run "$f" CF_ACCESS_AUD CF_ACCESS_TEAM_DOMAIN "B="
  check "the pair is removed in one rename, and a key set to nothing keeps its line" bash -c "! grep -q '^CF_ACCESS_' '$f' && grep -qx 'B=' '$f' && [[ \$(wc -l <'$f.renames') = 1 ]]"
  check "the installer writes the pair with the tunnel token, and takes the pair off with the host, in one call each" \
    bash -c "[[ \$(grep -c '^ *\(if\|else\).* env_set .*CF_ACCESS_AUD.*CF_ACCESS_TEAM_DOMAIN.*CLOUDFLARE_TUNNEL_TOKEN=' '$SRC/scripts/lib/cloudflare.sh') = 2 && \$(grep -c '^ *env_set .CLOUDFLARE_NEW_HOST=.*CF_ACCESS_AUD CF_ACCESS_TEAM_DOMAIN' '$SRC/scripts/lib/cloudflare.sh') = 1 ]]"
  rm -f "$f" "$f.renames"
}
t_cloudflare_access_check_by_hand() {
  # a tunnel made by hand: the installer asks Cloudflare nothing, so the pair is the user's own lines in .env
  cf_world; rm -f "$(cf_file)"; XENV=("TALOUS_TUNNEL_TOKEN=$MANUAL_TOKEN")
  cf_install --yes --access tunnel --domain talous.example.fi --name home; why
  check "a tunnel made by hand gets no pair from the installer" bash -c "[[ $INSTALL_RC = 0 ]] && ! grep -q '^CF_ACCESS_' '$CL/.env'"
  touch "$S/container"; printf 'CF_ACCESS_AUD=%s\nCF_ACCESS_TEAM_DOMAIN=%s\n' "$AUD_TAG" "$TEAM_DOMAIN" >>"$CL/.env"; XENV=()
  cf_install --reconfigure --yes --access tunnel --domain talous.example.fi; why
  check "the pair its user wrote stays through a rewrite of .env while the address stays" bash -c "[[ $INSTALL_RC = 0 && \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 ]] && grep -qx 'CF_ACCESS_AUD=$AUD_TAG' '$CL/.env' && grep -qx 'CF_ACCESS_TEAM_DOMAIN=$TEAM_DOMAIN' '$CL/.env' && [[ \$(grep -c '^CF_ACCESS_' '$CL/.env') = 2 ]] && grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$MANUAL_TOKEN' '$CL/.env'"
  cf_install --reconfigure --yes --access tunnel --domain koti.example.fi; why
  check "another address is another Access application: the pair is dropped" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qx 'DOMAIN=koti.example.fi' '$CL/.env' && ! grep -q '^CF_ACCESS_' '$CL/.env'"
}
t_cloudflare_host_of_another_copy() {
  # a second folder or machine with the same file: it must not take over the first copy's host
  cf_world
  cf_install --yes --access tunnel --name home
  check "--yes without --domain does not pick talous.<base domain>: refused, says --domain, nothing made" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF -- '--domain talous.example.fi' '$W/install.out' && [[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 && ! -e '$CL/.env' ]]"
  cf_world; echo talous.example.fi >"$S/made"   # the first copy's host
  cf_install --yes --access tunnel --name home --domain talous.example.fi
  check "a host another copy made: up --new is refused and the install stops, naming --domain" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qxF '$(up_line home talous.example.fi --new)' '$S/docker.log' && grep -qF 'may be another copy' '$W/install.out' && grep -qF -- '--domain' '$W/install.out'"
  check "nothing of the other copy reaches this one: no token, no container" bash -c "grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=' '$CL/.env' && ! grep -q '^compose up' '$S/docker.log' && grep -qx 'CLOUDFLARE_NEW_HOST=talous.example.fi' '$CL/.env'"
  : >"$S/docker.log"
  cf_install --yes
  check "a run without flags asks with --new again, and is refused again" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qxF '$(up_line home talous.example.fi --new)' '$S/docker.log' && ! grep -qxF '$(up_line home talous.example.fi)' '$S/docker.log' && grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=' '$CL/.env'"
  : >"$S/docker.log"
  cf_install --cloudflare-down
  check "--cloudflare-down does not remove the other copy's host" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'is not this copy' '$W/install.out' && ! grep -q '^run ' '$S/docker.log' && grep -qx talous.example.fi '$S/made'"
  : >"$S/docker.log"
  cf_install --reconfigure --yes --access tunnel --domain home.example.fi; why
  check "with an address of its own the copy is installed" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qxF '$(up_line home home.example.fi --new)' '$S/docker.log' && grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$TUN_TOKEN' '$CL/.env' && ! grep -q '^CLOUDFLARE_NEW_HOST=' '$CL/.env'"
  # a copy that switches its own domain install to the tunnel: the host was not made by Cloudflare for it
  cf_world
  cf_install --yes --access local --name home; sed -i 's/^DOMAIN=.*/DOMAIN=talous.example.fi/' "$CL/.env"; touch "$S/container"; : >"$S/docker.log"
  cf_install --reconfigure --yes --access tunnel
  check "the address in .env of an install without the tunnel is still asked for with --new" logged "$(up_line home talous.example.fi --new)"
}
t_cloudflare_file_and_its_folders() {
  local dir
  for dir in .config .config/omatalous; do
    cf_world; chmod g+w "$W/home/$dir"
    cf_install --yes --access tunnel --name home --domain talous.example.fi
    check "home/$dir writable by the group: refused, says chmod go-w, nothing made" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF '$dir can be changed by others' '$W/install.out' && grep -qF 'chmod go-w' '$W/install.out' && [[ \$(grep -c '^run ' '$S/docker.log' 2>/dev/null) = 0 && ! -e '$CL/.env' ]]"
    cf_world; chmod o+w "$W/home/$dir"
    cf_install --yes --access tunnel --name home --domain talous.example.fi
    check "home/$dir writable by others: refused" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'can be changed by others' '$W/install.out'"
  done
  cf_world; rm -f "$(cf_file)"; mkdir -m 700 "$(cf_file)"
  cf_install --yes --access tunnel --name home --domain talous.example.fi
  check "a folder in the file's place is refused" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'cloudflare.env is not a plain file' '$W/install.out'"
  cf_world; rm -f "$(cf_file)"; mkfifo -m 600 "$(cf_file)"
  cf_install --yes --access tunnel --name home --domain talous.example.fi
  check "a pipe in the file's place is refused without waiting on it" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'cloudflare.env is not a plain file' '$W/install.out'"
  check "the file is opened once and read from that descriptor, never again by its path" bash -c "[[ \$(grep -c '<\"\$CF_FILE\"' '$SRC/scripts/lib/cloudflare.sh') = 1 ]] && grep -q 'exec {fd}<\"\$CF_FILE\"' '$SRC/scripts/lib/cloudflare.sh' && grep -q 'read -r -u \"\$fd\" line' '$SRC/scripts/lib/cloudflare.sh'"
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
  cf_world; stub_sudo; no_docker; touch "$S/no-access"; temp_dir
  # Docker's install, the docker group, the access choice, the address and the emails: all asked before anything is installed
  printf 'y\ny\n3\ntalous.example.fi\nmother@example.fi\n' >"$W/answers"; INPUT=$W/answers
  cf_install --reconfigure --name home; why
  check "no Docker on the host, every answer given: the install succeeds" installed
  check "Docker's install script ran once, after the last answer and before .env was written" bash -c "[[ \$(grep -c '^docker-install\$' '$S/order.log') = 1 ]] && grep -qx asked-before '$S/order.log' && ! grep -qx env-before '$S/order.log'"
  check "it came from get.docker.com, over curl, once" test "$(grep -c '^curl https://get.docker.com$' "$S/curl.log")" = 1
  check "the docker group was agreed to with the other answers: one usermod" bash -c "[[ \$(wc -l <'$S/usermod.log') = 1 ]] && grep -qx -- '-aG docker $ME' '$S/usermod.log'"
  check "the second run, started by sudo as the user, took the answers along: nothing was asked twice" bash -c "grep -qE '^-u $ME env TALOUS_REEXEC=1 TALOUS_ANSWERS=[^ ]+ $CL/scripts/install.sh --reconfigure --name home\$' '$S/sudo.log' && grep -qx 'DOMAIN=talous.example.fi' '$CL/.env' && grep -qx 'CLOUDFLARE_ACCESS_EMAILS=mother@example.fi' '$CL/.env' && grep -qx 'COMPOSE_PROFILES=tunnel' '$CL/.env'"
  check "the answers file is gone" test "$(temp_left)" = 0
  check "no secret in the output, the docker calls or the process list" test "$(leaks)" = 0
  check "no hint names newgrp" bash -c "! grep -qi newgrp '$W/install.out'"
  # a no to the install, and a no to the group
  cf_world; stub_sudo; no_docker; printf 'n\n' >"$W/answers"; INPUT=$W/answers
  cf_install --reconfigure --name home
  check "no to Docker's install: it stops with the manual command and runs nothing" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'Docker is missing. Install it:' '$W/install.out' && [[ ! -e '$S/order.log' ]]"
  cf_world; stub_sudo; no_docker; printf 'y\nn\n' >"$W/answers"; INPUT=$W/answers
  cf_install --reconfigure --name home
  check "no to the group: it stops before Docker is installed and says what to run" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'without the docker group' '$W/install.out' && [[ ! -e '$S/order.log' ]]"
}
t_docker_group_without_sg() {
  cf_world; stub_sudo; touch "$S/no-access"; temp_dir
  check "world: the host has no sg" bash -c "! PATH='$S/bin:$SYS' command -v sg"
  cf_install --yes --access local --name home; why
  check "no sg, the user not in the docker group: the install succeeds" installed
  check "the user is added to the group with sudo -n" grep -qx -- "-n usermod -aG docker $ME" "$S/sudo.log"
  check "the second run is sudo -n -u USER env TALOUS_REEXEC=1 <script> <args>" bash -c "grep -qE '^-n -u $ME env TALOUS_REEXEC=1 TALOUS_ANSWERS=[^ ]+ $CL/scripts/install.sh --yes --access local --name home\$' '$S/sudo.log'"
  check "the output says it goes on in a new session, and the app is started there" said 'Continuing in a new session with the docker group' 'The app is running.'
  check "the answers file is gone" test "$(temp_left)" = 0
  # with sg the old way stays: sg docker -c, and sudo only adds the group
  cf_world; stub_sudo; stub_sg; touch "$S/no-access"
  cf_install --yes --access local --name home; why
  check "with sg: the second run is sg docker -c <script and args>" bash -c "[[ \$(wc -l <'$S/sg.log') = 1 ]] && grep -qE '^docker -c .*install.sh --yes --access local --name home' '$S/sg.log' && ! grep -q -- ' -u ' '$S/sudo.log'"
  check "with sg: the install succeeds" installed
}
t_no_newgrp_hint() {
  check "no script names newgrp" bash -c "! grep -n newgrp '$SRC/scripts/install.sh' '$SRC/scripts/update.sh' '$SRC/scripts/doctor.sh'"
  check "update.sh and doctor.sh say to open the SSH connection again" bash -c "grep -qF 'close the SSH connection and open it again' '$SRC/scripts/update.sh' && grep -qF 'close the SSH connection and open it again' '$SRC/scripts/doctor.sh' && grep -qF 'sulje SSH-yhteys' '$SRC/scripts/doctor.sh'"
  # a member of the group whose login lacks it, and no way to start a new session: neither sg nor sudo
  cf_world; touch "$S/no-access"; echo "$ME" >"$S/docker-members"; echo 4242 >"$S/docker-gid"; temp_dir
  cf_install --yes --access local --name home
  check "no way works: the install stops and says to open the SSH connection again, then to run it again" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'Close the SSH connection and open it again (or log out and in), then run ./scripts/install.sh again.' '$W/install.out'"
  check "the message names no newgrp" bash -c "! grep -qi newgrp '$W/install.out'"
  # sudo is there and refuses: the same message, nothing left behind
  cf_world; stub_sudo; touch "$S/no-access" "$S/sudo-refuses"; echo "$ME" >"$S/docker-members"; echo 4242 >"$S/docker-gid"; temp_dir
  cf_install --yes --access local --name home
  check "sudo refuses: the same message" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'Close the SSH connection and open it again' '$W/install.out' && ! grep -qi newgrp '$W/install.out'"
  check "sudo refuses: the answers file is removed" test "$(temp_left)" = 0
  check "sudo refuses: it was asked once, and nothing was started" bash -c "[[ \$(grep -c . '$S/sudo.log') = 1 ]] && ! grep -q '^compose up' '$S/docker.log'"
}
t_answers_file_only_for_a_reexec() {
  cf_world; temp_dir; printf 'PORT=8123\nACCESS=2\n' >"$W/answers.in"
  XENV+=("TALOUS_ANSWERS=$W/answers.in")
  cf_install --yes --access local --name home; why
  check "TALOUS_ANSWERS without TALOUS_REEXEC is not read: the port is not 8123 and the file stays" bash -c "! grep -qx 'HOST_PORT=8123' '$CL/.env' && [[ -s '$W/answers.in' ]]"
  cf_world; temp_dir; printf 'PORT=8123\n' >"$W/real.in"; ln -s "$W/real.in" "$W/answers.in"
  XENV+=("TALOUS_REEXEC=1" "TALOUS_ANSWERS=$W/answers.in")
  cf_install --yes --access local --name home; why
  check "a link is not read either" bash -c "! grep -qx 'HOST_PORT=8123' '$CL/.env' && [[ -s '$W/real.in' ]]"
  cf_world; temp_dir; printf 'PORT=8123\nOPS_HELPER=false\nBOGUS=1\n' >"$W/answers.in"
  XENV+=("TALOUS_REEXEC=1" "TALOUS_ANSWERS=$W/answers.in")
  cf_install --yes --name home --access local; why
  check "a re-exec reads its file once, takes the names it knows and deletes it" bash -c "grep -qx 'HOST_PORT=8123' '$CL/.env' && [[ ! -e '$W/answers.in' ]]"
}

# the settings file made by the installer: a cloudflare-setup.sh that logs and, unless S/setup-fails, writes the file the
# way the real one does (the real one has its own suite)
cf_setup_stub() {
  cp "$(cf_file)" "$S/cf-saved"; rm -f "$(cf_file)"
  cat >"$CL/scripts/cloudflare-setup.sh" <<'EOF'
#!/usr/bin/env bash
echo "setup ran: $*" >>"$S/setup.log"
[[ ! -e $S/setup-fails ]] || { echo "stub: the setup failed" >&2; exit 1; }
mkdir -p "$HOME/.config/omatalous"; cp "$S/cf-saved" "$HOME/.config/omatalous/cloudflare.env"; chmod 600 "$HOME/.config/omatalous/cloudflare.env"
EOF
  chmod +x "$CL/scripts/cloudflare-setup.sh"
}
t_cloudflare_setup_runs_when_missing() {
  cf_world; cf_setup_stub
  printf 'y\n\nmother@example.fi\n' >"$W/answers"; INPUT=$W/answers
  cf_install --access tunnel --name home; why
  check "no settings file, choice 3: the installer runs cloudflare-setup.sh, once, without arguments" bash -c "[[ \$(grep -c . '$S/setup.log') = 1 ]] && grep -qx 'setup ran: ' '$S/setup.log'"
  check "it shows where Cloudflare's token is made and lists the permissions" said 'https://dash.cloudflare.com/profile/api-tokens' 'Cloudflare Tunnel Edit' 'Zone: Zone Read'
  check "the link promises no filled-in form" bash -c "! grep -q permissionGroupKeys '$W/install.out'"
  check "it goes on with the file it made: Cloudflare makes the tunnel for the answers" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qxF '$(up_line home talous.example.fi --new)' '$S/docker.log' && grep -qxF 'emails: mother@example.fi' '$S/docker.log'"
  check ".env has the token the command returned" env_has "CLOUDFLARE_TUNNEL_TOKEN=$TUN_TOKEN"
  check "no secret in the output, the docker calls or the process list" test "$(leaks)" = 0
  # refused: the manual path as it was
  cf_world; cf_setup_stub; printf 'n\n' >"$W/answers"; INPUT=$W/answers
  cf_install --access tunnel --name home --domain talous.example.fi
  check "a no: the setup is not run and the manual path asks for the tunnel token" bash -c "[[ ! -e '$S/setup.log' && $INSTALL_RC != 0 ]] && grep -qF 'The tunnel token is missing' '$W/install.out'"
  # failed: the same
  cf_world; cf_setup_stub; touch "$S/setup-fails"; printf 'y\n' >"$W/answers"; INPUT=$W/answers
  cf_install --access tunnel --name home --domain talous.example.fi
  check "a failed setup: it says so and the manual path goes on" bash -c "[[ \$(grep -c . '$S/setup.log') = 1 && $INSTALL_RC != 0 ]] && grep -qF 'The Cloudflare setup did not finish' '$W/install.out' && grep -qF 'The tunnel token is missing' '$W/install.out'"
  # nothing is asked with --yes, and a tunnel made by hand does not want the file
  cf_world; cf_setup_stub
  cf_install --yes --access tunnel --name home --domain talous.example.fi
  check "--yes: the setup is not run" bash -c "[[ ! -e '$S/setup.log' && $INSTALL_RC != 0 ]]"
  cf_world; cf_setup_stub; printf 'y\n' >"$W/answers"; INPUT=$W/answers; XENV=("TALOUS_TUNNEL_TOKEN=$MANUAL_TOKEN")
  cf_install --access tunnel --name home --domain talous.example.fi
  check "a tunnel token given: the setup is not run" bash -c "[[ ! -e '$S/setup.log' && $INSTALL_RC = 0 ]]"
  # a file that is there is the file's business (cf_load), not the setup's
  cf_world; cf_setup_stub; cp "$S/cf-saved" "$(cf_file)"; chmod 600 "$(cf_file)"; printf '\n\n' >"$W/answers"; INPUT=$W/answers
  cf_install --access tunnel --name home
  check "the file exists: the setup is not run" bash -c "[[ ! -e '$S/setup.log' && $INSTALL_RC = 0 ]]"
}

stub_qrencode() { # records its arguments and what it was given on stdin
  printf '#!/usr/bin/env bash\necho "$*" >>"$S/qr.args"\ncat >"$S/qr.in"\necho QR-BLOCK\n' >"$S/bin/qrencode"
  chmod +x "$S/bin/qrencode"
}
t_qr_when_qrencode() {
  cf_world; stub_qrencode
  cf_install --yes --access tunnel --name home --domain talous.example.fi; why
  check "the install succeeds and prints the setup link" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qF 'Set up: ' '$W/install.out'"
  check "qrencode is run once, with the setup link on its standard input" bash -c "[[ \$(grep -c . '$S/qr.args') = 1 ]] && [[ \$(cat '$S/qr.in') = 'https://talous.example.fi/#koodi=k3f9-2mxq-8hzt-p4wa' ]]"
  check "the one-time code is not in qrencode's arguments, so not in the process list" bash -c "! grep -q 'k3f9' '$S/qr.args'"
  check "the code is printed after the link, and no hint to install qrencode is shown" bash -c "grep -qF QR-BLOCK '$W/install.out' && ! grep -qF 'apt install qrencode' '$W/install.out'"
}
t_qr_absent_is_quiet() {
  cf_world
  cf_install --yes --access tunnel --name home --domain talous.example.fi; why
  check "no qrencode: the install succeeds and prints the setup link" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qF 'Set up: ' '$W/install.out' && grep -qF 'https://talous.example.fi/#koodi=k3f9-2mxq-8hzt-p4wa' '$W/install.out'"
  check "one line says how to get the code, and it is no warning" bash -c "[[ \$(grep -c 'apt install qrencode' '$W/install.out') = 1 ]] && ! grep 'qrencode' '$W/install.out' | grep \$'\\e\\[33m' >/dev/null"
  check "the script installs nothing for it" bash -c "! grep -qiE 'installing (qrencode|jq)' '$W/install.out' && ! grep -q qrencode '$S/docker.log'"
}

pid_in_tokens() { [[ $API_TOKEN == *_$$_* && $(printf '%s' "$TUN_TOKEN" | base64 -d) == *example$$* && $(printf '%s' "$MANUAL_TOKEN" | base64 -d) == *token$$* ]]; }
# a second copy of the suite runs while this one watches the process list: its token is in an argument list on purpose
# (t_cloudflare_watcher_sees_argv) and this run's check must not match it
t_other_run_is_not_seen() {
  cf_world
  watch_ps
  # the other run's command stays until this run has seen its token and this run's watcher has sampled once more
  WATCH_HOLD="$W/other.hold" bash "$HERE/install.test.sh" t_cloudflare_watcher_sees_argv >"$W/other.out" 2>&1 &
  local other=$! found=0 rc=0 _
  for _ in $(seq 1 600); do
    if ps -eo args 2>/dev/null | grep -E 'cfapi_example_[0-9]+_0123' | grep -vF "cfapi_example_${$}_" | grep . >/dev/null; then found=1; break; fi
    sleep 0.05
  done
  touch "$W/ps.begun"; until [[ -e $W/ps.seen ]]; do sleep 0.01; done
  touch "$W/other.hold"
  wait "$other" || rc=$?
  unwatch_ps
  check "the other run's token was in the process list while this run watched" test "$found" = 1
  check "this run's watcher did not match it" test ! -s "$W/ps.hits"
  check "the other run passed" test "$rc" = 0
  check "the tokens differ between runs: the pid is in each" pid_in_tokens
}

# the release an install builds: the vX.Y.Z tag at HEAD when the checkout sits on one (a bootstrap clone holds every tag,
# a pre-release among them), else the newest tag as before
t_tag_at_head() {
  cf_world
  git -C "$CL" tag v1.0.0; git -C "$CL" tag v1.0.1-rc1
  git -C "$CL" commit -q --allow-empty -m later; git -C "$CL" tag v1.1.0
  git -C "$CL" checkout -q v1.0.0
  printf '#!/bin/sh\nexit 7\n' >"$S/bin/curl"; chmod +x "$S/bin/curl" # a first install asks GitHub which release is out: no answer here
  cf_install --yes --access local --name home
  check "HEAD is at v1.0.0, a pre-release tag is on it and v1.1.0 is newer: the release is v1.0.0" said 'Channel: release v1.0.0'
  check "the newer tag and the pre-release are not taken" bash -c "! grep -qE 'release v1\\.1\\.0|rc1' '$W/install.out'"
}
t_newest_tag_when_not_at_head() {
  cf_world
  git -C "$CL" commit -q --allow-empty -m later; git -C "$CL" tag v1.1.0
  git -C "$CL" checkout -q HEAD~1
  cf_install --yes --access local --name home; why
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
