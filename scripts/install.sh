#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous installer. Infrastructure only:
#
#   ./scripts/install.sh                       install or re-run in this directory, no questions
#   ./scripts/install.sh --reconfigure         the access menu (home network / this machine / tunnel / domain)
#   ./scripts/install.sh --new-instance NAME   clone this repository to ../NAME, at this clone's release, and install it
#   ./scripts/install.sh --ops-helper          (re)install the maintenance helper only (--ops-helper-off removes it)
#
#   • binds to this machine's home-network address (the default-route address, only if it is private:
#     10/8, 172.16/12, 192.168/16), else to 127.0.0.1, and writes .env (mode 600, old one backed up)
#   • pulls and verifies the signed release image (or builds the source until a release exists, or with
#     TALOUS_CHANNEL=source in .env) and starts the containers
#   • installs the maintenance helper (systemd user timer, else cron) for Asetukset > Ylläpito
#   • prints the address and a setup link with the one-time code filled in
#
# Nothing is asked by default. Answers are flags or environment variables; --reconfigure shows the access menu.
# Every question (Docker's install, the docker group, the name, the access choice, the address, the port) comes before
# Docker is installed and before anything is built, so the long steps run without waiting for a person.
#
#   --access lan|local|tunnel|domain   TALOUS_ACCESS        how the app is reached (default lan, see above)
#   --domain talous.example.com        TALOUS_DOMAIN        for domain and tunnel
#   --access-emails a@example.fi,b@example.fi   TALOUS_ACCESS_EMAILS for tunnel: who Cloudflare Access lets in (see scripts/lib/cloudflare.sh)
#   --email you@example.com            TALOUS_EMAIL         for domain (Let's Encrypt)
#   (no flag, so it stays out of ps)   TALOUS_TUNNEL_TOKEN  for tunnel
#   --port 8080                        TALOUS_PORT          default: the first free port from 8080
#   --bind 192.168.1.10                TALOUS_BIND          for lan: the host address to listen on (default: the default route's)
#   --no-ops-helper                    TALOUS_OPS_HELPER=0  leave the maintenance helper out
#   --name NAME                        TALOUS_NAME          instance name (default: directory name)
#   --install-docker                                        install Docker (apt based systems) if missing
#   --reconfigure                                           show the access menu on an existing install
#   --cloudflare-down                                       remove the tunnel, address and Access rule made for this copy
#
# Several instances run side by side, one clone directory each. An instance has its own name,
# port, containers, image and volumes. An existing install always keeps its names.
#
# Everything else happens in the browser on the first visit: the admin
# account, address, time zone, sync times and the Enable Banking key. The
# app secret that encrypts bank keys is created automatically inside the
# container (volume banking-secrets), so there are no secret files to handle.
#
# Safe to run again: an existing install keeps its .env unless --reconfigure or an answer flag is given.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env"
LEGACY_SECRET="$ROOT/secrets/app_secret"
DC="docker compose"
PHYS="$(pwd -P)"
NODE="node --disable-warning=ExperimentalWarning dist/node.js"
DEFAULT_INSTANCE=banking-app
NAME_RE='^[a-z0-9][a-z0-9_-]{0,40}$'
PRESET_NAME=${TALOUS_NAME:-}
# shellcheck disable=SC2034  # read in lib/install-host.sh (reexec_with_group)
ORIG_ARGS=("$@")
YES=false; RECONFIGURE=false; INSTALL_DOCKER=false; FROM_CLONE=false; NEW_INSTANCE=""; CF_DOWN=false
OPS_ONLY=""; OPS_POLICY=false; OPS_HELPER=true; [[ ${TALOUS_OPS_HELPER:-1} != 0 ]] || OPS_HELPER=false
A_ACCESS=${TALOUS_ACCESS:-}; A_DOMAIN=${TALOUS_DOMAIN:-}; A_EMAIL=${TALOUS_EMAIL:-}
A_PORT=${TALOUS_PORT:-}; A_BIND=${TALOUS_BIND:-}; A_TOKEN=${TALOUS_TUNNEL_TOKEN:-}; A_ACCESS_EMAILS=${TALOUS_ACCESS_EMAILS:-}
A_URL_ADDR=""   # only a re-exec sets it (reexec_with_group): the address answer of choice 1 with all addresses
LOG=""
PASS=()   # flags handed on to a new instance's install.sh
REPORTED=false

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%s!%s %s\n' "$yellow" "$reset" "$*"; }
die()  { REPORTED=true; printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }

# runs a command with its output in a log file and a sign of life every 20 s (docker's progress output
# is unreadable when piped). Returns the command's exit code.
run_logged() {
  local log=$1 label=$2 pid t=0; shift 2
  "$@" >"$log" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1; t=$((t + 1))
    if ((t % 20 == 0)); then printf '  %s… %d s\n' "$label" "$t"; fi
  done
  local rc=0
  wait "$pid" || rc=$?
  # Ctrl-C reaches the child before the trap runs: this is the same interruption
  ((rc == 130 || rc == 143)) && interrupted
  return "$rc"
}
# release helpers (signature check, image pull); the image name is set where it is used
IMAGE=${INSTANCE_NAME:-$DEFAULT_INSTANCE}
# shellcheck source=lib/release.sh
. scripts/lib/release.sh
# shellcheck source=lib/cloudflare.sh
. scripts/lib/cloudflare.sh
# shellcheck source=lib/install-host.sh
. scripts/lib/install-host.sh
# shellcheck source=lib/host-addr.sh
. scripts/lib/host-addr.sh

# ask VAR "Question" "default" [preset]: sets VAR (keeps default on empty answer or end of input).
# A preset (from a flag) is used without asking, and --yes takes the default.
ask() {
  local __var=$1 __q=$2 __def=${3:-} __pre=${4:-} __ans=""
  if [[ -n $__pre ]]; then printf -v "$__var" '%s' "$__pre"; return; fi
  if $YES; then printf -v "$__var" '%s' "$__def"; return; fi
  if [[ -n $__def ]]; then read -r -p "$__q [$__def]: " __ans || true; else read -r -p "$__q: " __ans || true; fi
  printf -v "$__var" '%s' "${__ans:-$__def}"
}
# ask_secret VAR "Question": hidden input
ask_secret() {
  local __var=$1 __q=$2 __ans=""
  read -r -s -p "$__q: " __ans || true; echo
  printf -v "$__var" '%s' "$__ans"
}
# confirm "Question" default(y/n): returns 0 for yes. The Finnish K (kyllä) and E (ei) are accepted as well.
confirm() {
  local __q=$1 __def=${2:-y} __ans=""
  $YES && { [[ $__def == y ]]; return; }
  read -r -p "$__q [$( [[ $__def == y ]] && echo Y/n || echo y/N )]: " __ans || true
  __ans=${__ans:-$__def}
  [[ $__ans =~ ^[KkYy] ]]
}
# the helper's scheduling (timer or cron), shared with reset.sh
# shellcheck source=lib/ops-schedule.sh
. "$ROOT/scripts/lib/ops-schedule.sh"

