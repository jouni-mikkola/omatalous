#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous installer. Infrastructure only:
#
#   ./scripts/install.sh                       install or re-run in this directory, no questions
#   ./scripts/install.sh --reconfigure         the access menu (home network / this machine / tunnel / domain)
#   ./scripts/install.sh --new-instance NAME   clone this repository to ../NAME and install it there
#   ./scripts/install.sh --ops-helper          (re)install the maintenance helper only (--ops-helper-off removes it)
#
#   • binds to this machine's home-network address (the default-route address, only if it is private:
#     10/8, 172.16/12, 192.168/16), else to 127.0.0.1, and writes .env (mode 600, old one backed up)
#   • pulls and verifies the signed release image (or builds the source until a release exists, or with
#     TALOUS_CHANNEL=source in .env) and starts the containers
#   • installs the maintenance helper (systemd user timer, else cron) for Asetukset > Palvelin > Ylläpito
#   • prints the address and a setup link with the one-time code filled in
#
# Nothing is asked by default. Answers are flags or environment variables; --reconfigure shows the access menu:
#   --access lan|local|tunnel|domain   TALOUS_ACCESS        how the app is reached (default lan, see above)
#   --domain talous.oma.fi             TALOUS_DOMAIN        for domain and tunnel
#   --email you@oma.fi                 TALOUS_EMAIL         for domain (Let's Encrypt)
#   (no flag, so it stays out of ps)   TALOUS_TUNNEL_TOKEN  for tunnel
#   --port 8080                        TALOUS_PORT          default: the first free port from 8080
#   --bind 192.168.1.10                TALOUS_BIND          for lan: the host address to listen on (default: the default route's)
#   --no-ops-helper                    TALOUS_OPS_HELPER=0  leave the maintenance helper out
#   --name NAME                        TALOUS_NAME          instance name (default: directory name)
#   --install-docker                                        install Docker (apt based systems) if missing
#   --reconfigure                                           show the access menu on an existing install
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
ORIG_ARGS=("$@")
YES=false; RECONFIGURE=false; INSTALL_DOCKER=false; FROM_CLONE=false; NEW_INSTANCE=""
OPS_ONLY=""; OPS_POLICY=false; OPS_HELPER=true; [[ ${TALOUS_OPS_HELPER:-1} != 0 ]] || OPS_HELPER=false
A_ACCESS=${TALOUS_ACCESS:-}; A_DOMAIN=${TALOUS_DOMAIN:-}; A_EMAIL=${TALOUS_EMAIL:-}
A_PORT=${TALOUS_PORT:-}; A_BIND=${TALOUS_BIND:-}; A_TOKEN=${TALOUS_TUNNEL_TOKEN:-}
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
# confirm "Question" default(K/e): returns 0 for yes
confirm() {
  local __q=$1 __def=${2:-K} __ans=""
  $YES && { [[ $__def == K ]]; return; }
  read -r -p "$__q [$( [[ $__def == K ]] && echo K/e || echo k/E )]: " __ans || true
  __ans=${__ans:-$__def}
  [[ $__ans =~ ^[KkYy] ]]
}
# the helper's scheduling (timer or cron), shared with reset.sh
# shellcheck source=lib/ops-schedule.sh
. "$ROOT/scripts/lib/ops-schedule.sh"

