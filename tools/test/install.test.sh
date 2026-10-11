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
# and plays the app image's `cloudflare up` and `cloudflare down` (CF1's command): it answers `up` with the JSON line,
# or with exit 3 or 4 (S/cf-mode), and logs the emails it was given. Names and addresses are made up.
API_TOKEN=cfapi_example_0123456789abcdefghij
TUN_TOKEN=eyJhIjoiZXhhbXBsZSIsInQiOiJleGFtcGxlLXR1bm5lbCIsInMiOiJleGFtcGxlIn0=
MANUAL_TOKEN=eyJtYW51YWwiOiJ0b2tlbiJ9
EMAILS="anna@example.fi,pekka@example.fi"   # the file's list, the default of every copy
XENV=(); INPUT=/dev/null
cf_file() { echo "$W/home/.config/omatalous/cloudflare.env"; }
cf_world() { # a first install: no .env yet, the Cloudflare file (mode 600), a docker for the whole install
  new_host; rm -f "$CL/.env"; XENV=(); INPUT=/dev/null
  mkdir -p "$W/home/.config/omatalous"; chmod 755 "$W/home/.config"; chmod 700 "$W/home/.config/omatalous"
  printf '# made up\nCLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ACCESS_EMAILS=%s\nCLOUDFLARE_BASE_DOMAIN=example.fi\n' "$API_TOKEN" "$EMAILS" >"$(cf_file)"
  chmod 600 "$(cf_file)"
  printf '%s' "$API_TOKEN" >"$S/api-token"; printf '%s' "$TUN_TOKEN" >"$S/tunnel-token"
  printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' "$TUN_TOKEN" >"$S/envline"; printf '%s\n%s\n' "$API_TOKEN" "$TUN_TOKEN" >"$W/secrets"
  cat >"$S/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$S/docker.log"
case $1 in
  version) echo 27.0.0 ;;
  container) exit 1 ;;
  compose)
    case $2 in
      version) echo 2.29.0 ;;
      up) if grep -qxFf "$S/envline" .env; then echo "up: .env has the tunnel token" >>"$S/docker.log"; else echo "up: .env has no tunnel token" >>"$S/docker.log"; fi ;;
      ps) [[ -e $S/container ]] && echo abc123 ;;
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
    # S/made: the hosts Cloudflare has a tunnel for (CF1's up --new stops on those before it writes)
    if [[ $* == *" cloudflare down "* ]]; then sed -i "/^$host\$/d" "$S/made" 2>/dev/null; echo "Removed the tunnel of $host" >&2; exit 0; fi
    if [[ $* == *" --new" ]] && grep -qxF "$host" "$S/made" 2>/dev/null; then echo "$host is already set up in Cloudflare" >&2; exit 3; fi
    grep -qxF "$host" "$S/made" 2>/dev/null || echo "$host" >>"$S/made"
    echo "Tunnel ready for $host" >&2
    printf '{"hostname":"%s","tunnelToken":"%s","changed":["tunnel","dns","access"]}\n' "$host" "$(cat "$S/tunnel-token")" ;;
esac
exit 0
EOF
  chmod +x "$S/bin/docker"
}
# the secrets in any process's argument list while the install runs (ps shows arguments, not the environment)
watch_ps() { rm -f "$W/ps.stop"; : >"$W/ps.hits"; ( while [[ ! -e $W/ps.stop ]]; do ps -eo args 2>/dev/null | grep -F -f "$W/secrets" >>"$W/ps.hits"; sleep 0.01; done ) & WATCH=$!; }
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

t_cloudflare_watcher_sees_argv() {
  cf_world
  watch_ps; bash -c 'sleep 0.5; true' "$API_TOKEN"; unwatch_ps
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
  cf_install --reconfigure --yes --access tunnel; why
  check "--reconfigure keeps the address and the copy's list, and asks Cloudflare again (idempotent)" bash -c "grep -qxF '$(up_line home talous.example.fi)' '$S/docker.log' && grep -qxF 'emails: mother@example.fi' '$S/docker.log'"
  check "the token and the list are in .env after it" bash -c "grep -qx 'CLOUDFLARE_TUNNEL_TOKEN=$TUN_TOKEN' '$CL/.env' && grep -qx 'CLOUDFLARE_ACCESS_EMAILS=mother@example.fi' '$CL/.env'"
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
  check ".env is left as it is, but for the line that says the host is not this copy's any more" bash -c "diff <(grep -v '^CLOUDFLARE_NEW_HOST=' '$CL/.env') '$W/env.before' && grep -qx 'CLOUDFLARE_NEW_HOST=talous.example.fi' '$CL/.env'"
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
  cf_install --cloudflare-down
  check "a refusal from Cloudflare fails the command" bash -c "[[ $INSTALL_RC != 0 ]] && grep -qF 'Cloudflare refused' '$W/install.out'"
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

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