# The maintenance helper: ops/ (mode 700), the policy it holds the clone to, and the timer or cron line.
# Sets OPS_KIND (systemd, cron, none), OPS_NOTE, OPS_LABEL, OPS_TODO and OPS_WHY (see lib/ops-schedule.sh). Never fails the install.
setup_ops_helper() {
  local url branch dockerbin unsafe keep=false
  OPS_KIND=none; OPS_LABEL=off; OPS_TODO=""; OPS_WHY=""
  # the helper refuses to run as root, so a timer for root would only report "off" forever
  if [[ $(id -u) -eq 0 ]]; then
    OPS_NOTE="off (the install ran as root; run it as a normal user)"
    return 0
  fi
  # the helper checks the new compose file with jq
  if ! command -v jq >/dev/null 2>&1; then
    OPS_NOTE="off (jq is missing; install it: sudo apt install jq, then run ./scripts/install.sh --ops-helper)"
    return 0
  fi
  umask 077
  mkdir -p ops/journal ops/run && chmod 700 ops ops/journal ops/run
  # the helper refuses a clone, .git, scripts folder or script that others can write to (Ubuntu's umask 002 makes 775)
  ops_fix_permissions
  # remote, branch and docker binary fixed now; the helper refuses an update when the clone no longer matches.
  # Written once, and again with --ops-policy or when the first write found no remote.
  if [[ -f ops/policy && -n $(grep -E '^REMOTE_URL=.' ops/policy 2>/dev/null || true) && $OPS_POLICY != true ]]; then keep=true; fi
  if ! $keep; then
    url=$(git remote get-url origin 2>/dev/null || true); branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    dockerbin=$(command -v docker || true)
    [[ $url =~ ^[A-Za-z0-9_@:/.+~-]+$ && $url != *://*:*@* ]] || url=""
    [[ $branch =~ ^[A-Za-z0-9_./-]+$ && $branch != HEAD ]] || branch=""
    [[ $dockerbin =~ ^/[A-Za-z0-9_./-]+/docker$ ]] || dockerbin=""
    printf 'REMOTE_URL=%s\nBRANCH=%s\nDOCKER=%s\n' "$url" "$branch" "$dockerbin" >ops/policy.new && chmod 600 ops/policy.new && mv -f ops/policy.new ops/policy
    [[ -n $url && -n $branch ]] || warn "The git remote or branch is missing, so updating from the browser does not work until they are set. Fix that and run: ./scripts/install.sh --ops-helper --ops-policy"
  fi
  # the schedule runs the launcher, a copy of scripts/ops-launcher.sh outside this folder that keeps the last helper that worked
  ops_scheduler_install "$INSTANCE" "$ROOT" || true
  [[ $OPS_KIND == none || -n ${OPS_LAUNCHER:-} ]] || warn "The helper's launcher could not be put into $(ops_launcher_dir "$INSTANCE" || echo "the home folder"), so the schedule runs the helper of this folder itself. Make that folder writable and run: ./scripts/install.sh --ops-helper"
  # a path another user owns cannot be fixed from here, and the helper refuses every tick while it stays
  unsafe=$(ops_unsafe_paths | head -n 3 | tr '\n' ' ' || true)
  [[ -z $unsafe ]] || warn "The helper refuses to run while these are owned by someone else or writable by others: ${unsafe% }. Run: sudo chown -R $(id -un) .   and then: ./scripts/install.sh --ops-helper"
}
# current value from an existing .env
existing() { [[ -f $ENV_FILE ]] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
# the same name Compose derives from a directory: lowercase, only [a-z0-9_-], no leading - or _
compose_name() { printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-' | sed 's/^[-_]*//'; }
# the project name Compose uses right now (shell variable, .env or directory)
project_name() {
  local n
  n=$($DC config --format json 2>/dev/null | sed -n 's/^  "name": *"\([^"]*\)".*/\1/p' | head -1) || true
  if [[ -z $n ]]; then
    n=${COMPOSE_PROJECT_NAME:-$(existing COMPOSE_PROJECT_NAME)}
    [[ -n $n ]] || n=$(basename "$ROOT")
    n=$(compose_name "$n")
  fi
  printf '%s' "$n"
}
# a directory label as Compose saw it: compare the plain and the symlink-resolved path
same_dir() { [[ -n $1 && ( $1 == "$ROOT" || $1 == "$PHYS" ) ]]; }
# Docker may still be missing while the questions are asked (prep_host installs it after the last answer): nothing
# is running then, so what these ask about is empty.
have_docker() { command -v docker >/dev/null 2>&1; }
# working directories of the containers of a Compose project, one per line
project_dirs() { have_docker || return 0; docker ps -a --filter "label=com.docker.compose.project=$1" --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | sort -u; }
project_volumes() { have_docker || return 0; docker volume ls -q --filter "label=com.docker.compose.project=$1" 2>/dev/null; }
# does the project have containers, and are they all from this directory?  prints: none | mine | other
project_owner() {
  local d any=0 foreign=0
  while IFS= read -r d; do
    any=1
    same_dir "$d" || foreign=1
  done < <(project_dirs "$1"; true)
  # project_dirs prints one empty line per container without a label: that is foreign as well
  if ((any == 0)); then echo none; elif ((foreign)); then echo other; else echo mine; fi
}

# ── ports and addresses ──────────────────────────────────────────────────────
# an address as "*" (all addresses), or lowercase without brackets and zone
norm_addr() {
  local a=${1,,}
  a=${a#\[}; a=${a%\]}; a=${a%%\%*}
  case $a in ""|"*"|0.0.0.0|::) echo "*" ;; *) echo "$a" ;; esac
}
# two bind addresses collide when one is a wildcard or they are equal
addr_conflict() {
  local a b; a=$(norm_addr "$1"); b=$(norm_addr "$2")
  [[ $a == "*" || $b == "*" || $a == "$b" ]]
}
USED=()   # "address port" entries: listening on the host or published by another project's container
# own_project, when set, is a project whose containers are ours (their ports are not "taken")
load_used() {
  local own_project=${1:-} own=() line rest proj wd binding addr port e skip o
  USED=()
  local ids; ids=$(docker ps -aq 2>/dev/null || true)
  if [[ -n $ids ]]; then
    # shellcheck disable=SC2086
    while IFS= read -r line; do
      proj=${line%%|*}; rest=${line#*|}; wd=${rest%%|*}; rest=${rest#*|}
      IFS=, read -ra bindings <<<"$rest"
      for binding in ${bindings[@]+"${bindings[@]}"}; do
        [[ -n $binding ]] || continue
        port=${binding##*:}; addr=$(norm_addr "${binding%:*}")
        if [[ -n $own_project && $proj == "$own_project" ]] && same_dir "$wd"; then own+=("$addr $port"); else USED+=("$addr $port"); fi
      done
    done < <(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{range $p,$b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}}:{{.HostPort}},{{end}}{{end}}' $ids 2>/dev/null)
  fi
  if command -v ss >/dev/null; then
    while IFS= read -r e; do
      [[ -n $e ]] || continue
      port=${e##*:}; addr=$(norm_addr "${e%:*}"); skip=0
      # a listener that belongs to our own published port (docker-proxy) is not a conflict
      for o in ${own[@]+"${own[@]}"}; do
        [[ ${o##* } == "$port" ]] && addr_conflict "${o% *}" "$addr" && skip=1
      done
      ((skip)) || USED+=("$addr $port")
    done < <(ss -H -ltn 2>/dev/null | awk '{print $4}')
  else
    warn "ss is missing, ports are only checked against Docker containers."
  fi
}
# port_taken PORT ADDRESS: is the port in use on that address (wildcards count)
port_taken() {
  local e
  for e in ${USED[@]+"${USED[@]}"}; do
    [[ ${e##* } == "$1" ]] && addr_conflict "${e% *}" "$2" && return 0
  done
  return 1
}
# home-network ranges only: 10/8, 172.16/12, 192.168/16
is_private_v4() {
  local a=${1:-} o1 o2
  [[ $a =~ ^([0-9]{1,3})\.([0-9]{1,3})\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
  o1=$((10#${BASH_REMATCH[1]})); o2=$((10#${BASH_REMATCH[2]}))
  ((o1 == 10)) || ((o1 == 172 && o2 >= 16 && o2 <= 31)) || ((o1 == 192 && o2 == 168))
}
# project of a container that holds 80 or 443 on all addresses (a Caddy without CADDY_ADDRESS), if any
wildcard_caddy_owner() {
  have_docker || return 0
  docker ps --format '{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.Ports}}|{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null \
    | awk -F'|' '$3 ~ /(^|, )(0\.0\.0\.0|\[::\]):(80|443)->/ && $2 == "caddy" && $1 != "" {print $1 "|" $4; exit}'
}
# bracket an IPv6 address for a URL
url_host() { [[ $1 == *:* ]] && printf '[%s]' "$1" || printf '%s' "$1"; }

# a domain name only: letters, digits, dots and hyphens (it ends up in .env and the Caddyfile)
valid_domain() { [[ $1 =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]; }


# ── new instance: clone this repository next to this one and install it there ─
new_instance() {
  local name=$1 target origin branch
  [[ $name =~ $NAME_RE ]] || die "The name must use lowercase letters, digits, - or _ (start with a letter or digit, at most 41 characters)."
  command -v git >/dev/null || die "git is missing."
  target="$(dirname "$ROOT")/$name"
  [[ ! -e $target ]] || die "The folder $target already exists."
  origin=$(git remote get-url origin 2>/dev/null) || die "This clone has no remote repository (origin)."
  branch=$(git symbolic-ref --short HEAD 2>/dev/null) || die "The clone is not on any branch (git checkout <branch>)."
  if docker info >/dev/null 2>&1 && [[ -n $(project_volumes "$name")$(project_dirs "$name") ]]; then
    die "The name $name already has a Docker project or volumes. Pick another name."
  fi
  step "Cloning $branch into $target"
  say "${dim}Only what has been pushed to the remote repository (origin/$branch) comes along.${reset}"
  git clone -b "$branch" "$origin" "$target"
  pin_new_clone "$target" "$branch"
  grep -q -- '--name' "$target/scripts/install.sh" || die "The install script on branch $branch does not know this feature yet. Push your changes (git push) and try again. The folder $target was left in place."
  exec "$target/scripts/install.sh" --name "$name" --from-clone ${PASS[@]+"${PASS[@]}"}
}

usage() { die "Usage: ./scripts/install.sh [--yes] [--new-instance NAME] [--access lan|local|tunnel|domain] [--domain D] [--email E] [--access-emails A,B] [--port P] [--bind IP] [--name N] [--install-docker] [--reconfigure] [--cloudflare-down] [--ops-helper [--ops-policy] | --ops-helper-off | --no-ops-helper]"; }
while (($#)); do
  case $1 in
    --yes|-y) YES=true; PASS+=("$1") ;;
    --reconfigure) RECONFIGURE=true ;;
    --install-docker) INSTALL_DOCKER=true; PASS+=("$1") ;;
    --from-clone) FROM_CLONE=true ;;
    --cloudflare-down) CF_DOWN=true ;;
    --ops-helper) OPS_ONLY=on ;;
    --ops-policy) OPS_POLICY=true ;;
    --ops-helper-off) OPS_ONLY=off ;;
    --no-ops-helper) OPS_HELPER=false; PASS+=("$1") ;;
    --new-instance|--name|--access|--domain|--email|--access-emails|--port|--bind)
      [[ $# -ge 2 && $2 != --* ]] || { REPORTED=true; usage; }
      case $1 in
        --new-instance) NEW_INSTANCE=$2 ;;
        --name) PRESET_NAME=$2 ;;
        --access) A_ACCESS=$2; PASS+=("$1" "$2") ;;
        --domain) A_DOMAIN=$2; PASS+=("$1" "$2") ;;
        --email) A_EMAIL=$2; PASS+=("$1" "$2") ;;
        --access-emails) A_ACCESS_EMAILS=$2; PASS+=("$1" "$2") ;;
        --port) A_PORT=$2; PASS+=("$1" "$2") ;;
        --bind) A_BIND=$2; PASS+=("$1" "$2") ;;
      esac
      shift ;;
    *) usage ;;
  esac
  shift
done
load_answers
[[ -z $NEW_INSTANCE ]] || new_instance "$NEW_INSTANCE"
if [[ -n $PRESET_NAME ]]; then
  [[ $PRESET_NAME =~ $NAME_RE ]] || die "Invalid name: $PRESET_NAME"
fi
case ${A_ACCESS,,} in
  "") ;;
  1|lan) A_ACCESS=1 ;;
  2|local|localhost) A_ACCESS=2 ;;
  3|tunnel|cloudflare) A_ACCESS=3 ;;
  4|domain|caddy) A_ACCESS=4 ;;
  *) die "Unknown --access: $A_ACCESS (lan, local, tunnel or domain)." ;;
