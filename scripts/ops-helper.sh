#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous maintenance helper. Runs on the host, starts once a minute (systemd user timer or cron, set up by
# ./scripts/install.sh) and waits for a press for most of it, so a request starts within seconds. One per instance, in the clone.
#
# The app only writes rows ("update", "backup", ...) into its database. This script asks the app for the
# oldest row through `docker compose exec ... ops poll`, checks it against a fixed list, runs one of our own
# scripts and reports the result back through `ops report`. Nothing from the database reaches a shell: the
# row is accepted only if the whole poll answer matches one exact shape, and the action is picked by a
# `case` with a refusing default. Version 5 knows twelve actions: check-update, update, rollback, backup, restart, doctor,
# logs, prune, helper-renew, access (scripts/lib/ops-access.sh), prerelease-on and prerelease-off. None takes parameters.
#
# Trust: the helper user is in the docker group, which is root on the host, so what the helper installs is what matters.
# A release install takes only a version the GitHub Releases API names, only if it is a semver step up from the running
# one, and scripts/update.sh pulls that image, checks its cosign signature against this project's release workflow,
# takes the database copy right before the switch, health-checks and goes back by itself on failure. A source install
# (no release yet, or TALOUS_CHANNEL=source) runs the same update.sh on the source, after checks here: the remote and
# branch are the ones pinned in ops/policy, history only moves forward, the tree is clean, the new docker-compose.yml
# passes a policy check, and when ops/allowed_signers exists the new commit must be signed by one of its keys.
#
# Refuses to run as root, and when this script, scripts/, ops/ or the clone are writable by others. The
# environment is rebuilt from scratch. .env is read as data and refused if it holds anything odd. One run at
# a time (flock). Every action has a timeout. The host journal (ops/journal) is the truth about what has been
# done, so a database restored from a backup cannot make an update run twice. Output is scrubbed and capped.
# If an update and its own rollback both fail, ops/RECOVERY.txt holds the exact commands.
#
#   ops-helper.sh            one tick (what the timer runs)
#   ops-helper.sh --version  prints the protocol version
#   ops-helper.sh --self-test  runs self_test (scripts/lib/ops-selftest.sh), the only argument it takes
# ──────────────────────────────────────────────────────────────────────────────
OPS_HELPER_VERSION=5
set -u -o pipefail
set +x

