#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous: update to the latest version, with a way back.
#
#   ./scripts/update.sh              update to the newest release (or the newest source, see below), restart, health check
#   ./scripts/update.sh --rollback   back to the version before the last update
#   ./scripts/update.sh --yes        no questions: goes back by itself if the new version does not start
#                                    (for cron; --rollback --yes restores the database copy without asking too)
#
# Several instances: run it in the clone directory of the instance. The image, state file and
# containers are all this instance's own (INSTANCE_NAME in .env, default banking-app).
#
# Channels. Once the project has a release (a tag vX.Y.Z), an install follows the releases: the signed image from
# ghcr.io is pulled, its cosign signature is verified against this project's release workflow, and the image is
# tagged <name>:latest, so docker-compose.yml keeps naming the image as before. Until a release exists, and with
# TALOUS_CHANNEL=source in .env, the update builds the newest source on this machine as it always has.
#
# Before the switch (after the new image is ready, right before the old container stops):
#   • a consistent copy of the database is written inside the data volume
#     (/data/backups/pre-update-<time>.db); the app makes another one itself
#     right before any schema migration
#   • the running image is kept as <name>:previous (banking-app:previous by default)
# If the new version does not come up healthy, the script shows its log and
# offers the rollback. The rollback restores the newest database copy with the old schema, and only when the
# new version changed the schema (otherwise nothing written since is lost),
# then starts the previous image and returns the source to the previous commit.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
YES=false
for arg in "$@"; do [[ $arg == --yes || $arg == -y ]] && YES=true; done
# shellcheck disable=SC2046
set -- $(printf '%s\n' "$@" | grep -vxE -- '--yes|-y' || true)

DEFAULT_INSTANCE=banking-app
STATE=backups/.last-update
# The image is named like docker-compose.yml does: INSTANCE_NAME from the shell, else from .env
# (read as data, never sourced), else banking-app. COMPOSE_PROJECT_NAME is not used.
# Compose fills it from the directory name, which would rename the image of an install made before the key.
IMAGE=${INSTANCE_NAME:-}
[[ -n $IMAGE || ! -f .env ]] || IMAGE=$(grep -E '^INSTANCE_NAME=' .env | tail -1 | cut -d= -f2- || true)
IMAGE=${IMAGE:-$DEFAULT_INSTANCE}
NODE=(node --disable-warning=ExperimentalWarning)
# Compose reads exactly this file. Without it, Compose also picks up compose.yaml and merges an override file.
export COMPOSE_FILE=docker-compose.yml

# The maintenance helper checks one commit and names it here (TALOUS_TARGET, a full hash) with the channel
# (TALOUS_MODE, release or source). Then nothing below fetches, picks a tag or pulls: the commit is merged as it is.
TARGET=${TALOUS_TARGET:-}
MODE=${TALOUS_MODE:-}
if [[ -n $TARGET || -n $MODE ]]; then
  [[ $TARGET =~ ^[0-9a-f]{40}$ && $MODE =~ ^(release|source)$ ]] || { echo "TALOUS_TARGET tai TALOUS_MODE on virheellinen." >&2; exit 1; }
fi

# Release helpers (signature check, image pull, labels), shared with install.sh. Keep SIGN_IDENTITY_REGEXP there in step
# with .github/workflows/release.yml (a test compares them).
# shellcheck disable=SC2034
KEEP_NOTE="Vanha versio on yhä käynnissä."
# shellcheck source=lib/release.sh
. scripts/lib/release.sh