esac
[[ -z $A_PORT ]] || { [[ $A_PORT =~ ^[1-9][0-9]{3,4}$ ]] && ((A_PORT >= 1024 && A_PORT <= 65535)) || die "The port must be 1024-65535."; }

# One run per directory: installer_lock (lib/release.sh), which update.sh and a second install.sh take too. It goes away
# with the process, a Ctrl-C leaves nothing behind. Then a new install asks which release is out (lib/install-host.sh).
if command -v flock >/dev/null && ! installer_lock; then
  die "Another install or update is already running in this folder. Wait until it finishes, then run this again."
fi
confirm_release

# What the user sees when the run stops half way. Nothing is left in a state a re-run cannot continue from.
on_exit() {
  local rc=$?
  [[ -z ${LOG:-} ]] || rm -f "$LOG"
  ((rc == 0)) && return
  if ! $REPORTED; then
    printf '\n%s✗ The install stopped.%s It is safe to run again: %s/scripts/install.sh\n  If the same error comes back: %s/scripts/doctor.sh\n' "$red" "$reset" "$ROOT" "$ROOT" >&2
  fi
  # a failure right after the clone leaves the folder behind: say what to do with it
  if $FROM_CLONE && [[ ! -f $ENV_FILE ]]; then
    printf '%sThe folder %s was left in place. Continue: %s/scripts/install.sh --name %s   or delete it: rm -rf %s%s\n' "$dim" "$ROOT" "$ROOT" "$PRESET_NAME" "$ROOT" "$reset" >&2
  fi
}
trap on_exit EXIT
interrupted() {
  REPORTED=true
  printf '\n%sInterrupted. Nothing to clean up, run again: %s/scripts/install.sh%s\n' "$yellow" "$ROOT" "$reset" >&2
  exit 130
}
trap interrupted INT TERM