# ── 0. a clean environment, before anything else ────────────────────────────
if [[ ${TALOUS_OPS_CLEAN:-} != 1 ]]; then
  if [[ ${1:-} == --version ]]; then echo "$OPS_HELPER_VERSION"; exit 0; fi
  if [[ $(id -u) -eq 0 ]]; then
    echo "The maintenance helper does not run as root." >&2; exit 1
  fi
  clean=(HOME="${HOME:-/}" PATH=/usr/local/bin:/usr/bin:/bin LANG=C TALOUS_OPS_CLEAN=1)
  # the user's systemd session, for doctor's look at the timer (derived from the uid, not taken from outside)
  uid=$(id -u)
  clean+=(USER="$(id -un)" LOGNAME="$(id -un)")
  [[ -d /run/user/$uid ]] && clean+=(XDG_RUNTIME_DIR="/run/user/$uid")
  # a rootless Docker socket, and only a unix one
  [[ ${DOCKER_HOST:-} =~ ^unix:///[A-Za-z0-9_./-]+$ ]] && clean+=(DOCKER_HOST="$DOCKER_HOST")
  # test hooks, only when a test asks for them
  if [[ ${OPS_TEST:-} == 1 ]]; then
    clean+=(OPS_TEST=1 PATH="$PATH")
    for v in OPS_STUB_DIR OPS_T_UPDATE OPS_T_ROLLBACK OPS_T_BACKUP OPS_T_RESTART OPS_T_DOCTOR OPS_T_CHECK OPS_T_LOGS OPS_T_PRUNE OPS_T_RENEW OPS_T_ACCESS OPS_T_SELFTEST OPS_T_ADDRESS OPS_T_WAKE OPS_T_WAKEEND OPS_T_PROGRESS; do
      [[ -z ${!v:-} ]] || clean+=("$v=${!v}")
    done
  fi
  exec /usr/bin/env -i "${clean[@]}" /bin/bash "$0" "$@"
fi
unset TALOUS_OPS_CLEAN
umask 077

SELF=$(readlink -f "${BASH_SOURCE[0]}"); ROOT=$(dirname "$(dirname "$SELF")"); LIB=scripts/lib; COPY=()
case ${1:-} in
  "") ;;
  --version) echo "$OPS_HELPER_VERSION"; exit 0 ;;
  --self-test) (($# == 1)) || { echo "Usage: ops-helper.sh" >&2; exit 2; } ;;
  # --root DIR: this file runs for the clone DIR. Taken only by the launcher's last good copy of the helper, never by a clone's
  # helper (scripts/ops-launcher.sh). The copy loads the libs beside itself, and check_permissions covers it and the launcher's folder.
  --root)
    [[ $# == 2 && $2 =~ ^/[A-Za-z0-9_./-]+$ && -d $2/scripts && -e $2/.git && $SELF =~ ^(/[A-Za-z0-9_./-]+/omatalous/[a-z0-9][a-z0-9_-]*)/last-good/scripts/ops-helper\.sh$ && -f ${BASH_REMATCH[1]}/launcher.sh ]] || { echo "Usage: ops-helper.sh" >&2; exit 2; }
    LIB=$ROOT/scripts/lib; COPY=("${BASH_REMATCH[1]}" "${BASH_REMATCH[1]}/launcher.sh" "$ROOT" "$ROOT/scripts" "$LIB" "$LIB"/*.sh); ROOT=$(readlink -f "$2") ;;
  *) echo "Usage: ops-helper.sh" >&2; exit 2 ;;
esac
cd "$ROOT" || exit 1
OPS=ops
DEFAULT_INSTANCE=banking-app
ACTIONS="update rollback backup restart doctor check-update logs prune helper-renew access prerelease-on prerelease-off"
NODE=(node --disable-warning=ExperimentalWarning)

# timeouts in seconds (the spec table); a test may shorten them
t_for() { local v=OPS_T_$2; if [[ ${OPS_TEST:-} == 1 && -n ${!v:-} ]]; then echo "${!v}"; else echo "$1"; fi; }
T_UPDATE=$(t_for 1200 UPDATE)
# shellcheck disable=SC2034 # read by act_backup (lib/ops-actions.sh)
T_BACKUP=$(t_for 300 BACKUP)
# shellcheck disable=SC2034 # read by act_restart (lib/ops-actions.sh)
T_RESTART=$(t_for 180 RESTART)
# shellcheck disable=SC2034 # read by run_doctor (lib/ops-actions.sh)
T_DOCTOR=$(t_for 120 DOCTOR)
# shellcheck disable=SC2034 # read by fetch_release and check_update (lib/ops-release.sh)
T_CHECK=$(t_for 60 CHECK)
# shellcheck disable=SC2034 # read by rollback_run (lib/ops-watchdog.sh)
T_ROLLBACK=$(t_for 600 ROLLBACK)
# shellcheck disable=SC2034 # read by act_logs (lib/ops-actions.sh)
T_LOGS=$(t_for 60 LOGS)
# shellcheck disable=SC2034 # read by act_prune (lib/ops-actions.sh)
T_PRUNE=$(t_for 300 PRUNE)
# shellcheck disable=SC2034 # read by act_helper_renew (lib/ops-actions.sh)
T_RENEW=$(t_for 120 RENEW)
LOG_CAP=262144
# what store_result keeps of a log: the last lines and bytes (the logs action holds up to three services)
KEEP_LINES=200; KEEP_BYTES=16384

# ── logging ─────────────────────────────────────────────────────────────────
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() {
  local line; line="$(now_iso) $*"
  printf '%s\n' "$line" >&2
  if [[ -d $OPS && -w $OPS ]]; then
    # one old file, so the log cannot grow without limit
    if [[ -f $OPS/helper.log && $(stat -c %s "$OPS/helper.log" 2>/dev/null || echo 0) -gt 262144 ]]; then mv -f "$OPS/helper.log" "$OPS/helper.log.1"; fi
    printf '%s\n' "$line" >>"$OPS/helper.log" 2>/dev/null || true
  fi
}

# ── data helpers: .env, ops/policy and backups/.last-update (update.sh's record of its update) are read, never sourced ──
kv_get() { # kv_get FILE KEY: the value after the first = of the last line that starts with KEY=. KEY is a plain name, matched as text
  [[ -f $1 ]] || return 0
  local all='' line v found=0
  # a file with a NUL byte in it reads as nothing (grep took it for binary data and printed no line); read -d '' stops at a NUL
  ! IFS= read -r -d '' all <"$1" || return 0
  while IFS= read -r line; do
    [[ $line == "$2="* ]] && { v=${line#*=}; found=1; }
  done <<<"$all"
  ((found == 0)) || printf '%s\n' "$v"; return 0
}
env_get() { kv_get .env "$1"; }
pol_get() { kv_get "$OPS/policy" "$1"; }
last_update() { kv_get backups/.last-update "$1"; }

# JSON string body from stdin (no surrounding quotes). Control characters are already gone.
json_body() { awk 'BEGIN { ORS = "" } { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); if (NR > 1) print "\\n"; print }'; }
json_str() { printf '"'; printf '%s' "$1" | json_body; printf '"'; }

# Output scrub (spec 1.5, threat model R24): ANSI and control characters out, lines that look like secrets
# dropped, bearer tokens and JWTs (Enable Banking) and long token-like runs hidden, then the last KEEP_LINES lines
# and KEEP_BYTES bytes (200 and 16 KiB, more for logs). Reads stdin.
scrub_out() {
  sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g' \
    | tr -d '\000-\011\013-\037\177' \
    | grep -viE 'TOKEN|SECRET|PASSWORD|Authorization|BEGIN .*KEY|api[_-]?key|private[_-]?key' \
    | sed -E 's/Bearer +[^ ]+/Bearer [hidden]/Ig; s/eyJ[A-Za-z0-9_-]*(\.[A-Za-z0-9_-]*){0,2}/[hidden]/g' \
    | sed -E 's/[A-Za-z0-9_=-]{40,}/[hidden]/g' \
    | tail -n "$KEEP_LINES" | tail -c "$KEEP_BYTES"
}

# ── checks before anything is read or run ───────────────────────────────────
# Every path of the list that exists (a missing one is skipped) must be owned by this user and not writable by group or
# others. One stat for all of them, each record ended by NUL so that no file name can pass for another path's record.
# A path stat printed no record for (it vanished, or cannot be read) is unsafe, and the first unsafe path in list order is
# the one named. The user id comes from id, not from $EUID: bash takes EUID from the environment when one is passed.
check_permissions() {
  local p me o m n r rec i=0 ex=() recs=()
  me=$(id -u)
  for p in . .git .git/config scripts "$SELF" scripts/*.sh scripts/lib scripts/lib/*.sh "$OPS" .env "$OPS/policy" "$OPS/channel" "$OPS/journal" "$OPS/run" backups/.last-update; do
    [[ -e $p ]] && ex+=("$p")
  done
  for p in ${COPY[@]+"${COPY[@]}"}; do [[ -e $p ]] && ex+=("$p"); done
  ((${#ex[@]})) || return 0
  while IFS= read -r -d '' rec; do recs+=("$rec"); done < <(stat --printf '%u %a %n\0' -- "${ex[@]}" 2>/dev/null)
  for p in "${ex[@]}"; do
    rec=${recs[i++]-}; o=${rec%% *}; r=${rec#* }; m=${r%% *}; n=${r#* }
    # a name that starts with a dash was refused before (stat took it for an option), and still is
    if [[ $p != -* && $o =~ ^[0-9]+$ && $m =~ ^[0-7]+$ && $n == "$p" && $o == "$me" ]] && (((8#$m & 8#022) == 0)); then continue; fi
    log "File permissions: $p is not safe (owner or write access). The helper does not run."; return 1
  done
  return 0
}
# The parts of a tick that live in scripts/lib, read only after check_permissions has passed on scripts/lib. All of them are
# loaded before anything runs, so an update that swaps the files on disk (the rollback of a failed self-test or of the
# watchdog) leaves the running tick every function it still calls. dbcopy.sh is for atomic_write (watchdog_report) and
# envfile.sh is the writer of .env. ops-access.sh is loaded here and nowhere else, so the launcher's last good copy runs its
# own and never the clone's. A tick runs without it too: ACCESS_LIB stays empty when the file is missing or does not load
# whole, and then an `access` request is answered as failed and the state names no lanAddress.
load_libs() {
  local l
  # shellcheck source=/dev/null
  for l in release selftest watchdog address housekeeping wake git actions step hourly; do . "$LIB/ops-$l.sh" || return 1; done
  # shellcheck source=lib/ops-access.sh
  ACCESS_LIB=""; . "$LIB/ops-access.sh" 2>/dev/null && ACCESS_LIB=1
  # shellcheck source=/dev/null
  . "$LIB/dbcopy.sh" && . "$LIB/envfile.sh"
}

ENV_ERR=""
# Refuses a .env that could redirect Docker, Compose or git, or smuggle in shell text (threat model R16 to R18).
env_check() {
  [[ -f .env ]] || return 0
  local line key val prof inst
  while IFS= read -r line || [[ -n $line ]]; do
    [[ -z $line || $line == \#* ]] && continue
    if [[ ! $line =~ ^([A-Z_][A-Z0-9_]*)=([^$'\r']*)$ ]]; then ENV_ERR="a line is not of the form KEY=value"; return 1; fi
    key=${BASH_REMATCH[1]}; val=${BASH_REMATCH[2]}
    case $key in
      COMPOSE_PROJECT_NAME | COMPOSE_PROFILES) ;;
      COMPOSE_* | DOCKER_* | BUILDKIT_* | GIT_* | LD_* | PATH | BASH_ENV | ENV | IFS | SHELL | HOME | USER | TMPDIR | XDG_*)
        ENV_ERR="key $key is not allowed"; return 1 ;;
    esac
    if [[ $val == *'$'* || $val == *'`'* ]]; then ENV_ERR="the value of $key has a \$ or \` character"; return 1; fi
  done <.env
  prof=$(env_get COMPOSE_PROFILES)
  case $prof in "" | caddy | tunnel | caddy,tunnel | tunnel,caddy) ;; *) ENV_ERR="COMPOSE_PROFILES is invalid"; return 1 ;; esac
  inst=$(env_get INSTANCE_NAME)
  [[ -z $inst || $inst =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { ENV_ERR="INSTANCE_NAME is invalid"; return 1; }
  inst=$(env_get COMPOSE_PROJECT_NAME)
  [[ -z $inst || $inst =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { ENV_ERR="COMPOSE_PROJECT_NAME is invalid"; return 1; }
  inst=$(env_get TALOUS_PRERELEASE)   # which release is followed (lib/release.sh)
  [[ -z $inst || $inst == yes || $inst == no ]] || { ENV_ERR="TALOUS_PRERELEASE is invalid"; return 1; }
  return 0
}

# ── docker ──────────────────────────────────────────────────────────────────
INSTANCE=$(env_get INSTANCE_NAME); INSTANCE=${INSTANCE:-$DEFAULT_INSTANCE}
# the docker binary named at install (ops/policy) goes first in PATH, for a tick and for the self-test
policy_docker() { local d; d=$(pol_get DOCKER); if [[ -n $d && $d =~ ^/[A-Za-z0-9_./-]+/docker$ && -x $d && ! -w $(dirname "$d") ]]; then PATH=$(dirname "$d"):$PATH; export PATH; fi; }
app_running() { [[ -n $(timeout 20 docker compose ps --status running -q banking 2>/dev/null) ]]; }
app_up() { timeout 20 docker compose exec -T banking wget -qO- http://127.0.0.1:8080/api/health >/dev/null 2>&1; }
in_app() { timeout "${APP_TIMEOUT:-60}" docker compose exec -T banking "${NODE[@]}" "$@"; }
wait_healthy() { # wait_healthy TRIES (2 s apart)
  local i
  for ((i = 0; i < $1; i++)); do app_up && return 0; sleep 2; done
  return 1
}
current_version() {
  local v
  v=$(in_app dist/node.js version 2>/dev/null | tail -1 | awk '{print $1}')
  [[ $v =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && printf '%s' "$v"
}
semver_gt() { # semver_gt A B: A is newer than B (both X.Y.Z)
  local -a x y; local i
  IFS=. read -r -a x <<<"$1"; IFS=. read -r -a y <<<"$2"
  for i in 0 1 2; do
    ((10#${x[i]} > 10#${y[i]})) && return 0
    ((10#${x[i]} < 10#${y[i]})) && return 1
  done
  return 1
}
free_kb() { df -Pk "$1" 2>/dev/null | awk 'NR==2 {print $4}'; }
# R27: room for a copy and an image, on the clone and on Docker's disk
check_disk() {
  local need=$((1024 * 1024)) p kb root
  root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)
  for p in "$ROOT" "$root"; do
    [[ -n $p && -d $p ]] || continue
    kb=$(free_kb "$p"); [[ $kb =~ ^[0-9]+$ ]] || continue
    if ((kb < need)); then DISK_MSG="Levytila ei riitä ($((kb / 1024)) Mt vapaana, $p)"; return 1; fi
  done
  return 0
}

# ── git, with the checks of the threat model (R7 to R13) ────────────────────
GIT_PROTO=https:ssh; [[ ${OPS_TEST:-} == 1 ]] && GIT_PROTO=https:ssh:file
export GIT_ALLOW_PROTOCOL=$GIT_PROTO GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'
# (these win over .git/config: no hooks, no fsmonitor, and no program, credential helper or askpass from the clone)
export GIT_CONFIG_COUNT=6 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null \
  GIT_CONFIG_KEY_1=core.fsmonitor GIT_CONFIG_VALUE_1=false GIT_CONFIG_KEY_2=protocol.version GIT_CONFIG_VALUE_2=2 \
  GIT_CONFIG_KEY_3=gpg.ssh.program GIT_CONFIG_VALUE_3=ssh-keygen GIT_CONFIG_KEY_4=credential.helper GIT_CONFIG_VALUE_4="" \
  GIT_CONFIG_KEY_5=core.askPass GIT_CONFIG_VALUE_5=""
# Compose reads this file only, never compose.yaml or an override file
export COMPOSE_FILE=docker-compose.yml
# git_policy, compose_policy_ok (with COMPOSE_JQ) and signers_ok, the checks of an update, are in scripts/lib/ops-git.sh (load_libs)

# ── journal and reporting ───────────────────────────────────────────────────
done_ids() { local f; for f in $(ls -t "$OPS"/journal/op_*.json 2>/dev/null | head -50); do f=${f##*/}; printf '%s\n' "${f%.json}"; done | paste -sd, -; }
journal_write() { # journal_write ID ACTION STARTED REPORTED
  printf '{"id":"%s","action":"%s","started":"%s","reported":%s}\n' "$1" "$2" "$3" "$4" >"$OPS/journal/$1.json.new" && mv -f "$OPS/journal/$1.json.new" "$OPS/journal/$1.json"
}
journal_action() { sed -n 's/.*"action":"\([a-z-]*\)".*/\1/p' "$OPS/journal/$1.json"; }
journal_started() { sed -n 's/.*"started":"\([^"]*\)".*/\1/p' "$OPS/journal/$1.json"; }
# Sends the stored result of one request. Marks it reported when the app took it (also when the app judged the
# payload bad, since a repeat would not change that).
send_report() {
  local id=$1 answer
  [[ -f $OPS/journal/$id.result ]] || return 1
  answer=$(timeout 30 docker compose exec -T banking "${NODE[@]}" dist/node.js ops report --helper "$OPS_HELPER_VERSION" <"$OPS/journal/$id.result" 2>/dev/null | head -c 2000) || true
  if [[ $answer == *'"ok":true'* ]]; then :
  elif [[ $answer == *'"ok":false'* ]]; then log "ops report rejected ($id): ${answer:0:200}"
  else return 1; fi
  journal_write "$id" "$(journal_action "$id")" "$(journal_started "$id")" true
  rm -f "$OPS/run/$id.log"
  return 0
}
# the result payload of a request: STATUS, RC, SUMMARY, the log file, an optional state object
store_result() { # store_result ID STATUS RC SUMMARY LOGFILE
  local id=$1 status=$2 rc=$3 summary=$4 logf=$5 out state
  out=$(scrub_out <"$logf" 2>/dev/null || true)
  state=$(state_json 2>/dev/null || true)
  {
    printf '{"id":"%s","status":"%s","exit_code":%s,"summary":' "$id" "$status" "$rc"
    json_str "$summary"
    printf ',"output":"'; printf '%s' "$out" | json_body; printf '"'
    [[ -z $state ]] || printf ',"state":%s' "$state"
    printf '}\n'
  } >"$OPS/journal/$id.result"
}

# ── the state snapshot the page shows ───────────────────────────────────────
state_json() {
  local v commit mode prof bind port url lan first=1 f
  v=$(current_version || true)
  commit=$(image_label "$INSTANCE:latest" talous.commit) # lib/release.sh
  prof=$(env_get COMPOSE_PROFILES); bind=$(env_get BIND_ADDRESS); bind=${bind:-127.0.0.1}
  port=$(env_get HOST_PORT); port=${port:-8080}; url=$(env_get APP_BASE_URL)
  case $prof in *caddy*) mode=domain ;; *tunnel*) mode=tunnel ;; *) if [[ $bind == 127.0.0.1 || $bind == localhost ]]; then mode=local; else mode=lan; fi ;; esac
  printf '{'
  sep() { if ((first)); then first=0; else printf ','; fi; }
  if [[ -n $v ]]; then sep; printf '"version":"%s"' "$v"; fi
  if [[ $commit =~ ^[0-9a-f]{40}$ ]]; then sep; printf '"commit":"%s","build":"%s"' "$commit" "${commit:0:7}"; fi
  sep; printf '"can_rollback":%s' "$([[ -f backups/.last-update ]] && echo true || echo false)"
  # update.sh records whether the update changed the schema; only an explicit "no" is believed (older ones write none)
  sep; printf '"schema_changed":%s' "$([[ -f backups/.last-update ]] && ! grep -qx 'SCHEMA_CHANGED=no' backups/.last-update && echo true || echo false)"
  sep; printf '"mode":"%s"' "$mode"; if [[ $port =~ ^[0-9]{2,5}$ ]]; then sep; printf '"port":%s' "$port"; fi
  # the switch for pre-releases as .env has it, said every time so that a `no` replaces a stored `yes`; a source install has no
  # switch, and an install without a .env says no position, so the page shows none (every request would end refused)
  sep; if [[ -f .env ]]; then printf '"prerelease":"%s",' "$([[ $(env_get TALOUS_PRERELEASE) == yes ]] && echo yes || echo no)"; fi
  # private: ops/channel names the private repository (scripts/use-private.sh); the page shows the channel and cannot change it
  printf '"channel":"%s"' "$(if on_private; then echo private; elif [[ $(env_get TALOUS_CHANNEL) == source ]]; then echo source; else echo release; fi)"
  # ] and [ (an IPv6 address) lead the set: a backslash does not quote them inside one
  if [[ -n $url && $url =~ ^[][A-Za-z0-9:/._-]{1,120}$ ]]; then sep; printf '"address":"%s"' "$url"; fi
  # where the copy would answer after `lan` right now, by the rule `lan` uses (lib/ops-access.sh)
  if [[ -n ${ACCESS_LIB:-} ]] && lan=$(access_lan_url) && [[ $lan =~ ^http://[][A-Za-z0-9.:]{1,110}$ ]]; then sep; printf '"lanAddress":"%s"' "$lan"; fi
  for f in check doctor backups; do if [[ -s $OPS/$f.frag ]]; then sep; cat "$OPS/$f.frag"; fi; done
  if [[ -s $OPS/watchdog.frag ]]; then sep; printf '"watchdog":'; cat "$OPS/watchdog.frag"; fi # watchdog_report (lib/ops-watchdog.sh)
  printf '}'
}
# The snapshot goes to the app: with the heartbeat, and right after the watchdog's rollback. An app that does not take it gets the next one.
send_state() { state_json | timeout 30 docker compose exec -T banking "${NODE[@]}" dist/node.js ops state --helper "$OPS_HELPER_VERSION" >/dev/null 2>&1 || true; }
# host backups (backup.sh) for the list on the page
write_backups_frag() {
  local f name size at out="" n=0
  for f in $(ls -t backups/talous-*.db.gz backups/talous-*.db.gz.age 2>/dev/null | head -20); do
    name=${f##*/}
    [[ $name =~ ^[A-Za-z0-9._-]{1,100}$ ]] || continue
    size=$(stat -c %s "$f" 2>/dev/null) || continue
    at=$(date -u -d "@$(stat -c %Y "$f")" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) || continue
    out+="${out:+,}{\"name\":\"$name\",\"size\":$size,\"at\":\"$at\",\"kind\":\"manual\"}"; n=$((n + 1))
  done
  if ((n)); then printf '"backups":[%s]' "$out" >"$OPS/backups.frag"; else rm -f "$OPS/backups.frag"; fi
}

# ── check for a new version ─────────────────────────────────────────────────
# fetch_release, write_check_frag and check_update are in scripts/lib/ops-release.sh (load_libs)
# a line for the log of the running action (LOGF) or the helper log
say_log() { if [[ -n ${LOGF:-} ]]; then printf '%s\n' "$*" >>"$LOGF"; else log "$*"; fi; }

# ── the actions ─────────────────────────────────────────────────────────────
LOGF=""; SUMMARY=""; STATUS=ok; RC=0
run_cap() { # run_cap SECONDS cmd...: output into LOGF, capped; returns the command's code
  local t=$1; shift
  # umask 022 for what the scripts and git write into the clone (0077 here is for this helper's own files)
  (umask 022; exec timeout -k 15 "$t" "$@" 2>&1) | head -c "$LOG_CAP" >>"${LOGF:-/dev/null}"
  return "${PIPESTATUS[0]}"
}
fail() { STATUS=failed; RC=${2:-1}; SUMMARY=$1; }

# recover [BEFORE] is in lib/ops-watchdog.sh: after a failed or killed update with the app down, back to the previous
# version. It returns 1 when the app is left down. RECOVER_VERSION is the version that answers when that is not BEFORE.

act_check_update() {
  step_say "1/1 Tarkistetaan uusi versio"
  if check_update; then
    if [[ $UPDATE_AVAILABLE == true ]]; then SUMMARY="Uusi versio on saatavilla."; else SUMMARY="Uusin versio on käytössä."; fi
  else fail "Uutta versiota ei voitu tarkistaa."; fi
}
act_update() {
  local before after
  step_say "1/4 Tarkistetaan"
  check_disk || { fail "$DISK_MSG"; return; }
  git_policy || { fail "$GIT_MSG"; return; }
  before=$(current_version || true)
  check_update || { fail "Uutta versiota ei voitu tarkistaa. Mikään ei muuttunut."; return; }
  if [[ $UPDATE_AVAILABLE != true ]]; then SUMMARY="Uusin versio on jo käytössä."; return; fi
  local target branch
  branch=$(pol_get BRANCH)
  if [[ $CHECK_MODE == release ]]; then
    # only this exact tag, only forward, only a commit that is on the pinned branch, only with a compose file
    # that passes the policy
    git fetch --quiet --no-tags origin "refs/tags/$REL_TAG:refs/tags/$REL_TAG" >>"$LOGF" 2>&1 || { fail "Julkaisun $REL_TAG koodia ei saatu."; return; }
    # "+": the branch may start again on a new root (lib/release.sh); this moves only the remote-tracking pointer, and
    # the checks below decide whether the clone follows
    git fetch --quiet --no-tags origin "+refs/heads/$branch:refs/remotes/origin/$branch" >>"$LOGF" 2>&1 || { fail "Uutta versiota ei saatu ladattua. Mikään ei muuttunut."; return; }
    target=$(git rev-parse "$REL_TAG^{commit}" 2>/dev/null || true)
    [[ $target =~ ^[0-9a-f]{40}$ ]] || { fail "Version $REL_TAG koodia ei löytynyt."; return; }
    # or a release on a new history that names this release as the one it continues (lib/release.sh)
    continues HEAD "$target" || { fail "Uusi versio ei jatka asennettua versiota. Mikään ei muuttunut."; return; }
    git merge-base --is-ancestor "$target" "origin/$branch" 2>/dev/null || { fail "Version koodi ei ole päivityslähteessä. Mikään ei muuttunut."; return; }
    export TALOUS_RELEASE=$REL_TAG
  elif [[ $CHECK_MODE == private ]]; then
    # the ref check_update fetched from the private remote; forward only, or the one move a channel switch allows (SINCE)
    unset TALOUS_RELEASE; target=$(private_target || true)
    [[ $target =~ ^[0-9a-f]{40}$ ]] || { fail "Yksityisen kehitysversion uusinta versiota ei löytynyt."; return; }
    git merge-base --is-ancestor HEAD "$target" 2>/dev/null || switch_from HEAD || { fail "Uusi versio ei jatka asennettua versiota. Mikään ei muuttunut."; return; }
  else
    unset TALOUS_RELEASE
    target=$(git rev-parse "origin/$branch^{commit}" 2>/dev/null || true)
    [[ $target =~ ^[0-9a-f]{40}$ ]] || { fail "Lähdekoodin uusinta versiota ei löytynyt."; return; }
    git merge-base --is-ancestor HEAD "$target" 2>/dev/null || { fail "Uusi versio ei jatka asennettua versiota. Mikään ei muuttunut."; return; }
  fi
  signers_ok "$target" || { fail "Uutta koodia ei ole allekirjoittanut luotettu avain. Mikään ei muuttunut."; return; }
  compose_policy_ok "$target" || { fail "Uuden version asetukset eivät täytä turvasääntöjä (${POLICY_MSG:-?}). Mikään ei muuttunut."; return; }
  # update.sh installs exactly this commit and does not fetch or choose anything itself
  export TALOUS_TARGET=$target TALOUS_MODE=$CHECK_MODE
  step_say "2/4 Haetaan ja vaihdetaan versio"
  # TALOUS_DEADLINE: when this run ends the update, so that its wait for the new version stays inside the timeout
  if TALOUS_DEADLINE=$(($(date +%s) + T_UPDATE)) run_cap "$T_UPDATE" ./scripts/update.sh --yes; then
    step_say "3/4 Tarkistetaan että sovellus vastaa"
    if wait_healthy 15; then
      step_say "4/4 Valmis"
      after=$(current_version || true)
      SUMMARY="Päivitetty: ${before:-?} → ${after:-?}."
      write_check_frag   # the answer from before the switch says "available", and nothing fetches again until the next check (within the hour)
      rm -f "$OPS/watchdog.frag"   # the report of an earlier rollback is old news once an update has gone through (watchdog_report)
      after_update_check   # lib/ops-selftest.sh: no arguments; it may call fail and change SUMMARY
    else
      fail "Päivitetty sovellus ei vastaa."; recover "$before" || SUMMARY="$SUMMARY Palautus epäonnistui, katso ops/RECOVERY.txt."
    fi
  else
    RC=$?
    # update.sh ends with 3 when the new version's database changes failed on a copy, 4 when that check could not run
    # (docker, memory); either way before anything was stopped
    if ((RC == 3)) && app_up; then fail "Uuden version tietokantamuutokset epäonnistuivat kopiolla. Edellinen versio on käynnissä ja tiedot ovat ennallaan. Syy on lokissa." "$RC"
    elif ((RC == 4)) && app_up; then fail "Tietokantamuutosten tarkistusta ei voitu ajaa. Edellinen versio on käynnissä ja tiedot ovat ennallaan. Syy on lokissa." "$RC"
    elif app_up; then fail "Päivitys ei onnistunut, edellinen versio on käynnissä. Syy on lokissa." "$RC"
    else
      fail "Päivitys ei onnistunut. Syy on lokissa." "$RC"
      if ! recover "$before"; then SUMMARY="$SUMMARY Palautus epäonnistui, katso ops/RECOVERY.txt."
      elif [[ -n $RECOVER_VERSION ]]; then SUMMARY="$SUMMARY Edellistä versiota ei voitu palauttaa, käynnissä on versio $RECOVER_VERSION."
      else SUMMARY="$SUMMARY Edellinen versio palautettiin."; fi
    fi
  fi
}
act_rollback() {
  step_say "1/2 Palautetaan edellinen versio"
  if rollback_run look "2/2 Tarkistetaan että sovellus vastaa"; then
    SUMMARY="Edellinen versio palautettu: $(current_version || echo '?')."; rm -f "$OPS/check.frag" "$OPS/last-check"
  elif ((ROLLBACK_RC == 0)); then fail "Palautettu sovellus ei vastaa."
  else fail "Palautus ei onnistunut. Syy on lokissa." "$ROLLBACK_RC"; fi
}
# backup, restart, doctor, logs, prune and helper-renew (act_backup ... act_helper_renew) are in scripts/lib/ops-actions.sh (load_libs)
# the change of remote access the app prepared, checked there (access_apply, lib/ops-access.sh)
act_access() { if [[ -n ${ACCESS_LIB:-} ]]; then access_apply "$1"; else fail "Etäkäytön muutosta ei voitu tehdä: osa apurista puuttuu. Mitään ei muutettu."; fi; }

# runs one request that passed validation
# shellcheck disable=SC2034 # STEP_T0, STEP_OFF and STEP_ID are read by lib/ops-step.sh
run_request() { # run_request ID ACTION
  local id=$1 action=$2 started
  started=$(now_iso)
  journal_write "$id" "$action" "$started" false   # before anything is done (R20)
  LOGF=$OPS/run/$id.log; : >"$LOGF"; chmod 600 "$LOGF"
  SUMMARY=""; STATUS=ok; RC=0; KEEP_LINES=200; KEEP_BYTES=16384; STEP_T0=$SECONDS; STEP_OFF=0; STEP_ID=$id # lib/ops-step.sh
  log "request $id: $action"
  case $action in
    update) act_update ;;
    rollback) act_rollback ;;
    backup) act_backup ;;
    restart) act_restart ;;
    doctor) act_doctor ;;
    check-update) act_check_update ;;
    logs) act_logs ;;
    prune) act_prune ;;
    helper-renew) act_helper_renew ;;
    access) act_access "$id" ;;
    prerelease-on) act_prerelease yes ;; # lib/ops-release.sh. The name is the whole request: yes and no are this file's words
    prerelease-off) act_prerelease no ;;
    *) fail "Tuntematon toiminto." ;;
  esac
  [[ -n $SUMMARY ]] || SUMMARY=$([[ $STATUS == ok ]] && echo "Valmis." || echo "Epäonnistui.")
  store_result "$id" "$STATUS" "$RC" "$SUMMARY" "$LOGF"
  LOGF=""; STEP_ID=""
  send_report "$id" || log "report $id is left waiting (the app does not respond)"
}