# The maintenance helper: ops/ (mode 700), the policy it holds the clone to, and the timer or cron line.
# Sets OPS_KIND (systemd, cron, none) and OPS_NOTE. Never fails the install.
setup_ops_helper() {
  local url branch dockerbin keep=false
  OPS_KIND=none
  # the helper refuses to run as root, so a timer for root would only report "off" forever
  if [[ $(id -u) -eq 0 ]]; then
    OPS_NOTE="ei käytössä (asennus ajettiin pääkäyttäjänä; aja asennus tavallisella käyttäjällä)"
    return 0
  fi
  # the helper checks the new compose file with jq
  if ! command -v jq >/dev/null 2>&1; then
    OPS_NOTE="ei käytössä (jq puuttuu; asenna: sudo apt install jq, ja aja ./scripts/install.sh --ops-helper)"
    return 0
  fi
  umask 077
  mkdir -p ops/journal ops/run && chmod 700 ops ops/journal ops/run
  # the helper refuses a clone, scripts folder or script that others can write to (Ubuntu's umask 002 makes 775)
  chmod go-w . scripts scripts/lib 2>/dev/null || true
  chmod go-w scripts/*.sh scripts/lib/*.sh 2>/dev/null || true
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
    [[ -n $url && -n $branch ]] || warn "Gitin etäosoite tai haara puuttuu, joten päivitys selaimesta ei toimi ennen kuin ne on asetettu. Korjaa ja aja: ./scripts/install.sh --ops-helper --ops-policy"
  fi
  ops_scheduler_install "$INSTANCE" "$ROOT" || true
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
# working directories of the containers of a Compose project, one per line
project_dirs() { docker ps -a --filter "label=com.docker.compose.project=$1" --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | sort -u; }
project_volumes() { docker volume ls -q --filter "label=com.docker.compose.project=$1" 2>/dev/null; }
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
    warn "ss puuttuu, portit tarkistetaan vain Dockerin kontteja vasten."
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
# global addresses of this host, one per line (no loopback, link-local or Docker bridges)
host_addrs() { ip -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth)/ {split($4, a, "/"); print a[1]}'; }
# the source address of the default route (what other devices on the network reach this machine by)
default_route_addr() { ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}' || true; }
# home-network ranges only: 10/8, 172.16/12, 192.168/16
is_private_v4() {
  local a=${1:-} o1 o2
  [[ $a =~ ^([0-9]{1,3})\.([0-9]{1,3})\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
  o1=$((10#${BASH_REMATCH[1]})); o2=$((10#${BASH_REMATCH[2]}))
  ((o1 == 10)) || ((o1 == 172 && o2 >= 16 && o2 <= 31)) || ((o1 == 192 && o2 == 168))
}
host_has_addr() {
  local want; want=$(norm_addr "$1")
  local a addrs
  # no pipe into grep -q: it exits at the first match and the writer gets SIGPIPE, which fails under pipefail
  addrs=$(host_addrs)
  while IFS= read -r a; do
    [[ -n $a && $(norm_addr "$a") == "$want" ]] && return 0
  done <<<"$addrs"
  return 1
}
# project of a container that holds 80 or 443 on all addresses (a Caddy without CADDY_ADDRESS), if any
wildcard_caddy_owner() {
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
  [[ $name =~ $NAME_RE ]] || die "Nimen pitää olla pieniä kirjaimia, numeroita, - tai _ (alkaa kirjaimella tai numerolla, enintään 41 merkkiä)."
  command -v git >/dev/null || die "git puuttuu."
  target="$(dirname "$ROOT")/$name"
  [[ ! -e $target ]] || die "Kansio $target on jo olemassa."
  origin=$(git remote get-url origin 2>/dev/null) || die "Tällä kopiolla ei ole etärepositoriota (origin)."
  branch=$(git symbolic-ref --short HEAD 2>/dev/null) || die "Kopio ei ole millään haaralla (git checkout <haara>)."
  if docker info >/dev/null 2>&1 && [[ -n $(project_volumes "$name")$(project_dirs "$name") ]]; then
    die "Nimellä $name on jo Docker-projekti tai sen taltioita. Valitse toinen nimi."
  fi
  step "Kloonataan $branch kansioon $target"
  say "${dim}Mukaan tulee vain se, mikä on työnnetty etärepositorioon (origin/$branch).${reset}"
  git clone -b "$branch" "$origin" "$target"
  grep -q -- '--name' "$target/scripts/install.sh" || die "Haaran $branch asennusskripti ei vielä tunne tätä toimintoa. Työnnä muutokset (git push) ja yritä uudelleen. Kansio $target jäi paikalleen."
  exec "$target/scripts/install.sh" --name "$name" --from-clone ${PASS[@]+"${PASS[@]}"}
}

usage() { die "Käyttö: ./scripts/install.sh [--yes] [--new-instance NIMI] [--access lan|local|tunnel|domain] [--domain D] [--email E] [--port P] [--bind IP] [--name N] [--install-docker] [--reconfigure] [--ops-helper [--ops-policy] | --ops-helper-off | --no-ops-helper]"; }
while (($#)); do
  case $1 in
    --yes|-y) YES=true; PASS+=("$1") ;;
    --reconfigure) RECONFIGURE=true ;;
    --install-docker) INSTALL_DOCKER=true; PASS+=("$1") ;;
    --from-clone) FROM_CLONE=true ;;
    --ops-helper) OPS_ONLY=on ;;
    --ops-policy) OPS_POLICY=true ;;
    --ops-helper-off) OPS_ONLY=off ;;
    --no-ops-helper) OPS_HELPER=false; PASS+=("$1") ;;
    --new-instance|--name|--access|--domain|--email|--port|--bind)
      [[ $# -ge 2 && $2 != --* ]] || { REPORTED=true; usage; }
      case $1 in
        --new-instance) NEW_INSTANCE=$2 ;;
        --name) PRESET_NAME=$2 ;;
        --access) A_ACCESS=$2; PASS+=("$1" "$2") ;;
        --domain) A_DOMAIN=$2; PASS+=("$1" "$2") ;;
        --email) A_EMAIL=$2; PASS+=("$1" "$2") ;;
        --port) A_PORT=$2; PASS+=("$1" "$2") ;;
        --bind) A_BIND=$2; PASS+=("$1" "$2") ;;
      esac
      shift ;;
    *) usage ;;
  esac
  shift
done
[[ -z $NEW_INSTANCE ]] || new_instance "$NEW_INSTANCE"
if [[ -n $PRESET_NAME ]]; then
  [[ $PRESET_NAME =~ $NAME_RE ]] || die "Virheellinen nimi: $PRESET_NAME"
fi
case ${A_ACCESS,,} in
  "") ;;
  1|lan) A_ACCESS=1 ;;
  2|local|localhost) A_ACCESS=2 ;;
  3|tunnel|cloudflare) A_ACCESS=3 ;;
  4|domain|caddy) A_ACCESS=4 ;;
  *) die "Tuntematon --access: $A_ACCESS (lan, local, tunnel tai domain)." ;;
esac
[[ -z $A_PORT ]] || { [[ $A_PORT =~ ^[1-9][0-9]{3,4}$ ]] && ((A_PORT >= 1024 && A_PORT <= 65535)) || die "Portin pitää olla 1024-65535."; }

# One run per directory. The lock is on this script file, so update.sh (which takes the same lock) and a
# second install.sh wait for each other. It goes away with the process, a Ctrl-C leaves nothing behind.
exec 9<"$ROOT/scripts/install.sh"
if command -v flock >/dev/null && ! flock -n 9; then
  die "Toinen asennus tai päivitys on jo käynnissä tässä kansiossa. Odota, että se valmistuu, ja aja tämä sitten uudelleen."
fi

# What the user sees when the run stops half way. Nothing is left in a state a re-run cannot continue from.
on_exit() {
  local rc=$?
  [[ -z ${LOG:-} ]] || rm -f "$LOG"
  ((rc == 0)) && return
  if ! $REPORTED; then
    printf '\n%s✗ Asennus keskeytyi.%s Voit ajaa sen turvallisesti uudelleen: %s/scripts/install.sh\n  Jos sama vika toistuu: %s/scripts/doctor.sh\n' "$red" "$reset" "$ROOT" "$ROOT" >&2
  fi
  # a failure right after the clone leaves the folder behind: say what to do with it
  if $FROM_CLONE && [[ ! -f $ENV_FILE ]]; then
    printf '%sKansio %s jäi paikalleen. Jatka: %s/scripts/install.sh --name %s   tai poista: rm -rf %s%s\n' "$dim" "$ROOT" "$ROOT" "$PRESET_NAME" "$ROOT" "$reset" >&2
  fi
}
trap on_exit EXIT
interrupted() {
  REPORTED=true
  printf '\n%sKeskeytetty. Mitään ei tarvitse siivota, aja uudelleen: %s/scripts/install.sh%s\n' "$yellow" "$ROOT" "$reset" >&2
  exit 130
}
trap interrupted INT TERM

# helper only: no Docker needed to set up or remove the timer
if [[ -n $OPS_ONLY ]]; then
  [[ -f $ENV_FILE ]] || die "Tässä kansiossa ei ole asennusta (.env puuttuu). Aja ensin ./scripts/install.sh"
  INSTANCE=$(existing INSTANCE_NAME); INSTANCE=${INSTANCE:-$DEFAULT_INSTANCE}
  [[ $INSTANCE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "INSTANCE_NAME tiedostossa .env on virheellinen: $INSTANCE"
  if [[ $OPS_ONLY == off ]]; then
    ops_scheduler_remove "$INSTANCE"
    ok "Ylläpitoapuri poistettu käytöstä ($INSTANCE). Kansio ops/journal säilyy."
  else
    setup_ops_helper
    if [[ $OPS_KIND == none ]]; then warn "$OPS_NOTE"; exit 1; fi
    ok "Ylläpitoapuri käytössä: $OPS_NOTE"
  fi
  exit 0
fi

# ── 0. prerequisites ─────────────────────────────────────────────────────────
step "Tarkistetaan vaatimukset"

# runs a command as root (directly, or through sudo)
as_root() {
  if ((EUID == 0)); then "$@"
  elif command -v sudo >/dev/null; then if $YES; then sudo -n "$@"; else sudo "$@"; fi
  else return 1; fi
}
in_docker_group() { getent group docker 2>/dev/null | cut -d: -f4 | tr , '\n' | grep -qx "${USER:-$(id -un)}"; }
# the docker group may be new to this login: run the script again with it (no logout needed)
reexec_with_group() {
  [[ -z ${TALOUS_REEXEC:-} ]] && command -v sg >/dev/null || return 1
  say "Avataan uusi istunto docker-ryhmällä ja jatketaan."
  export TALOUS_REEXEC=1
  exec 9<&-   # the new process takes the lock again
  exec sg docker -c "$(printf '%q ' "$ROOT/scripts/install.sh" ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"})"
}

if ! command -v docker >/dev/null; then
  can_install=false
  [[ -r /etc/os-release ]] && command -v curl >/dev/null && { ((EUID == 0)) || command -v sudo >/dev/null; } && can_install=true
  if $can_install && { $INSTALL_DOCKER || { ! $YES && confirm "Docker puuttuu. Asennetaanko se nyt Dockerin omalla asennusskriptillä (get.docker.com)?" K; }; }; then
    step "Asennetaan Docker"
    installer=$(mktemp)
    curl -fsSL https://get.docker.com -o "$installer" || { rm -f "$installer"; die "Docker-asentajaa ei saatu ladattua. Tarkista verkkoyhteys (curl -I https://get.docker.com) ja aja tämä uudelleen."; }
    as_root sh "$installer" || { rm -f "$installer"; die "Dockerin asennus epäonnistui. Katso virhe yltä. Asennusohje: docs/INSTALL.md (kohta 3)."; }
    rm -f "$installer"
    as_root systemctl enable --now docker >/dev/null 2>&1 || true
  else
    die "Docker puuttuu. Asenna se: curl -fsSL https://get.docker.com | sudo sh   (tai aja tämä skripti uudelleen valinnalla --install-docker). Lisätietoja: docs/INSTALL.md (kohta 3)."
  fi
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 puuttuu. Asenna: sudo apt install docker-compose-plugin"
if ! docker info >/dev/null 2>&1; then
  derr=$(docker info 2>&1 >/dev/null | head -3 || true)
  if [[ $derr == *"permission denied"* ]]; then
    if ! in_docker_group; then
      if ! $YES && ! confirm "Käyttäjälläsi ei ole oikeutta Dockeriin. Lisätäänkö se docker-ryhmään (sudo usermod -aG docker $USER)?" K; then
        die "Ilman docker-ryhmää asennus ei onnistu. Aja: sudo usermod -aG docker \$USER   ja kirjaudu ulos ja sisään."
      fi
      as_root usermod -aG docker "${USER:-$(id -un)}" || die "Ryhmän lisäys ei onnistunut. Aja: sudo usermod -aG docker \$USER   ja kirjaudu ulos ja sisään."
    fi
    reexec_with_group || true
    die "Käyttäjälläsi ei ole vielä oikeutta Dockeriin tässä istunnossa. Kirjaudu ulos ja sisään (tai aja: newgrp docker) ja aja tämä uudelleen."
  else
    # the daemon is installed but not running
    if command -v systemctl >/dev/null && as_root systemctl start docker >/dev/null 2>&1; then
      for _ in $(seq 1 20); do docker info >/dev/null 2>&1 && break; sleep 1; done
    fi
    docker info >/dev/null 2>&1 || die "Docker-palvelu ei käynnisty. Aja: sudo systemctl start docker   ja katso syy: sudo journalctl -u docker -n 30. Aja sitten tämä uudelleen."
  fi
fi
ok "Docker $(docker version --format '{{.Server.Version}}'), Compose $(docker compose version --short)"
# after a reboot the app returns by itself only if the Docker service starts with the machine
if command -v systemctl >/dev/null && systemctl cat docker.service >/dev/null 2>&1 && [[ $(systemctl is-enabled docker 2>/dev/null) != enabled ]]; then
  if as_root systemctl enable docker >/dev/null 2>&1; then ok "Docker käynnistyy nyt koneen mukana."
  else warn "Docker ei käynnisty koneen mukana, joten sovellus ei palaa itsestään uudelleenkäynnistyksen jälkeen. Aja: sudo systemctl enable docker"; fi
fi
# a build needs about 2 GB; stopping half way on a full disk helps nobody
droot=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)
if [[ -n $droot && -d $droot ]]; then
  free_kb=$(df -Pk "$droot" 2>/dev/null | awk 'NR==2 {print $4}')
  if [[ -n ${free_kb:-} ]]; then
    ((free_kb >= 1024 * 1024)) || die "Levyllä on vain $((free_kb / 1024)) Mt vapaata ($droot), rakennus tarvitsee noin 2 Gt. Vapauta tilaa (docker image prune -f; docker builder prune -f; df -h) ja aja tämä uudelleen."
    ((free_kb >= 2048 * 1024)) || warn "Levyllä on vapaata vain $((free_kb / 1024)) Mt. Rakennus voi loppua kesken, jos tila ei riitä."
  fi
fi

say ""
say "${bold}Talouden asennus${reset}"
say "${dim}Mitään ei kysytä. Muut asetukset tehdään selaimessa.${reset}"

# ── 1. name ──────────────────────────────────────────────────────────────────
# Each instance is a Compose project in its own directory. An install that exists keeps its names
# (volumes are named after the project, so a new name would make the data look gone).
step "Asennus"
PROJECT=$(project_name)
EXISTING=false
if [[ -f $ENV_FILE || $(project_owner "$PROJECT") == mine ]]; then EXISTING=true; fi

NAME_MSG=""; NAME_VOLS=""
# name_problem NAME: 0 = free, 1 = taken by another directory, 2 = only old volumes of that name exist
name_problem() {
  local n=$1 cproj
  NAME_MSG=""; NAME_VOLS=""
  if [[ $(project_owner "$n") == other ]]; then
    NAME_MSG="Nimi $n on jo toisen kansion asennuksella."; return 1
  fi
  if cproj=$(docker container inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$n" 2>/dev/null) && [[ $cproj != "$n" ]]; then
    NAME_MSG="Kontti nimeltä $n on jo olemassa."; return 1
  fi
  if [[ $n == session ]]; then
    NAME_MSG="Nimi session on varattu (se on vanhan istuntoevästeen nimi)."; return 1
  fi
  NAME_VOLS=$(project_volumes "$n" | tr '\n' ' ')
  if [[ -n $NAME_VOLS ]]; then
    NAME_MSG="Nimellä $n on jo taltioita: ${NAME_VOLS% }. Ne voivat olla toisen kansion vanhoja tietoja."; return 2
  fi
  # no container, project or volumes of this name: an image of that name (any tag, caddy:2 too) is then
  # something else, and update.sh and reset.sh would tag over or remove $n:latest
  if [[ -n $(docker image ls -q "$n" 2>/dev/null) ]]; then
    NAME_MSG="Nimellä $n on jo Docker-image. Valitse toinen nimi."; return 1
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
  [[ -z $PRESET_NAME || $PRESET_NAME == "$PROJECT" ]] || die "Tässä kansiossa on jo asennus (projekti $PROJECT). Uusi instanssi tehdään toiseen kansioon: ./scripts/install.sh --new-instance NIMI"
  INSTANCE=$(existing INSTANCE_NAME)
  if [[ -n $INSTANCE ]]; then
    [[ $INSTANCE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "INSTANCE_NAME tiedostossa .env on virheellinen: $INSTANCE"
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
  say "Olemassa oleva asennus säilyttää nimensä."
  say "  projekti ${bold}$PROJECT${reset}, kontti ${bold}$INSTANCE${reset}"
  say "  taltiot ${PROJECT}_banking-data ja ${PROJECT}_banking-secrets"
else
  default_name=${PRESET_NAME:-$(compose_name "$(basename "$ROOT")")}
  [[ $default_name =~ $NAME_RE ]] || default_name=""
  # The directory name is the right name for nearly everyone, so nothing is asked unless it is unusable.
  INSTANCE=""
  for _try in 1 2 3 4 5; do
    cand=$default_name
    if [[ ! $cand =~ $NAME_RE ]]; then
      [[ -z $PRESET_NAME ]] || die "Virheellinen nimi: $PRESET_NAME"
      say "Kansion nimestä ei saa asennuksen nimeä."
      ask cand "Asennuksen nimi (pieniä kirjaimia, numeroita, - ja _)" "banking-app"
      [[ $cand =~ $NAME_RE ]] || { warn "Nimi saa sisältää pieniä kirjaimia, numeroita, - ja _ (alkaa kirjaimella tai numerolla, enintään 41 merkkiä)."; $YES && exit 1; default_name=""; continue; }
    fi
    status=0; name_problem "$cand" || status=$?
    if ((status == 1)); then
      sug=$(suggest_name "$cand")
      [[ -z $PRESET_NAME && -n $sug ]] || die "$NAME_MSG${sug:+ Vapaa nimi: $sug}"
      warn "$NAME_MSG Käytetään nimeä $sug."
      default_name=$sug; continue
    elif ((status == 2)); then
      warn "$NAME_MSG"
      if [[ -z $PRESET_NAME ]] && ! $YES && confirm "Käytetäänkö nämä taltiot ja niiden tiedot tälle asennukselle?" E; then :
      else
        [[ -z $PRESET_NAME ]] || die "Valitse toinen nimi (--name), tai poista vanhat taltiot jos niitä ei tarvita: docker volume rm ${NAME_VOLS% }"
        default_name=$(suggest_name "$cand"); [[ -n $default_name ]] || die "Vapaata nimeä ei löytynyt."
        say "Käytetään nimeä $default_name."; continue
      fi
    fi
    INSTANCE=$cand; break
  done
  [[ -n $INSTANCE ]] || die "Nimeä ei valittu."
  PROJECT=$INSTANCE
  say "Asennuksen nimi ${bold}$INSTANCE${reset} (kontti, image ja taltiot ${PROJECT}_banking-data, ${PROJECT}_banking-secrets)."
fi

# ── 2. how the app is reached ────────────────────────────────────────────────
# An existing install keeps its answers. A run that stopped half way (no container yet) goes on with
# them without asking. Otherwise one question offers a change; --reconfigure or an answer flag asks again.
KEEP_ALL=false
if $EXISTING && [[ -f $ENV_FILE ]] && ! $RECONFIGURE && [[ -z $A_ACCESS$A_DOMAIN$A_EMAIL$A_PORT$A_BIND$A_TOKEN ]]; then
  if [[ -z $($DC ps -a -q banking 2>/dev/null || true) ]]; then
    say "Edellinen asennus jäi kesken. Jatketaan samoilla asetuksilla."; KEEP_ALL=true
  else
    KEEP_ALL=true
  fi
fi
if $KEEP_ALL; then
  step "Asetukset"
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
  ok "Osoite: $APP_BASE_URL, portti $BIND_ADDRESS:$HOST_PORT  ${dim}(.env säilyy ennallaan)${reset}"
else
current_profile=$(existing COMPOSE_PROFILES)
current_bind=$(existing BIND_ADDRESS)
route_addr=$(default_route_addr)
# no answer given and no --reconfigure: the home network if this machine has a private address, else this machine only
if [[ -z $A_ACCESS ]] && ! $RECONFIGURE; then
  if [[ -n $A_TOKEN ]]; then A_ACCESS=3
  elif [[ -n $A_DOMAIN && -n $A_EMAIL ]]; then A_ACCESS=4
  elif [[ -n $A_BIND ]] || is_private_v4 "$route_addr"; then A_ACCESS=1
  else
    A_ACCESS=2
    warn "Koneen osoite (${route_addr:-ei tiedossa}) ei ole kotiverkon osoite, joten sovellus kuuntelee vain tätä konetta (127.0.0.1). Palvelimelle sopii Cloudflare Tunnel tai oma domain: ./scripts/install.sh --reconfigure"
  fi
fi
if [[ -z $A_ACCESS ]] && ! $YES; then
step "Miten sovellukseen päästään?"
say "  1) Kotiverkko                  http://<koneen osoite>:<portti>  salaamaton, vain kotiverkkoon (oletus)"
say "  2) Vain tältä koneelta         http://localhost:<portti>        kokeiluun tai oman välityspalvelimen taakse"
say "  3) Cloudflare Tunnel           https://talous.oma.fi            ei avoimia portteja, Cloudflare Access eteen"
say "  4) Oma domain + Let's Encrypt  https://talous.oma.fi            Caddy, vaatii portit 80/443 auki reitittimessä"
fi
default_access=1
[[ -n $current_profile || ( -n $current_bind && $current_bind == 127.0.0.1 ) ]] && default_access=2
[[ $current_profile == caddy ]] && default_access=4
[[ $current_profile == tunnel ]] && default_access=3
[[ -z $current_profile && -z $current_bind ]] && { is_private_v4 "$route_addr" && default_access=1 || default_access=2; }
ask ACCESS "Valinta" "$default_access" "$A_ACCESS"
[[ $ACCESS =~ ^[1-4]$ ]] || die "Tuntematon valinta: $ACCESS"

PROFILES=""; TRUST_PROXY=false; DOMAIN=""; ACME_EMAIL=""; TUNNEL_TOKEN=""; CADDY_ADDRESS=""
BIND_ADDRESS=127.0.0.1   # only option 4 listens beyond this machine

pick_host_addr() { # pick_host_addr VAR default
  # not __ans: ask() has a local of that name, which would catch its answer
  local __var=$1 __def=$2 __addrs __i __pick=""
  command -v ip >/dev/null || die "ip-komento puuttuu, koneen osoitteita ei voi listata (sudo apt install iproute2)."
  mapfile -t __addrs < <(host_addrs)
  ((${#__addrs[@]})) || die "Koneelta ei löytynyt verkko-osoitteita."
  [[ -n ${3:-} ]] || for __i in "${!__addrs[@]}"; do say "  $((__i + 1))) ${__addrs[$__i]}"; done
  ask __pick "Osoite (numero tai osoite)" "$__def" "${3:-}"
  if [[ $__pick =~ ^[0-9]{1,2}$ ]] && ((__pick >= 1 && __pick <= ${#__addrs[@]})); then __pick=${__addrs[$((__pick - 1))]}; fi
  __pick=${__pick#\[}; __pick=${__pick%\]}
  printf -v "$__var" '%s' "$__pick"
}

if [[ $ACCESS == 1 ]]; then
  say "  ${yellow}Liikenne on salaamatonta (http). Käytä vain luotetussa kotiverkossa, älä avaa porttia internetiin.${reset}"
  pick_def=${current_bind:-}
  [[ $pick_def != 127.0.0.1 ]] || pick_def=""
  # nothing asked on a plain run: the default-route address (the choice above made sure it is a private one)
  if ! $RECONFIGURE && [[ -z $A_BIND && -z $pick_def ]] && is_private_v4 "$route_addr"; then A_BIND=$route_addr; fi
  [[ -n $A_BIND ]] || say "  Koneen osoitteet (0.0.0.0 = kaikki osoitteet, ei suositella):"
  pick_host_addr BIND_ADDRESS "${pick_def:-${route_addr:-$(host_addrs | head -1)}}" "$A_BIND"
  if [[ $(norm_addr "$BIND_ADDRESS") == "*" ]]; then
    warn "Kuuntelu kaikissa osoitteissa avaa sovelluksen jokaiseen koneen verkkoon. Docker ohittaa palomuurin (ufw) säännöt, joten valitse mieluummin yksittäinen osoite."
    BIND_ADDRESS=0.0.0.0
  else
    host_has_addr "$BIND_ADDRESS" || die "Osoite $BIND_ADDRESS ei ole tällä koneella."
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
  die "Portti $HOST_PORT on jo käytössä osoitteessa $BIND_ADDRESS (toinen ohjelma tai toinen asennus). Valitse toinen: ./scripts/install.sh --port <numero>   (kuka sen käyttää: ss -ltnp 'sport = :$HOST_PORT')"
fi
say "Portti: ${bold}$HOST_PORT${reset}"

case $ACCESS in
  2) APP_BASE_URL="http://localhost:$HOST_PORT" ;;
  4)
    ask DOMAIN "Domain (esim. talous.oma.fi)" "$(existing DOMAIN)" "$A_DOMAIN"
    [[ -n $DOMAIN ]] || die "Domain puuttuu. Anna se: --domain talous.oma.fi"
    valid_domain "$DOMAIN" || die "Virheellinen domain: $DOMAIN"
    ask ACME_EMAIL "Sähköposti Let's Encryptin ilmoituksille" "$(existing ACME_EMAIL)" "$A_EMAIL"
    [[ -n $ACME_EMAIL ]] || die "Sähköposti puuttuu. Anna se: --email nimi@oma.fi"
    [[ $ACME_EMAIL =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Virheellinen sähköpostiosoite: $ACME_EMAIL"
    APP_BASE_URL="https://$DOMAIN"; PROFILES=caddy; TRUST_PROXY=true
    # Caddy needs 80 and 443. Another instance (or program) already on them: bind to an address of its own.
    if port_taken 80 "*" || port_taken 443 "*"; then
      say "  Portti 80 tai 443 on jo käytössä (toinen Caddy tai ohjelma). Caddy tarvitsee oman IP-osoitteen."
      say "  Koneen osoitteet:"
      pick_host_addr CADDY_ADDRESS "$(existing CADDY_ADDRESS)" "$A_BIND"
      [[ -n $CADDY_ADDRESS ]] || die "Osoite puuttuu."
      host_has_addr "$CADDY_ADDRESS" || die "Osoite $CADDY_ADDRESS ei ole tällä koneella."
      if port_taken 80 "$CADDY_ADDRESS" || port_taken 443 "$CADDY_ADDRESS"; then
        wild=$(wildcard_caddy_owner || true)
        if [[ -n $wild ]]; then
          wild_dir=${wild#*|}; wild=${wild%%|*}
          die "Asennuksen $wild Caddy kuuntelee portteja 80 ja 443 kaikissa osoitteissa, joten mikään toinen osoite ei kelpaa. Lisää tiedostoon ${wild_dir:-<sen kansio>}/.env rivi CADDY_ADDRESS=<sen oma IP> ja aja siinä kansiossa docker compose up -d. Yritä sitten tätä asennusta uudelleen."
        fi
        die "Portit 80 ja 443 eivät ole vapaina osoitteessa $CADDY_ADDRESS. Käytä toista IP-osoitetta tai valintaa 3 (Cloudflare Tunnel), tai laita oma välityspalvelin sovelluksen portin $HOST_PORT eteen."
      fi
    fi
    ;;
  3)
    ask DOMAIN "Tunnelin julkinen osoite (esim. talous.oma.fi)" "$(existing DOMAIN)" "$A_DOMAIN"
    [[ -n $DOMAIN ]] || die "Domain puuttuu. Anna se: --domain talous.oma.fi"
    valid_domain "$DOMAIN" || die "Virheellinen domain: $DOMAIN"
    say "  ${dim}Zero Trust > Networks > Tunnels > Create tunnel, kopioi token (alkaa eyJ…)${reset}"
    TUNNEL_TOKEN=$A_TOKEN
    if [[ -z $TUNNEL_TOKEN ]] && ! $YES; then ask_secret TUNNEL_TOKEN "Tunnel token (piilotettu, Enter = säilytä nykyinen)"; fi
    TUNNEL_TOKEN=${TUNNEL_TOKEN:-$(existing CLOUDFLARE_TUNNEL_TOKEN)}
    [[ -n $TUNNEL_TOKEN ]] || die "Tunnel token puuttuu. Anna se ympäristömuuttujassa: TALOUS_TUNNEL_TOKEN=eyJ… ./scripts/install.sh --yes --access tunnel --domain ..."
    [[ $TUNNEL_TOKEN =~ ^[A-Za-z0-9._=-]+$ ]] || die "Token puuttuu tai on virheellinen."
    APP_BASE_URL="https://$DOMAIN"; PROFILES=tunnel; TRUST_PROXY=true
    ;;
  1)
    url_addr=$BIND_ADDRESS
    if [[ $BIND_ADDRESS == 0.0.0.0 ]]; then
      ask url_addr "Osoite, jolla sovellukseen päästään (IP tai nimi)" "$(host_addrs | head -1)"
    fi
    [[ $url_addr =~ ^[A-Za-z0-9.:-]+$ ]] || die "Virheellinen osoite: $url_addr"
    APP_BASE_URL="http://$(url_host "$url_addr"):$HOST_PORT"
    ;;
  *) die "Tuntematon valinta: $ACCESS" ;;
esac
APP_BASE_URL=${APP_BASE_URL%/}
ok "Osoite: $APP_BASE_URL  ${dim}(muutettavissa selaimessa)${reset}"

# ── write .env ───────────────────────────────────────────────────────────────
step "Kirjoitetaan .env"
umask 077
# optional settings the questions above do not cover survive a re-run
KEEP=()
for key in TZ SETUP_CODE INDUSTRY_LOOKUP; do
  value=$(existing "$key")
  [[ -n $value ]] && KEEP+=("$key=$value")
done
if [[ -f $ENV_FILE ]]; then
  cp -p "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  ok "Vanha .env varmuuskopioitu."
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
  if ((${#KEEP[@]})); then
    echo; echo "# Kept from the previous .env"; printf '%s\n' "${KEEP[@]}"
  fi
} >"$ENV_FILE.new"
# written whole or not at all: a Ctrl-C here leaves the old .env
chmod 600 "$ENV_FILE.new"; mv -f "$ENV_FILE.new" "$ENV_FILE"
ok ".env kirjoitettu (oikeudet 600)."
fi
# a COMPOSE_PROJECT_NAME in the shell beats .env and would name the volumes differently
[[ $(project_name) == "$PROJECT" ]] || die "Compose käyttää projektinimeä $(project_name), odotettiin $PROJECT. Onko COMPOSE_PROJECT_NAME asetettu komentorivillä? (unset COMPOSE_PROJECT_NAME)"

# ── 4. build, start, setup code ──────────────────────────────────────────────
step "Rakennetaan ja käynnistetään"
# the image remembers which commit it was built from (update.sh and doctor.sh compare it with the checkout)
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo unknown); export GIT_COMMIT
# Channel: the signed release image when this checkout is exactly a release (a tag vX.Y.Z), else the source built here
# (a clone ahead of the newest release, no release yet, or TALOUS_CHANNEL=source). update.sh uses the same rule.
CHANNEL=source; UP_FLAGS=""; LOG=$(mktemp)
if [[ ${TALOUS_CHANNEL:-$(existing TALOUS_CHANNEL)} != source ]]; then
  REL_TAG=$(latest_release)
  if [[ -n $REL_TAG ]]; then
    REL_COMMIT=$(git rev-parse "$REL_TAG^{commit}")
    if [[ $REL_COMMIT == "$(git rev-parse HEAD 2>/dev/null)" ]]; then CHANNEL=release
    elif git merge-base --is-ancestor HEAD "$REL_COMMIT" 2>/dev/null; then
      warn "Tämä kansio on julkaisua $REL_TAG vanhempi. Rakennetaan kansion koodi. Siirry julkaisuun asennuksen jälkeen: ./scripts/update.sh"
    fi
  fi
fi
if [[ $CHANNEL == release ]]; then
  say "Kanava: julkaisu $REL_TAG"
  # shellcheck disable=SC2034
  IMAGE=$INSTANCE
  docker image inspect "$INSTANCE:latest" >/dev/null 2>&1 || say "${dim}Imagen lataus kestää hetken.${reset}"
  fetch_release_image "$REL_TAG" "$REL_COMMIT"
  UP_FLAGS="--no-build"
else
docker image inspect "$INSTANCE:latest" >/dev/null 2>&1 || say "${dim}Ensimmäinen rakennus kestää muutaman minuutin.${reset}"
build_rc=0
run_logged "$LOG" "Rakennetaan" $DC build banking || build_rc=$?
if ((build_rc != 0)); then
  tail -n 25 "$LOG" | cut -c1-200
  if grep -qiE 'no space left|ENOSPC|disk quota' "$LOG"; then
    die "Levy täyttyi rakennuksen aikana. Vapauta tilaa (df -h; docker image prune -f; docker builder prune -f) ja aja tämä uudelleen, se jatkaa siitä mihin jäi."
  elif grep -qiE '429 Too Many|toomanyrequests|rate limit' "$LOG"; then
    die "Docker Hub rajoittaa latauksia tästä osoitteesta (liian monta pyyntöä). Odota tunti ja aja tämä uudelleen, tai kirjaudu: docker login"
  elif grep -qiE 'ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|could not resolve|temporary failure in name|i/o timeout|dial tcp|TLS handshake|failed to fetch|failed to resolve source|network is unreachable|unable to get image|Get "https' "$LOG"; then
    die "Rakennus ei saanut verkkoyhteyttä (paketit tai pohjaimage ladataan netistä). Tarkista yhteys (curl -I https://registry.npmjs.org, docker pull node:22-alpine) ja aja tämä uudelleen."
  elif grep -qE 'FAIL|Test Files .*failed|tests? failed' "$LOG"; then
    die "Rakennuksen testit epäonnistuivat. Koodi ei ole kunnossa tällä haaralla. Yritä toista versiota tai kerro viasta (lokin loppu yllä)."
  fi
  die "Rakennus epäonnistui (lokin loppu yllä). Aja tämä uudelleen. Jos vika toistuu: ./scripts/doctor.sh"
fi
fi

# An earlier version of this script kept the app secret in ./secrets. Copy it into
# the secrets volume once, so bank keys encrypted with it stay readable.
if [[ -s $LEGACY_SECRET ]]; then
  if $DC run --rm --no-deps -T --entrypoint sh banking -c 'umask 077; [ -s /secrets/app_secret ] && exit 3; cat > /secrets/app_secret' <"$LEGACY_SECRET"; then
    ok "Aiemman asennuksen salausavain siirretty taltioon ${PROJECT}_banking-secrets."
  fi
  warn "Kansio secrets/ ei ole enää käytössä. Poista se, kun sovellus toimii: rm -r secrets"
fi

up_rc=0
run_logged "$LOG" "Käynnistetään" $DC up -d $UP_FLAGS || up_rc=$?
if ((up_rc != 0)); then
  tail -n 15 "$LOG" | cut -c1-200
  if grep -qiE 'port is already allocated|address already in use|bind: ' "$LOG"; then
    die "Portti $HOST_PORT tai 80/443 on jo toisen ohjelman käytössä. Katso kuka: ss -ltnp 'sport = :$HOST_PORT'. Valitse toinen portti: ./scripts/install.sh --reconfigure --port <numero>"
  elif grep -qiE 'no space left' "$LOG"; then
    die "Levy täyttyi käynnistettäessä. Vapauta tilaa (df -h; docker image prune -f; docker builder prune -f) ja aja tämä uudelleen."
  elif grep -qiE 'pull access denied|failed to resolve|i/o timeout|TLS handshake|no such host|Get "https' "$LOG"; then
    die "Caddyn tai tunnelin imagea ei saatu ladattua. Tarkista verkkoyhteys ja aja tämä uudelleen."
  fi
  die "Käynnistys epäonnistui (virhe yllä). Aja tämä uudelleen. Jos vika toistuu: ./scripts/doctor.sh"
fi
say "Odotetaan sovellusta…"
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
  die "Sovellus ei käynnistynyt (lokin loppu yllä). Aja: ./scripts/doctor.sh   ja tarkemmin: docker compose logs --tail 60 banking. Korjauksen jälkeen aja tämä uudelleen."
fi
ok "Sovellus käynnissä."

# a fresh one-time code (only while no user exists)
CODE=$($DC exec -T banking $NODE setup-code 2>/dev/null | tail -1 || true)

# the maintenance helper (update, backup and restart from the browser); a problem here never fails the install
OPS_KIND=none; OPS_NOTE=""
if $OPS_HELPER; then
  step "Ylläpitoapuri"
  setup_ops_helper
  if [[ $OPS_KIND == none ]]; then warn "$OPS_NOTE"; else ok "Ylläpitoapuri käytössä: $OPS_NOTE"; fi
  if [[ $OPS_KIND == cron ]]; then say "${dim}Systemd-käyttäjäajastin vaatisi, että palvelut jatkavat kirjautumisen jälkeen (sudo loginctl enable-linger $(id -un)). Cron toimii ilman sitä.${reset}"; fi
else
  OPS_NOTE="ei käytössä (--no-ops-helper)"
fi

# the end: the address, the setup link, what is left to do
case $OPS_KIND in
  systemd) OPS_LABEL="käytössä (systemd-ajastin)" ;;
  cron) OPS_LABEL="käytössä (cron)" ;;
  *) OPS_LABEL="ei käytössä"; [[ $OPS_NOTE != "ei käytössä"* ]] || OPS_LABEL=$OPS_NOTE ;;
esac
IN=""; [[ $INSTANCE == "$DEFAULT_INSTANCE" ]] || IN="cd $ROOT && "
say ""
say "${bold}${green}Omatalous on käynnissä:${reset} ${bold}$APP_BASE_URL${reset}   ${dim}(asennus $INSTANCE)${reset}"
if [[ $CODE =~ ^[a-z0-9]{4}(-[a-z0-9]{4}){3}$ ]]; then
  say "Ota käyttöön: ${bold}$APP_BASE_URL/#koodi=$CODE${reset}   ${dim}(kertakäyttöinen koodi on linkissä)${reset}"
else
  say "Avaa osoite ja kirjaudu sisään."
fi
if [[ $ACCESS == 1 ]]; then
  say "Varaa koneelle kiinteä osoite reitittimestä (DHCP-varaus), niin osoite ei vaihdu. Ylläpitoapuri: $OPS_LABEL."
else
  say "Ylläpitoapuri: $OPS_LABEL. Vianetsintä: ${IN}./scripts/doctor.sh"
fi
[[ $ACCESS != 4 ]] || say "${dim}Let's Encrypt: DNS A -tietue julkiseen IP:hen ja portit 80 ja 443 ohjattuna tälle koneelle.${reset}"
[[ $ACCESS != 3 ]] || say "${dim}Cloudflare: tunnelin Public hostname http://banking:8080 ja Access-sääntö omalle sähköpostille.${reset}"