# helper only: no Docker needed to set up or remove the timer
if [[ -n $OPS_ONLY ]]; then
  [[ -f $ENV_FILE ]] || die "There is no install in this folder (.env is missing). Run ./scripts/install.sh first."
  INSTANCE=$(existing INSTANCE_NAME); INSTANCE=${INSTANCE:-$DEFAULT_INSTANCE}
  [[ $INSTANCE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "INSTANCE_NAME in .env is invalid: $INSTANCE"
  if [[ $OPS_ONLY == off ]]; then
    ops_scheduler_remove "$INSTANCE"
    ok "Maintenance helper removed ($INSTANCE). The folder ops/journal stays."
  else
    setup_ops_helper
    if [[ $OPS_KIND == none ]]; then warn "$OPS_NOTE"; exit 1; fi
    if [[ -n $OPS_TODO ]]; then warn "$OPS_TODO"; else ok "Maintenance helper on: $OPS_NOTE"; fi
  fi
  exit 0
fi

if $CF_DOWN; then cf_down; fi   # remove the Cloudflare tunnel of the copy in this folder

# ── 0. prerequisites ─────────────────────────────────────────────────────────
step "Checking requirements"

# runs a command as root (directly, or through sudo)
as_root() {
  if ((EUID == 0)); then "$@"
  elif command -v sudo >/dev/null; then if $YES; then sudo -n "$@"; else sudo "$@"; fi
  else return 1; fi
}
in_docker_group() { getent group docker 2>/dev/null | cut -d: -f4 | tr , '\n' | grep -x "${USER:-$(id -un)}" >/dev/null; }
# Docker is checked here and fixed here (a missing group, a stopped service), because the questions below look at what
# Docker already runs. A Docker that is missing is installed after the last answer (prep_host): the long step then runs
# without anyone at the keyboard, and its yes/no questions are asked now.
DOCKER_TODO=false   # Docker is installed after the questions
GROUP_OK=false      # the docker group was agreed to with the other questions
if ! command -v docker >/dev/null; then
  can_install=false
  [[ -r /etc/os-release ]] && command -v curl >/dev/null && { ((EUID == 0)) || command -v sudo >/dev/null; } && can_install=true
  if $can_install && { $INSTALL_DOCKER || { ! $YES && confirm "Docker is missing. Install it now with Docker's own install script (get.docker.com)?" y; }; }; then
    # shellcheck disable=SC2034  # read in lib/install-host.sh
    DOCKER_TODO=true
    say "Docker is installed after the questions below."
    # Docker's install script leaves the user out of the docker group, so that is agreed to now as well
    if ((EUID != 0)) && ! $YES && ! in_docker_group && ! confirm "Add your user to the docker group after the install (sudo usermod -aG docker ${USER:-$(id -un)})?" y; then
      die "The install cannot continue without the docker group. Run: sudo usermod -aG docker \$USER   after installing Docker, then close the SSH connection and open it again (or log out and in)."
    fi
    # shellcheck disable=SC2034  # read in lib/install-host.sh
    GROUP_OK=true
  else
    die "Docker is missing. Install it: curl -fsSL https://get.docker.com | sudo sh   (or run this script again with --install-docker). More: docs/INSTALL.md."
  fi
else
  docker_ready
fi
say ""
say "${bold}Omatalous install${reset}"
say "${dim}Nothing is asked. The other settings are made in the browser.${reset}"

# ── 1. name ──────────────────────────────────────────────────────────────────
# Each instance is a Compose project in its own directory. An install that exists keeps its names
# (volumes are named after the project, so a new name would make the data look gone).
step "Install"
PROJECT=$(project_name)
EXISTING=false
if [[ -f $ENV_FILE || $(project_owner "$PROJECT") == mine ]]; then EXISTING=true; fi

NAME_MSG=""; NAME_VOLS=""
# name_problem NAME: 0 = free, 1 = taken by another directory, 2 = only old volumes of that name exist
name_problem() {
  local n=$1 cproj
  NAME_MSG=""; NAME_VOLS=""
  if [[ $(project_owner "$n") == other ]]; then
    NAME_MSG="The name $n is already used by an install in another folder."; return 1
  fi
  if cproj=$(docker container inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$n" 2>/dev/null) && [[ $cproj != "$n" ]]; then
    NAME_MSG="A container named $n already exists."; return 1
  fi
  if [[ $n == session ]]; then
    NAME_MSG="The name session is reserved (it is the name of an old session cookie)."; return 1
  fi
  NAME_VOLS=$(project_volumes "$n" | tr '\n' ' ')
  if [[ -n $NAME_VOLS ]]; then
    NAME_MSG="The name $n already has volumes: ${NAME_VOLS% }. They may hold old data from another folder."; return 2
  fi
  # no container, project or volumes of this name: an image of that name (any tag, caddy:2 too) is then
  # something else, and update.sh and reset.sh would tag over or remove $n:latest
  if [[ -n $(docker image ls -q "$n" 2>/dev/null) ]]; then
    NAME_MSG="The name $n already has a Docker image. Pick another name."; return 1
  fi
  return 0
}
suggest_name() {
  local i cand
  for i in $(seq 2 99); do
    cand="$1-$i"
    [[ $cand =~ $NAME_RE ]] || continue
    name_problem "$cand" && { echo "$cand"; return; }
  done
}

WRITE_INSTANCE=true
if $EXISTING; then
  [[ -z $PRESET_NAME || $PRESET_NAME == "$PROJECT" ]] || die "This folder already has an install (project $PROJECT). Make a new instance in another folder: ./scripts/install.sh --new-instance NAME"
  INSTANCE=$(existing INSTANCE_NAME)
  if [[ -n $INSTANCE ]]; then
    [[ $INSTANCE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "INSTANCE_NAME in .env is invalid: $INSTANCE"
  else
    # An install from before the key existed: the container and image are banking-app. Writing the
    # key would only be right if they already carry another name.
    INSTANCE=$DEFAULT_INSTANCE; WRITE_INSTANCE=false
    cid=$($DC ps -a -q banking 2>/dev/null | head -1 || true)
    if [[ -n $cid ]]; then
      cname=$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null || true); cname=${cname#/}
      cimage=$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || true)
      if [[ -n $cname && $cname != "$DEFAULT_INSTANCE" && $cimage == "$cname:latest" && $cname =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
        INSTANCE=$cname; WRITE_INSTANCE=true
      fi
    fi
  fi
  say "An existing install keeps its names."
  say "  project ${bold}$PROJECT${reset}, container ${bold}$INSTANCE${reset}"
  say "  volumes ${PROJECT}_banking-data and ${PROJECT}_banking-secrets"
else
  default_name=${PRESET_NAME:-$(compose_name "$(basename "$ROOT")")}
  [[ $default_name =~ $NAME_RE ]] || default_name=""
  # The directory name is the right name for nearly everyone, so nothing is asked unless it is unusable.
  INSTANCE=""
  for _try in 1 2 3 4 5; do
    cand=$default_name
    if [[ ! $cand =~ $NAME_RE ]]; then
      [[ -z $PRESET_NAME ]] || die "Invalid name: $PRESET_NAME"
      say "The folder name does not give a usable install name."
      ask cand "Install name (lowercase letters, digits, - and _)" "banking-app"
      [[ $cand =~ $NAME_RE ]] || { warn "The name may use lowercase letters, digits, - and _ (start with a letter or digit, at most 41 characters)."; $YES && exit 1; default_name=""; continue; }
    fi
    status=0; name_problem "$cand" || status=$?
    if ((status == 1)); then
      sug=$(suggest_name "$cand")
      [[ -z $PRESET_NAME && -n $sug ]] || die "$NAME_MSG${sug:+ Free name: $sug}"
      warn "$NAME_MSG Using the name $sug."
      default_name=$sug; continue
    elif ((status == 2)); then
      warn "$NAME_MSG"
      if [[ -z $PRESET_NAME ]] && ! $YES && confirm "Use these volumes and their data for this install?" n; then :
      else
        [[ -z $PRESET_NAME ]] || die "Pick another name (--name), or delete the old volumes if they are not needed: docker volume rm ${NAME_VOLS% }"
        default_name=$(suggest_name "$cand"); [[ -n $default_name ]] || die "No free name found."
        say "Using the name $default_name."; continue
      fi
    fi
    INSTANCE=$cand; break
  done
  [[ -n $INSTANCE ]] || die "No name chosen."
  PROJECT=$INSTANCE
  say "Install name ${bold}$INSTANCE${reset} (container, image and volumes ${PROJECT}_banking-data, ${PROJECT}_banking-secrets)."
fi

# ── 2. how the app is reached ────────────────────────────────────────────────
# An existing install keeps its answers. A run that stopped half way (no container yet) goes on with
# them without asking. Otherwise one question offers a change; --reconfigure or an answer flag asks again.
KEEP_ALL=false; RESUMED=false
if $EXISTING && [[ -f $ENV_FILE ]] && ! $RECONFIGURE && [[ -z $A_ACCESS$A_DOMAIN$A_EMAIL$A_ACCESS_EMAILS$A_PORT$A_BIND$A_TOKEN ]]; then
  if [[ -z $($DC ps -a -q banking 2>/dev/null || true) ]]; then
    say "The previous install did not finish. Continuing with the same settings."; KEEP_ALL=true; RESUMED=true
  else
    KEEP_ALL=true
  fi
fi
if $KEEP_ALL; then
  step "Settings"
  current_profile=$(existing COMPOSE_PROFILES); current_bind=$(existing BIND_ADDRESS)
  ACCESS=2
  [[ $current_profile == caddy ]] && ACCESS=4
  [[ $current_profile == tunnel ]] && ACCESS=3
  [[ -z $current_profile && -n $current_bind && $current_bind != 127.0.0.1 ]] && ACCESS=1
  PROFILES=$current_profile; TRUST_PROXY=$(existing TRUST_PROXY); TRUST_PROXY=${TRUST_PROXY:-false}
  DOMAIN=$(existing DOMAIN); ACME_EMAIL=$(existing ACME_EMAIL); TUNNEL_TOKEN=$(existing CLOUDFLARE_TUNNEL_TOKEN)
  CADDY_ADDRESS=$(existing CADDY_ADDRESS); CADDY_ADDRESS=${CADDY_ADDRESS#[}; CADDY_ADDRESS=${CADDY_ADDRESS%]}
  BIND_ADDRESS=${current_bind:-127.0.0.1}; HOST_PORT=$(existing HOST_PORT); HOST_PORT=${HOST_PORT:-8080}
  APP_BASE_URL=$(existing APP_BASE_URL); APP_BASE_URL=${APP_BASE_URL:-http://localhost:$HOST_PORT}
  ok "Address: $APP_BASE_URL, port $BIND_ADDRESS:$HOST_PORT  ${dim}(.env stays as it is)${reset}"
else
current_profile=$(existing COMPOSE_PROFILES)
current_bind=$(existing BIND_ADDRESS)
route_addr=$(default_route_addr)
# no answer given and no --reconfigure: the home network if this machine has a private address, else this machine only
if [[ -z $A_ACCESS ]] && ! $RECONFIGURE; then
  if [[ -n $A_TOKEN || -n $A_ACCESS_EMAILS ]]; then cf_guard_emails; A_ACCESS=3
  elif [[ -n $A_DOMAIN && -n $A_EMAIL ]]; then A_ACCESS=4
  elif [[ -n $A_BIND ]] || is_private_v4 "$route_addr"; then A_ACCESS=1
  else
    A_ACCESS=2
    warn "The machine address (${route_addr:-unknown}) is not a home-network address, so the app listens on this machine only (127.0.0.1). For a server, use a Cloudflare Tunnel or your own domain: ./scripts/install.sh --reconfigure"
  fi
fi
if [[ -z $A_ACCESS ]] && ! $YES; then
step "How is the app reached?"
say "  1) Home network                http://<machine address>:<port>  unencrypted, home network only (default)"
say "  2) This machine only           http://localhost:<port>          for trying out or behind your own proxy"
say "  3) Cloudflare Tunnel           https://talous.example.com       no open ports, put Cloudflare Access in front"
say "  4) Own domain + Let's Encrypt  https://talous.example.com       Caddy, needs ports 80/443 open on the router"
fi
default_access=1
[[ -n $current_profile || ( -n $current_bind && $current_bind == 127.0.0.1 ) ]] && default_access=2
[[ $current_profile == caddy ]] && default_access=4
[[ $current_profile == tunnel ]] && default_access=3
[[ -z $current_profile && -z $current_bind ]] && { is_private_v4 "$route_addr" && default_access=1 || default_access=2; }
ask ACCESS "Choice" "$default_access" "$A_ACCESS"
[[ $ACCESS =~ ^[1-4]$ ]] || die "Unknown choice: $ACCESS"

PROFILES=""; TRUST_PROXY=false; DOMAIN=""; ACME_EMAIL=""; TUNNEL_TOKEN=""; CADDY_ADDRESS=""
BIND_ADDRESS=127.0.0.1   # only option 4 listens beyond this machine

pick_host_addr() { # pick_host_addr VAR default
  # not __ans: ask() has a local of that name, which would catch its answer
  local __var=$1 __def=$2 __addrs __i __pick=""
  command -v ip >/dev/null || die "The ip command is missing, so the machine addresses cannot be listed (sudo apt install iproute2)."
  mapfile -t __addrs < <(host_addrs)
  ((${#__addrs[@]})) || die "No network addresses found on this machine."
  [[ -n ${3:-} ]] || for __i in "${!__addrs[@]}"; do say "  $((__i + 1))) ${__addrs[$__i]}"; done
  ask __pick "Address (number or address)" "$__def" "${3:-}"
  if [[ $__pick =~ ^[0-9]{1,2}$ ]] && ((__pick >= 1 && __pick <= ${#__addrs[@]})); then __pick=${__addrs[$((__pick - 1))]}; fi
  __pick=${__pick#\[}; __pick=${__pick%\]}
  printf -v "$__var" '%s' "$__pick"
}

if [[ $ACCESS == 1 ]]; then
  say "  ${yellow}Traffic is unencrypted (http). Use it only on a trusted home network and do not open the port to the internet.${reset}"
  pick_def=${current_bind:-}
  [[ $pick_def != 127.0.0.1 ]] || pick_def=""
  # nothing asked on a plain run: the default-route address (the choice above made sure it is a private one)
  if ! $RECONFIGURE && [[ -z $A_BIND && -z $pick_def ]] && is_private_v4 "$route_addr"; then A_BIND=$route_addr; fi
  [[ -n $A_BIND ]] || say "  Machine addresses (0.0.0.0 = all addresses, not recommended):"
  pick_host_addr BIND_ADDRESS "${pick_def:-${route_addr:-$(host_addrs | head -1)}}" "$A_BIND"
  if [[ $(norm_addr "$BIND_ADDRESS") == "*" ]]; then
    warn "Listening on all addresses opens the app to every network of the machine. Docker bypasses the firewall (ufw) rules, so pick a single address instead."
    BIND_ADDRESS=0.0.0.0
  else
    host_has_addr "$BIND_ADDRESS" || die "The address $BIND_ADDRESS is not on this machine."
  fi
fi

# the port
load_used "$($EXISTING && echo "$PROJECT" || true)"
if $EXISTING; then
  default_port=$(existing HOST_PORT); default_port=${default_port:-8080}
else
  default_port=8080
  while port_taken "$default_port" "$BIND_ADDRESS" && ((default_port < 65535)); do default_port=$((default_port + 1)); done
fi
# The first free port is right for nearly everyone, so it is not asked. --port picks another.
HOST_PORT=${A_PORT:-$default_port}
if port_taken "$HOST_PORT" "$BIND_ADDRESS"; then
  die "Port $HOST_PORT is already in use on $BIND_ADDRESS (another program or another install). Pick another: ./scripts/install.sh --port <number>   (who uses it: ss -ltnp 'sport = :$HOST_PORT')"
fi
say "Port: ${bold}$HOST_PORT${reset}"

case $ACCESS in
  2) APP_BASE_URL="http://localhost:$HOST_PORT" ;;
  4)
    ask DOMAIN "Domain (for example talous.example.com)" "$(existing DOMAIN)" "$A_DOMAIN"
    [[ -n $DOMAIN ]] || die "The domain is missing. Give it with: --domain talous.example.com"
    valid_domain "$DOMAIN" || die "Invalid domain: $DOMAIN"
    ask ACME_EMAIL "Email for Let's Encrypt notices" "$(existing ACME_EMAIL)" "$A_EMAIL"
    [[ -n $ACME_EMAIL ]] || die "The email is missing. Give it with: --email you@example.com"
    [[ $ACME_EMAIL =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Invalid email address: $ACME_EMAIL"
    APP_BASE_URL="https://$DOMAIN"; PROFILES=caddy; TRUST_PROXY=true
    # Caddy needs 80 and 443. Another instance (or program) already on them: bind to an address of its own.
    if port_taken 80 "*" || port_taken 443 "*"; then
      say "  Port 80 or 443 is already in use (another Caddy or program). Caddy needs an IP address of its own."
      say "  Machine addresses:"
      pick_host_addr CADDY_ADDRESS "$(existing CADDY_ADDRESS)" "$A_BIND"
      [[ -n $CADDY_ADDRESS ]] || die "The address is missing."
      host_has_addr "$CADDY_ADDRESS" || die "The address $CADDY_ADDRESS is not on this machine."
      if port_taken 80 "$CADDY_ADDRESS" || port_taken 443 "$CADDY_ADDRESS"; then
        wild=$(wildcard_caddy_owner || true)
        if [[ -n $wild ]]; then
          wild_dir=${wild#*|}; wild=${wild%%|*}
          die "The Caddy of install $wild listens on ports 80 and 443 on all addresses, so no other address works. Add the line CADDY_ADDRESS=<its own IP> to ${wild_dir:-<its folder>}/.env and run docker compose up -d in that folder. Then try this install again."
        fi
        die "Ports 80 and 443 are not free on $CADDY_ADDRESS. Use another IP address or choice 3 (Cloudflare Tunnel), or put your own proxy in front of the app port $HOST_PORT."
      fi
    fi
    ;;
  3)
    cf_setup_if_missing
    cf_tunnel
    APP_BASE_URL="https://$DOMAIN"; PROFILES=tunnel; TRUST_PROXY=true
    ;;
  1)
    url_addr=$BIND_ADDRESS
    if [[ $BIND_ADDRESS == 0.0.0.0 ]]; then
      ask url_addr "Address the app is reached by (IP or name)" "$(host_addrs | head -1)" "$A_URL_ADDR"
    fi
    [[ $url_addr =~ ^[A-Za-z0-9.:-]+$ ]] || die "Invalid address: $url_addr"
    APP_BASE_URL="http://$(url_host "$url_addr"):$HOST_PORT"
    ;;
  *) die "Unknown choice: $ACCESS" ;;
esac
APP_BASE_URL=${APP_BASE_URL%/}
ok "Address: $APP_BASE_URL  ${dim}(can be changed in the browser)${reset}"
settle_answers
fi

# ── the last answer is in: Docker, the long steps ────────────────────────────────
prep_host

if ! $KEEP_ALL; then
# A home network address can appear after Docker starts at boot. Without this setting Docker cannot bind it then and the app stays down.
if is_private_v4 "$BIND_ADDRESS" && [[ $(cat /proc/sys/net/ipv4/ip_nonlocal_bind 2>/dev/null) != 1 || ! -f /etc/sysctl.d/90-omatalous.conf ]]; then
  if echo "net.ipv4.ip_nonlocal_bind=1" | as_root tee /etc/sysctl.d/90-omatalous.conf >/dev/null 2>&1 && as_root sysctl -q -w net.ipv4.ip_nonlocal_bind=1 >/dev/null 2>&1; then
    ok "Set net.ipv4.ip_nonlocal_bind=1, so Docker can bind the address when it appears late at boot."
  else
    warn "Could not set net.ipv4.ip_nonlocal_bind=1. If the app stays down after a reboot, run: echo net.ipv4.ip_nonlocal_bind=1 | sudo tee /etc/sysctl.d/90-omatalous.conf && sudo sysctl --system"
  fi
fi

# ── write .env ───────────────────────────────────────────────────────────────
step "Writing .env"
umask 077
# optional settings the questions above do not cover survive a re-run (ACCESS_LAN_BIND: scripts/lib/ops-access.sh;
# TALOUS_CHANNEL, TALOUS_PRERELEASE and TALOUS_PRIVATE_BUILD: the release channel and the build, which the block below
# and update.sh read and never write)
KEEP=()
for key in TZ SETUP_CODE INDUSTRY_LOOKUP ACCESS_LAN_BIND TALOUS_CHANNEL TALOUS_PRERELEASE TALOUS_PRIVATE_BUILD; do
  value=$(existing "$key")
  [[ -n $value ]] && KEEP+=("$key=$value")
done
if [[ -f $ENV_FILE ]]; then
  cp -p "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  ok "Old .env backed up."
fi
{
  cat <<ENV
# Written by scripts/install.sh on $(date '+%Y-%m-%d %H:%M'). Re-run the script to change.
# Only infrastructure lives here. Address, time zone, sync times and the
# Enable Banking key are set in the browser (Asetukset > Palvelin).

# Default address for the setup wizard
APP_BASE_URL=$APP_BASE_URL
# true behind Caddy / Cloudflare Tunnel (trust X-Forwarded-* headers)
TRUST_PROXY=$TRUST_PROXY
COMPOSE_PROFILES=$PROFILES

# This instance. Do not change the names of a running install. The volumes are named after the project.
ENV
  $WRITE_INSTANCE && echo "INSTANCE_NAME=$INSTANCE"
  cat <<ENV
COMPOSE_PROJECT_NAME=$PROJECT
HOST_PORT=$HOST_PORT
BIND_ADDRESS=$BIND_ADDRESS
ENV
  # an IPv6 address needs brackets in the compose port syntax
  [[ -z $CADDY_ADDRESS ]] || echo "CADDY_ADDRESS=$(url_host "$CADDY_ADDRESS")"
  cat <<ENV

# HTTPS options
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
CLOUDFLARE_TUNNEL_TOKEN=$TUNNEL_TOKEN
ENV
  # CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN (the app's own check of Cloudflare Access): cf_up writes them after
  # `cloudflare up`; a tunnel made by hand keeps its own; any other way in leaves them out (scripts/lib/cloudflare.sh)
  cf_access_kept
  [[ -z $ACCESS_EMAILS ]] || echo "CLOUDFLARE_ACCESS_EMAILS=$ACCESS_EMAILS"
  # not this copy's in Cloudflare until `cloudflare up --new` made it (scripts/lib/cloudflare.sh, cf_mine)
  ! $CF_NEW || echo "CLOUDFLARE_NEW_HOST=$DOMAIN"
  if ((${#KEEP[@]})); then
    echo; echo "# Kept from the previous .env"; printf '%s\n' "${KEEP[@]}"
  fi
} >"$ENV_FILE.new"
# written whole or not at all: a Ctrl-C here leaves the old .env
chmod 600 "$ENV_FILE.new"; mv -f "$ENV_FILE.new" "$ENV_FILE"
ok ".env written (mode 600)."
fi
# a COMPOSE_PROJECT_NAME in the shell beats .env and would name the volumes differently
[[ $(project_name) == "$PROJECT" ]] || die "Compose uses the project name $(project_name), expected $PROJECT. Is COMPOSE_PROJECT_NAME set in the shell? (unset COMPOSE_PROJECT_NAME)"

# ── 4. build, start, setup code ──────────────────────────────────────────────
step "Building and starting"
# the image remembers which commit it was built from (update.sh and doctor.sh compare it with the checkout)
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo unknown); export GIT_COMMIT
# Channel: the signed release image when this checkout is exactly a release (a tag vX.Y.Z), else the source built here
# (a clone ahead of the newest release, no release yet, or TALOUS_CHANNEL=source). update.sh uses the same rule.
CHANNEL=source; UP_FLAGS=""; LOG=$(mktemp)
if [[ ${TALOUS_CHANNEL:-$(existing TALOUS_CHANNEL)} != source ]]; then
  # the release this checkout is at (a bootstrap clone sits on one and holds every tag, a pre-release among them),
  # else the newest tag as before
  REL_TAG=$(git tag --points-at HEAD 2>/dev/null | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true)
  [[ -n $REL_TAG ]] || REL_TAG=$(latest_release)
  if [[ -n $REL_TAG ]]; then
    REL_COMMIT=$(git rev-parse "$REL_TAG^{commit}")
    if [[ $REL_COMMIT == "$(git rev-parse HEAD 2>/dev/null)" ]]; then CHANNEL=release
    elif git merge-base --is-ancestor HEAD "$REL_COMMIT" 2>/dev/null; then
      warn "This folder is older than release $REL_TAG. Building the code in the folder. Move to the release after the install: ./scripts/update.sh"
    fi
  fi
fi
if [[ $CHANNEL == release ]]; then
  say "Channel: release $REL_TAG"
  # shellcheck disable=SC2034
  IMAGE=$INSTANCE
  docker image inspect "$INSTANCE:latest" >/dev/null 2>&1 || say "${dim}Pulling the image takes a moment.${reset}"
  fetch_release_image "$REL_TAG" "$REL_COMMIT"
  UP_FLAGS="--no-build"
else
docker image inspect "$INSTANCE:latest" >/dev/null 2>&1 || say "${dim}The first build takes a few minutes.${reset}"
build_rc=0
run_logged "$LOG" "Building" $DC build banking || build_rc=$?
if ((build_rc != 0)); then
  tail -n 25 "$LOG" | cut -c1-200
  if grep -qiE 'no space left|ENOSPC|disk quota' "$LOG"; then
    die "The disk filled up during the build. Free some space (df -h; docker image prune -f; docker builder prune -f) and run this again, it continues where it stopped."
  elif grep -qiE '429 Too Many|toomanyrequests|rate limit' "$LOG"; then
    die "Docker Hub limits pulls from this address (too many requests). Wait an hour and run this again, or log in: docker login"
  elif grep -qiE 'ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|could not resolve|temporary failure in name|i/o timeout|dial tcp|TLS handshake|failed to fetch|failed to resolve source|network is unreachable|unable to get image|Get "https' "$LOG"; then
    die "The build had no network connection (packages and the base image are downloaded). Check the connection (curl -I https://registry.npmjs.org, docker pull node:22-alpine) and run this again."
  elif grep -qE 'FAIL|Test Files .*failed|tests? failed' "$LOG"; then
    die "The tests of the build failed. The code on this branch is broken. Try another version or report the problem (end of the log above)."
  fi
  die "The build failed (end of the log above). Run this again. If the error comes back: ./scripts/doctor.sh"
fi
fi

# An earlier version of this script kept the app secret in ./secrets. Copy it into
# the secrets volume once, so bank keys encrypted with it stay readable.
if [[ -s $LEGACY_SECRET ]]; then
  if $DC run --rm --no-deps -T --entrypoint sh banking -c 'umask 077; [ -s /secrets/app_secret ] && exit 3; cat > /secrets/app_secret' <"$LEGACY_SECRET"; then
    ok "The app secret of the earlier install was moved to the volume ${PROJECT}_banking-secrets."
  fi
  warn "The folder secrets/ is no longer used. Delete it once the app works: rm -r secrets"
fi

cf_up
up_rc=0
run_logged "$LOG" "Starting" $DC up -d $UP_FLAGS || up_rc=$?
if ((up_rc != 0)); then
  tail -n 15 "$LOG" | cut -c1-200
  if grep -qiE 'port is already allocated|address already in use|bind: ' "$LOG"; then
    die "Port $HOST_PORT or 80/443 is already used by another program. See who: ss -ltnp 'sport = :$HOST_PORT'. Pick another port: ./scripts/install.sh --reconfigure --port <number>"
  elif grep -qiE 'no space left' "$LOG"; then
    die "The disk filled up while starting. Free some space (df -h; docker image prune -f; docker builder prune -f) and run this again."
  elif grep -qiE 'pull access denied|failed to resolve|i/o timeout|TLS handshake|no such host|Get "https' "$LOG"; then
    die "Could not pull the Caddy or tunnel image. Check the network connection and run this again."
  fi
  die "Starting failed (error above). Run this again. If the error comes back: ./scripts/doctor.sh"
fi
say "Waiting for the app…"
# from inside the container, so the bind address and port do not matter. exec fails while the
# container restarts, which only means "not yet".
app_up() { $DC exec -T banking wget -qO- http://127.0.0.1:8080/api/health >/dev/null 2>&1; }
for _ in $(seq 1 60); do
  if app_up; then break; fi
  # a container that keeps restarting will not come up by waiting
  cid=$($DC ps -a -q banking 2>/dev/null | head -1 || true)
  [[ -z $cid ]] || [[ $(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0) -lt 3 ]] || break
  sleep 2
done
if ! app_up; then
  $DC logs --no-color --tail 15 banking 2>&1 | cut -c1-200 || true
  die "The app did not start (end of the log above). Run: ./scripts/doctor.sh   and for more: docker compose logs --tail 60 banking. After fixing it, run this again."
fi
ok "The app is running."

# The address lives in the database after setup, so a changed access has to be written there too. A plain re-run
# that keeps .env leaves it alone (the admin may have changed it in the browser), but a resumed install writes it.
# A new install has nothing stored and uses .env as it is. The command runs in a second process and the server
# caches the address, so the app restarts, and only when the address really changed.
if $EXISTING && { ! $KEEP_ALL || $RESUMED; }; then
  if addr_out=$($DC exec -T banking $NODE address set "$APP_BASE_URL" 2>&1); then
    ok "$(printf '%s' "$addr_out" | tail -1)"
    if [[ $addr_out == *" is now "* ]]; then
      $DC restart banking >/dev/null 2>&1 || true
      for _ in $(seq 1 30); do app_up && break; sleep 2; done
      app_up || warn "The app does not respond after the restart. Run: ./scripts/doctor.sh"
    fi
  else warn "Could not update the app address ($(printf '%s' "$addr_out" | tail -1)). Set it in the browser: Asetukset > Palvelin."; fi
fi

# a fresh one-time code (only while no user exists)
CODE=$($DC exec -T banking $NODE setup-code 2>/dev/null | tail -1 || true)

# the maintenance helper (update, backup and restart from the browser); a problem here never fails the install
OPS_KIND=none; OPS_NOTE=""; OPS_LABEL=off; OPS_TODO=""; OPS_WHY=""
if $OPS_HELPER; then
  step "Maintenance helper"
  setup_ops_helper
  if [[ $OPS_KIND == none ]]; then warn "$OPS_NOTE"; elif [[ -n $OPS_TODO ]]; then warn "$OPS_TODO"; else ok "Maintenance helper on: $OPS_NOTE"; fi
  if [[ $OPS_KIND == cron && -z $OPS_WHY ]]; then say "${dim}A systemd user timer would need user services to keep running after logout (sudo loginctl enable-linger $(id -un)). Cron works without it.${reset}"; fi
else
  OPS_NOTE="off (--no-ops-helper)"
fi

# the end: the address, the setup link, what is left to do
case $OPS_KIND in
  systemd|cron) ;;  # OPS_LABEL came with the scheduling
  *) OPS_LABEL="off"; [[ $OPS_NOTE != "off"* ]] || OPS_LABEL=$OPS_NOTE ;;
esac
IN=""; [[ $INSTANCE == "$DEFAULT_INSTANCE" ]] || IN="cd $ROOT && "
say ""
say "${bold}${green}Omatalous is running:${reset} ${bold}$APP_BASE_URL${reset}   ${dim}(instance $INSTANCE)${reset}"
if [[ $CODE =~ ^[a-z0-9]{4}(-[a-z0-9]{4}){3}$ ]]; then
  say "Set up: ${bold}$APP_BASE_URL/#koodi=$CODE${reset}   ${dim}(the one-time code is in the link)${reset}"
  # the same link as a QR code for a phone. qrencode is never installed from here. The link goes in through stdin: the
  # code stays out of the process list.
  if command -v qrencode >/dev/null 2>&1; then
    printf '%s' "$APP_BASE_URL/#koodi=$CODE" | qrencode -t ANSIUTF8 -m 1 || true
  else
    say "${dim}A QR code of this link for your phone: sudo apt install qrencode, then run ./scripts/install.sh again.${reset}"
  fi
else
  say "Open the address and sign in."
fi
if [[ $ACCESS == 1 ]]; then
  say "Reserve a fixed address for this machine in the router (DHCP reservation) so the address does not change. Maintenance helper: $OPS_LABEL."
else
  say "Maintenance helper: $OPS_LABEL. Troubleshooting: ${IN}./scripts/doctor.sh"
fi
[[ $ACCESS != 4 ]] || say "${dim}Let's Encrypt: a DNS A record to the public IP and ports 80 and 443 forwarded to this machine.${reset}"
[[ $ACCESS != 3 ]] || cf_final