[[ $IMAGE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "INSTANCE_NAME on virheellinen: $IMAGE" >&2; exit 1; }

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%s!%s %s\n' "$yellow" "$reset" "$*"; }
REPORTED=false
die()  { REPORTED=true; printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
confirm() {
  local __ans
  $YES && return 0
  [[ -t 0 ]] || return 1 # never decide for an unattended run
  read -r -p "$1 [K/e]: " __ans
  [[ ${__ans:-K} =~ ^[KkYy] ]]
}

running() { [[ -n $(docker compose ps --status running -q banking 2>/dev/null) ]]; }
# runs node in the app container: the running one, or a one-off container from the current image
in_app() {
  if running; then docker compose exec -T banking "${NODE[@]}" "$@"
  else docker compose run --rm --no-deps -T --entrypoint node banking --disable-warning=ExperimentalWarning "$@"; fi
}
# asks the app from inside its container, so BIND_ADDRESS and HOST_PORT do not matter. exec fails
# while the container restarts, which only means "not yet".
app_up() { docker compose exec -T banking wget -qO- http://127.0.0.1:8080/api/health >/dev/null 2>&1; }
healthy() {
  local cid
  for _ in $(seq 1 60); do
    app_up && return 0
    # a container that keeps restarting will not come up by waiting
    cid=$(docker compose ps -a -q banking 2>/dev/null | head -1 || true)
    [[ -z $cid ]] || [[ $(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0) -lt 3 ]] || return 1
    sleep 2
  done
  return 1
}
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
  ((rc == 130 || rc == 143)) && interrupted
  return "$rc"
}
# a build needs about 2 GB; the pre-update copy and the image come from the same disk
check_disk() {
  local root free_kb
  root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)
  [[ -n $root && -d $root ]] || return 0
  free_kb=$(df -Pk "$root" 2>/dev/null | awk 'NR==2 {print $4}')
  [[ -n ${free_kb:-} ]] || return 0
  ((free_kb >= 1024 * 1024)) || die "Levyllä on vain $((free_kb / 1024)) Mt vapaata ($root), päivitys tarvitsee noin 2 Gt. Mikään ei muuttunut. Vapauta tilaa (docker image prune -f; docker builder prune -f; df -h) ja aja tämä uudelleen."
}
# builds the image and explains a failure. The running version is untouched by a failed build.
build_image() {
  local log rc=0
  GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo unknown)
  APP_VERSION=$(sed -n 's/^export const APP_VERSION = "\(.*\)";$/\1/p' apps/server/src/version.ts 2>/dev/null | head -1)
  APP_VERSION=${APP_VERSION:-unknown}
  export GIT_COMMIT APP_VERSION
  log=$(mktemp)
  run_logged "$log" "Rakennetaan" docker compose build banking || rc=$?
  if ((rc != 0)); then
    tail -n 25 "$log" | cut -c1-200
    local why="Rakennus epäonnistui (lokin loppu yllä)."
    if grep -qiE 'no space left|ENOSPC|disk quota' "$log"; then why="Levy täyttyi rakennuksen aikana. Vapauta tilaa (df -h; docker image prune -f; docker builder prune -f)."
    elif grep -qiE '429 Too Many|toomanyrequests|rate limit' "$log"; then why="Docker Hub rajoittaa latauksia tästä osoitteesta. Odota tunti tai kirjaudu: docker login."
    elif grep -qiE 'ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|could not resolve|temporary failure in name|i/o timeout|dial tcp|TLS handshake|failed to fetch|failed to resolve source|network is unreachable|unable to get image|Get "https' "$log"; then why="Rakennus ei saanut verkkoyhteyttä. Tarkista yhteys (curl -I https://registry.npmjs.org)."
    elif grep -qE 'FAIL|Test Files .*failed|tests? failed' "$log"; then why="Uuden version testit epäonnistuivat, joten sitä ei oteta käyttöön."; fi
    rm -f "$log"
    die "$why Vanha versio on yhä käynnissä. Aja ./scripts/update.sh uudelleen, kun syy on poistettu."
  fi
  rm -f "$log"
}
version() { docker compose exec -T banking "${NODE[@]}" dist/node.js version 2>/dev/null | tail -1 || echo "?"; }
# the project name Compose uses (it labels the volumes)
project_name() {
  local n
  n=$(docker compose config --format json 2>/dev/null | sed -n 's/^  "name": *"\([^"]*\)".*/\1/p' | head -1 || true)
  printf '%s' "${n:-$(basename "$(pwd)" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-' | sed 's/^[-_]*//')}"
}
# value of KEY in the state file, read as data (never sourced)
state() { grep -E "^$1=" "$STATE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

# ── releases ────────────────────────────────────────────────────────────────
channel_setting() { grep -E '^TALOUS_CHANNEL=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
# true when the running container uses the image now tagged $IMAGE:latest
running_latest() {
  local cid
  cid=$(docker compose ps -q banking 2>/dev/null | head -1 || true)
  [[ -n $cid && $(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null) == "$(docker image inspect -f '{{.Id}}' "$IMAGE:latest" 2>/dev/null)" ]]
}
# the consistent database copy right before the switch; the state file records it for --rollback
take_copy() {
  local snapshot="/data/backups/pre-update-$1.db"
  # a full disk fails here, before the old container is touched
  in_app -e '
    const fs = require("node:fs");
    if (!fs.existsSync("/data/banking.db")) process.exit(0);
    fs.mkdirSync("/data/backups", { recursive: true, mode: 0o700 });
    try {
      new (require("node:sqlite").DatabaseSync)("/data/banking.db").exec(`VACUUM INTO '\''${process.argv[1]}'\''`);
    } catch (err) {
      fs.rmSync(process.argv[1], { force: true });
      throw err;
    }' "$snapshot" || die "Tietokannan kopiointi ei onnistunut (onko levy täynnä?). Vanha versio on yhä käynnissä."
  # Only now does the running image become :previous, together with the state file. A failure before this point
  # leaves the older pair as it was.
  docker image tag "$IMAGE:pending-previous" "$IMAGE:previous" || die "Edellisen imagen tallennus epäonnistui. Vanha versio on yhä käynnissä."
  (umask 077; printf 'AT=%s\nPREV_COMMIT=%s\nSNAPSHOT=%s\nPREV_VERSION=%s\nINSTANCE=%s\n' "$1" "$prev_commit" "$snapshot" "$before" "$IMAGE" >"$STATE")
  docker image rm "$IMAGE:pending-previous" >/dev/null 2>&1 || true
  ok "Tietokannan kopio $snapshot ja edellinen image $IMAGE:previous tallessa."
}

# ── rollback ────────────────────────────────────────────────────────────────
rollback() {
  [[ -f $STATE ]] || die "Ei tietoa edellisestä päivityksestä ($STATE)."
  local snapshot prev_commit at saved
  snapshot=$(state SNAPSHOT); prev_commit=$(state PREV_COMMIT); at=$(state AT); saved=$(state INSTANCE)
  # the saved image belongs to the name it was taken under; a state file from before the key has none
  [[ -z $saved || $saved == "$IMAGE" ]] || die "Asennuksen nimi on muuttunut päivityksen jälkeen ($saved → $IMAGE). Palauta INSTANCE_NAME tiedostoon .env."
  [[ $snapshot =~ ^/data/backups/pre-update-[0-9TZ]+\.db$ ]] || die "Tilatiedoston varmuuskopiopolku on virheellinen."
  # the state file is data: the commit has to be a full hash that this checkout descends from
  [[ -z $prev_commit ]] || { [[ $prev_commit =~ ^[0-9a-f]{40}$ ]] && git merge-base --is-ancestor "$prev_commit" HEAD 2>/dev/null; } || die "Tilatiedoston commit ei kelpaa (se ei ole tämän kansion aiempi versio)."
  docker image inspect "$IMAGE:previous" >/dev/null 2>&1 || die "Edellistä imagea ($IMAGE:previous) ei ole."
  # the saved image has to be the build of the commit the state file names (a failed update must not have moved it)
  # (an image from before the label existed has none and is accepted)
  [[ -z $prev_commit || -z $(image_label "$IMAGE:previous" talous.commit) || $(image_label "$IMAGE:previous" talous.commit) == "$prev_commit" ]] \
    || die "Edellinen image ($IMAGE:previous) ei vastaa tilatiedoston versiota. Palautusta ei tehdä, jotta tiedot eivät katoa."

  step "Palautetaan päivitystä ($at) edeltänyt versio"
  docker compose stop banking >/dev/null
  # Does the database still have the schema the previous version knows? Compare the migration history.
  # If not, the newest copy with the old schema wins: the app's own copy taken right before the migration is
  # newer than the update script's, and both hold the old schema.
  local choice target
  choice=$(docker compose run --rm --no-deps -T --entrypoint node banking --disable-warning=ExperimentalWarning -e '
    const fs = require("node:fs");
    const { DatabaseSync } = require("node:sqlite");
    const names = (f) => new DatabaseSync(f).prepare("SELECT group_concat(name) AS n FROM (SELECT name FROM _migrations ORDER BY name)").get().n;
    const want = names(process.argv[1]);
    if (names("/data/banking.db") === want) { console.log("same"); process.exit(0); }
    const dir = "/data/backups";
    const copies = fs.readdirSync(dir).filter((f) => /^pre-[A-Za-z0-9_]+-[0-9TZ]+\.db$/.test(f))
      .map((f) => ({ f, t: fs.statSync(`${dir}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of copies) {
      try { if (names(`${dir}/${f}`) === want) { console.log(`restore ${dir}/${f}`); process.exit(0); } } catch { /* unreadable copy, try the next */ }
    }
    console.log(`restore ${process.argv[1]}`);' "$snapshot" | tail -1)
  if [[ $choice == same ]]; then
    ok "Tietokanta ennallaan, tiedot säilyvät."
  else
    target=${choice#restore }
    [[ $target =~ ^/data/backups/pre-[A-Za-z0-9_]+-[0-9TZ]+\.db$ ]] || die "Varmuuskopion valinta epäonnistui."
    warn "Uusi versio muutti tietokantaa. Palautetaan kopio $(basename "$target"). Sen jälkeiset muutokset katoavat."
    if [[ -t 0 ]] && ! confirm "Jatketaanko?"; then
      docker compose start banking >/dev/null; die "Peruttu, nykyinen versio käynnistetty uudelleen."
    fi
    # what the rollback is about to overwrite is kept first, so nothing is lost for good
    docker compose run --rm --no-deps -T --entrypoint node banking --disable-warning=ExperimentalWarning -e '
      const fs = require("node:fs");
      if (!fs.existsSync("/data/banking.db")) process.exit(0);
      fs.mkdirSync("/data/backups", { recursive: true, mode: 0o700 });
      try { new (require("node:sqlite").DatabaseSync)("/data/banking.db").exec(`VACUUM INTO '\''${process.argv[1]}'\''`); }
      catch (err) { fs.rmSync(process.argv[1], { force: true }); throw err; }
      const old = fs.readdirSync("/data/backups").filter((f) => /^pre-rollback-[0-9TZ]+\.db$/.test(f)).sort().reverse().slice(5);
      for (const f of old) fs.rmSync(`/data/backups/${f}`);' "/data/backups/pre-rollback-$(date -u +%Y%m%dT%H%M%SZ).db" || die "Nykyisen tietokannan kopiointi ei onnistunut, mitään ei palautettu."
    ok "Nykyinen tietokanta talletettu ennen palautusta (pre-rollback-*.db)."
    docker compose run --rm --no-deps -T --entrypoint sh banking -c \
      'set -e; cp "$1" /data/banking.db.restore; rm -f /data/banking.db-wal /data/banking.db-shm; mv /data/banking.db.restore /data/banking.db' sh "$target"
    ok "Tietokanta palautettu: $target"
  fi

  docker image tag "$IMAGE:previous" "$IMAGE:latest"
  # the source goes back first: docker-compose.yml belongs to the version being restored (--keep refuses to
  # touch files with local changes)
  if [[ -n $prev_commit ]] && git cat-file -e "$prev_commit" 2>/dev/null; then
    git reset --keep "$prev_commit" >/dev/null && ok "Lähdekoodi palautettu: $(git log -1 --format='%h %s')"
  fi
  # never a build: the previous image is the one just tagged
  docker compose up -d --no-build
  healthy || die "Edellinenkään versio ei käynnisty. Lokit: docker compose logs banking"
  rm -f "$STATE" # one rollback per update
  ok "Käynnissä: $(version)"
  say "${dim}Seuraava ./scripts/update.sh yrittää päivitystä uudelleen.${reset}"
}

# the whole run is one function, so bash has read the entire file before it starts: replacing this
# file while it runs (a copy over it) cannot corrupt the update
main() {
  # one run per directory (the lock is on install.sh, which takes the same one)
  exec 9<scripts/install.sh
  if command -v flock >/dev/null && ! flock -n 9; then
    die "Toinen päivitys tai asennus on jo käynnissä tässä kansiossa. Odota, että se valmistuu."
  fi
  on_exit() {
    local rc=$?
    ((rc == 0)) && return
    [[ $REPORTED == true ]] && return
    printf '\n%s✗ Päivitys keskeytyi.%s Aja ./scripts/update.sh uudelleen, se jatkaa siitä mihin jäi. Jos vika toistuu: ./scripts/doctor.sh\n' "$red" "$reset" >&2
  }
  trap on_exit EXIT
  interrupted() {
    REPORTED=true
    printf '\n%sKeskeytetty. Aja ./scripts/update.sh uudelleen, jos päivitys jäi kesken.%s\n' "$yellow" "$reset" >&2
    exit 130
  }
  trap interrupted INT TERM

  command -v docker >/dev/null || die "Docker puuttuu. Asenna se: curl -fsSL https://get.docker.com | sudo sh   (docs/INSTALL.md, kohta 3)."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 puuttuu. Asenna: sudo apt install docker-compose-plugin"
  if ! docker info >/dev/null 2>&1; then
    if [[ $(docker info 2>&1 >/dev/null | head -3) == *"permission denied"* ]]; then
      die "Käyttäjälläsi ei ole oikeutta Dockeriin. Aja: sudo usermod -aG docker \$USER   ja kirjaudu ulos ja sisään (tai: newgrp docker)."
    fi
    die "Docker-palvelu ei vastaa. Aja: sudo systemctl start docker   ja sitten tämä uudelleen. Syy: sudo journalctl -u docker -n 30"
  fi
  [[ $IMAGE == "$DEFAULT_INSTANCE" ]] || say "Asennus: ${bold}$IMAGE${reset} (kansio $(pwd))"

  if [[ ${1:-} == --rollback ]]; then rollback; return 0; fi
  [[ -z ${1:-} ]] || die "Käyttö: ./scripts/update.sh [--yes] [--rollback]"

  # ── update ──
  step "Tarkistetaan"
  git diff --quiet && git diff --cached --quiet || die "Repositoriossa on paikallisia muutoksia (git status). Siivoa ne ensin."
  # An image of this name without a container or volumes here belongs to another directory (a clone with no .env
  # falls back to banking-app). Tagging :previous over it would break that install's rollback.
  if docker image inspect "$IMAGE:latest" >/dev/null 2>&1 \
    && [[ -z $(docker compose ps -a -q banking 2>/dev/null) ]] \
    && [[ -z $(docker volume ls -q --filter "label=com.docker.compose.project=$(project_name)" 2>/dev/null) ]] \
    && ! grep -qx "INSTANCE=$IMAGE" "$STATE" 2>/dev/null; then
    die "Image $IMAGE:latest on olemassa, mutta se ei kuulu tähän kansioon. Aja ensin ./scripts/install.sh."
  fi
  [[ -n $TARGET ]] || git fetch --quiet --tags 2>/dev/null || die "Etärepositorioon ei saatu yhteyttä (git fetch epäonnistui). Mikään ei muuttunut, nykyinen versio on käynnissä. Tarkista verkko (git remote -v; git ls-remote origin) ja aja tämä uudelleen."
  prev_commit=$(git rev-parse HEAD)
  local upstream=''
  if [[ -n $TARGET ]]; then
    git cat-file -e "$TARGET^{commit}" 2>/dev/null || die "Commitia $TARGET ei löydy tästä kansiosta."
  else
    upstream=$(git rev-parse '@{u}' 2>/dev/null) || die "Haaralla ei ole seurattavaa etähaaraa (git branch -u origin/<haara>)."
  fi

  # A database from before 0.1.0 has another layout; say so now, before anything changes
  if running; then
    local floor
    floor=$(in_app -e '
      const fs = require("node:fs");
      if (!fs.existsSync("/data/banking.db")) { console.log("ok"); process.exit(0); }
      const d = new (require("node:sqlite").DatabaseSync)("/data/banking.db");
      const t = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type = \x27table\x27").all().map((r) => r.name));
      console.log(t.has("users") || !(t.has("_migrations") || t.has("transactions")) ? "ok" : "old");' | tail -1 || true)
    [[ $floor != old ]] || die "Tietokanta on tehty ennen versiota 0.1.0 eikä sitä voi päivittää. Mikään ei muuttunut. Asenna uudelleen (docs/INSTALL.md) ja tuo tapahtumat CSV-tiedostoista."
  fi

  # Which channel: releases once one exists and this checkout is not ahead of it, else the source
  CHANNEL=source
  local tag='' target=$upstream setting
  [[ -z $TARGET ]] && tag=$(latest_release)
  # the web helper names the exact release it checked (the Releases API); a tag has to exist locally
  if [[ -n ${TALOUS_RELEASE:-} ]]; then
    [[ $TALOUS_RELEASE =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] && git rev-parse -q --verify "refs/tags/$TALOUS_RELEASE^{commit}" >/dev/null || die "Julkaisua $TALOUS_RELEASE ei löydy."
    tag=$TALOUS_RELEASE
  fi
  setting=$(channel_setting)
  if [[ -n $TARGET ]]; then
    # the helper chose the commit and the channel; the .env setting may only agree
    [[ -z $setting || $setting == "$MODE" ]] || die "TALOUS_CHANNEL ($setting) ei vastaa ylläpitoapurin valintaa ($MODE). Mikään ei muuttunut."
    if [[ $MODE == release ]]; then
      [[ -n $tag ]] || die "Julkaisua ei annettu."
      [[ $(git rev-parse "refs/tags/$tag^{commit}" 2>/dev/null) == "$TARGET" ]] || die "Julkaisu $tag ei osoita tarkistettuun committiin."
    fi
    [[ $MODE == source ]] && tag=''
    CHANNEL=$MODE; target=$TARGET
    git merge-base --is-ancestor HEAD "$target" 2>/dev/null || die "Tarkistettu commit ei jatka tämän kansion historiaa. Mikään ei muuttunut."
    say "Kanava: $MODE${tag:+ $tag}"
  else
  case $setting in
    source) ;;
    release)
      [[ -n $tag ]] || die "TALOUS_CHANNEL=release on asetettu, mutta julkaisuja ei ole vielä."
      CHANNEL=release ;;
    '')
      if [[ -n $tag ]] && git merge-base --is-ancestor HEAD "$tag^{commit}" 2>/dev/null; then CHANNEL=release; fi ;;
    *) die "TALOUS_CHANNEL on virheellinen ($setting). Sallitut: source, release." ;;
  esac
  if [[ $CHANNEL == release ]]; then
    target=$(git rev-parse "$tag^{commit}")
    # a tag pushed on a side branch is not a release: its commit has to be on the branch this clone follows
    git merge-base --is-ancestor "$target" "$upstream" 2>/dev/null || die "Julkaisun $tag koodi ei kuulu seurattavaan päähaaraan. Mikään ei muuttunut."
    git merge-base --is-ancestor HEAD "$target" 2>/dev/null || die "Tämä kansio on uudempi kuin viimeisin julkaisu ($tag). Käytä lähdekoodikanavaa: lisää tiedostoon .env rivi TALOUS_CHANNEL=source."
    say "Kanava: julkaisu $tag"
  fi
  fi

  if [[ $prev_commit == "$target" ]] && docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
    local built
    built=$(image_label "$IMAGE:latest" talous.commit)
    # the running container has to use that image too (a build that finished before a copy failed leaves the
    # old container running on an older image)
    if [[ $built == "$prev_commit" ]] && running && app_up && running_latest; then
      ok "Uusin versio on jo käytössä ($(git log -1 --format='%h %s'))."
      return 0
    fi
    # the code is current but the image is older or the app is down (say, a failed update): fetch or build and
    # start again, without a new copy, so $IMAGE:previous stays the version that worked
    if [[ $built == "$prev_commit" ]]; then warn "Uusin versio on haettu, mutta sovellus ei vastaa. Käynnistetään uudelleen."
    else warn "Koodi on uusin, mutta käynnissä oleva image on rakennettu toisesta versiosta. Haetaan uudelleen."; fi
    check_disk
    if [[ $CHANNEL == release ]]; then fetch_release_image "$tag" "$target"; docker compose up -d --no-build
    else build_image; docker compose up -d; fi
    if healthy; then ok "Käynnissä: $(version)"; return 0; fi
    warn "Sovellus ei käynnistynyt. Loki:"
    docker compose logs --tail 30 banking || true
    if [[ -f $STATE ]] && confirm "Palautetaanko edellinen versio nyt?"; then
      rollback
    elif [[ -f $STATE ]]; then
      say "Palautus: ${bold}./scripts/update.sh --rollback${reset}"
    fi
    REPORTED=true
    return 1
  fi
  before=$(running && version || echo "ei käynnissä")
  say "Nykyinen: $before"
  say "Uudet muutokset:"; git log --oneline -20 "HEAD..$target" | sed 's/^/  /'

  check_disk
  # owner-only applies to the state file alone: a global umask would also reach the files
  # git pull writes, and the app in the image could not read them
  mkdir -p backups && chmod 700 backups
  local stamp have_old=false
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  # The running version is kept as :pending-previous before anything new is tagged :latest, and becomes
  # :previous only in take_copy, together with the state file
  if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then have_old=true; docker image tag "$IMAGE:latest" "$IMAGE:pending-previous"; fi

  step "Haetaan uusi versio"
  if [[ $CHANNEL == release ]]; then
    fetch_release_image "$tag" "$target"
  else
    if [[ -n $TARGET ]]; then git merge --ff-only --quiet "$TARGET"; else git pull --ff-only --quiet; fi
    ok "Lähdekoodi: $(git log -1 --format='%h %s')"
    docker compose pull --ignore-buildable --quiet 2>/dev/null || true # Caddy / cloudflared
    build_image
  fi

  # The copy comes last, so a rollback loses only what was written since this moment
  step "Varmuuskopio ennen vaihtoa"
  if [[ $have_old == true ]]; then take_copy "$stamp"; else warn "Edellistä imagea ei ole. Varmuuskopiota ei tehdä."; fi
  if [[ $CHANNEL == release ]]; then
    git merge --ff-only --quiet "$target"
    ok "Lähdekoodi: $(git log -1 --format='%h %s')"
    docker compose pull --ignore-buildable --quiet 2>/dev/null || true # Caddy / cloudflared
    docker compose up -d --no-build
  else
    docker compose up -d
  fi

  step "Käynnistetään…"
  if healthy; then
    ok "Päivitetty: $before → $(version)"
    # keep the five newest pre-update copies; the names sort by time
    in_app -e '
      const fs = require("node:fs");
      const dir = "/data/backups";
      if (!fs.existsSync(dir)) process.exit(0);
      const old = fs.readdirSync(dir).filter((f) => /^pre-update-[0-9TZ]+\.db$/.test(f)).sort().reverse().slice(5);
      for (const f of old) fs.rmSync(`${dir}/${f}`);' || true
    say "${dim}Jos jokin on vialla: ./scripts/update.sh --rollback${reset}"
    return 0
  fi

  warn "Uusi versio ei käynnistynyt. Loki:"
  docker compose logs --tail 30 banking || true
  if [[ -f $STATE ]] && confirm "Palautetaanko edellinen versio nyt?"; then
    rollback
  else
    say "Palautus myöhemmin: ${bold}./scripts/update.sh --rollback${reset}"
  fi
  REPORTED=true
  return 1
}
main "$@"
exit $?