# ── a tick ──────────────────────────────────────────────────────────────────
# Requests the helper started and never finished (it was killed): finish them as failed. CUT is the id, for main.
finish_unfinished() {
  local f id any=1
  for f in "$OPS"/journal/op_*.json; do
    [[ -e $f ]] || continue
    id=${f##*/}; id=${id%.json}
    [[ $id =~ ^op_[0-9a-f]{16}$ ]] || continue
    [[ -f $OPS/journal/$id.result ]] && continue
    grep -q '"reported":false' "$f" || continue
    LOGF=$OPS/run/$id.log; [[ -f $LOGF ]] || : >"$LOGF"
    store_result "$id" failed 1 "Apuri keskeytyi kesken toiminnon." "$LOGF"
    LOGF=""; any=0; CUT=$id
    log "interrupted request $id marked as failed"
  done
  return $any
}
reconcile() {
  local f id
  for f in "$OPS"/journal/op_*.json; do
    [[ -e $f ]] || continue
    id=${f##*/}; id=${id%.json}
    [[ $id =~ ^op_[0-9a-f]{16}$ ]] || continue
    grep -q '"reported":false' "$f" || continue
    send_report "$id" || true
  done
}
# every 10th tick, and the first after boot, a snapshot; once a day the doctor and the housekeeping, once an hour the version check (lib/ops-hourly.sh)
heartbeat() {
  local n boot old_boot stale=false fresh=false
  n=$(cat "$OPS/tick" 2>/dev/null || echo 0); [[ $n =~ ^[0-9]+$ ]] || n=0
  n=$((n + 1)); printf '%s\n' "$n" >"$OPS/tick"
  # the helper's version is part of the mark: the first tick of a renewed helper sends its snapshot, with the fields it adds
  boot="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo none) $OPS_HELPER_VERSION"; old_boot=$(cat "$OPS/boot_id" 2>/dev/null || true)
  if [[ ! -f $OPS/last-check ]] || [[ -n $(find "$OPS/last-check" -mmin +1440 2>/dev/null) ]]; then stale=true; fi
  if [[ $stale == true ]]; then
    if held_check; then touch "$OPS/last-check"; else touch -d '23 hours ago' "$OPS/last-check" 2>/dev/null || touch "$OPS/last-check"; fi
    run_doctor || true
    write_backups_frag
    housekeeping   # lib/ops-housekeeping.sh: no arguments
  elif hourly_due; then held_check && fresh=true; fi # an hourly check that found an answer is sent at once
  if ((n % 10 == 0)) || [[ $boot != "$old_boot" ]] || [[ $stale == true || $fresh == true ]]; then
    printf '%s\n' "$boot" >"$OPS/boot_id"
    send_state
  fi
  # old journal entries and logs go after 30 days
  find "$OPS/journal" "$OPS/run" -type f -mtime +30 -delete 2>/dev/null || true
}
# One poll. The answer must be exactly one of two shapes (R3). Anything else is dropped. poll_once [SECONDS]: its time limit. LAST_RAN: the action run.
# shellcheck disable=SC2120,SC2034 # wake_loop (lib/ops-wake.sh) passes the time limit and reads LAST_RAN
poll_once() {
  local out id action secs=${1:-30}; LAST_RAN=""
  out=$(timeout -k 5 "$secs" docker compose exec -T banking "${NODE[@]}" dist/node.js ops poll --helper "$OPS_HELPER_VERSION" --done "$(done_ids)" 2>/dev/null | head -c 8193) || true
  if ((${#out} > 8192)); then log "bad poll: the answer is too long"; return 0; fi
  out=${out%$'\n'}
  [[ -n $out ]] || return 1
  if [[ $out == '{"request":null}' ]]; then return 1; fi
  if [[ $out =~ ^\{\"request\":\{\"id\":\"(op_[0-9a-f]{16})\",\"action\":\"([a-z-]{1,20})\",\"params\":\{\},\"secret\":null\}\}$ ]]; then
    id=${BASH_REMATCH[1]}; action=${BASH_REMATCH[2]}
  else
    log "bad poll: the answer has an unexpected shape"; return 0
  fi
  # An action this helper does not know (a newer server, or an older helper after a rollback) is answered at once:
  # the app already marked the row running, and silence would hold the one mutating slot for 30 minutes. Nothing is
  # run for it: run_request refuses it in its case, and the name was checked against [a-z-]{1,20} above.
  case " $ACTIONS " in *" $action "*) ;; *) log "request $id: unknown action \"$action\", reported failed" ;; esac
  # a request already in the journal is never run again, whatever the database says
  if [[ -f $OPS/journal/$id.json ]]; then
    log "request $id is already in the journal, skipped"
    send_report "$id" || true
    return 0
  fi
  LAST_RAN=$action; run_request "$id" "$action"
  return 0
}

main() {
  command -v timeout >/dev/null && command -v flock >/dev/null || { echo "timeout or flock is missing (coreutils, util-linux)." >&2; exit 1; }
  check_permissions || exit 1
  mkdir -p "$OPS/journal" "$OPS/run" && chmod 700 "$OPS" "$OPS/journal" "$OPS/run"
  check_permissions || exit 1
  # one run at a time: an update in progress holds this lock, and so does the wait for a press; the ticks during it do nothing
  exec 8>"$OPS/.lock"
  flock -n 8 || exit 0
  if ! env_check; then log ".env is invalid: $ENV_ERR. The helper does not run until it is fixed."; exit 1; fi
  [[ $INSTANCE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { log "INSTANCE_NAME is invalid"; exit 1; }
  load_libs || { log "A part of the helper does not load (scripts/lib). The helper does not run."; exit 1; }
  now_iso >"$OPS/helper-seen"; rm -f .env.new 2>/dev/null # (left by a helper killed while it wrote .env: it holds the tunnel token)
  policy_docker
  docker info >/dev/null 2>&1 || { log "Docker does not respond"; exit 0; }
  # A request cut short by a kill is finished as failed. An `access` or a `restart` then starts the containers again
  # (cut_short, lib/ops-access.sh). Only an update or a rollback, with the app down, goes back to the previous version.
  local cut=""; if finish_unfinished; then cut=$(journal_action "$CUT"); fi
  case $cut in access | restart) [[ -z ${ACCESS_LIB:-} ]] || cut_short "$CUT" "$cut" ;; esac
  # every tick, with the app down too, each with no arguments: watchdog_tick (lib/ops-watchdog.sh), address_tick (lib/ops-address.sh)
  watchdog_tick
  address_tick
  if ! app_running; then case $cut in update | rollback) recover || true ;; esac; exit 0; fi
  reconcile
  local runs=0; poll_once && runs=1
  if ((runs == 0)); then heartbeat; [[ ! -f $OPS/RECOVERY.txt ]] || ! app_up || rm -f "$OPS/RECOVERY.txt"; fi # a RECOVERY.txt is stale once the app answers
  wake_loop "$runs" # lib/ops-wake.sh: the wait for a press, for the rest of the tick
  exit 0
}
# --self-test: the helper's only argument. No lock, no tick: the files are checked and loaded, and self_test answers.
if [[ ${1:-} == --self-test ]]; then
  check_permissions && load_libs || { echo "self-test failed: the helper's files are not safe or do not load"; exit 1; }
  self_test; exit $?
fi
main
