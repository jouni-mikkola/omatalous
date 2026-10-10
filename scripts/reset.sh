#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous: start over. The last resort when nothing else gets the app running.
#
#   ./scripts/reset.sh
#
# Deletes this instance's containers and images, its volumes banking-data (database)
# and banking-secrets (app secret, both prefixed with the Compose project name) and .env.
# Its maintenance helper (timer or cron line) and ops/ go too. Other instances on the machine are not touched.
# ./backups stays untouched.
# Offers a backup first and needs POISTA typed in. Install again with
# ./scripts/install.sh.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

# image name as in docker-compose.yml: INSTANCE_NAME from the shell or .env (as data), else banking-app
IMAGE=${INSTANCE_NAME:-}
[[ -n $IMAGE || ! -f .env ]] || IMAGE=$(grep -E '^INSTANCE_NAME=' .env | tail -1 | cut -d= -f2- || true)
IMAGE=${IMAGE:-banking-app}
[[ $IMAGE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "INSTANCE_NAME on virheellinen: $IMAGE" >&2; exit 1; }

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; red=$'\e[31m'; reset=$'\e[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
die()  { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }

# never decide for an unattended run
[[ -t 0 ]] || die "Nollaus kysyy varmistuksen, joten se pitää ajaa päätteessä."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 puuttuu (docker compose version)."

# do not race an install or update in this directory (they lock scripts/install.sh)
exec 9<scripts/install.sh
if command -v flock >/dev/null && ! flock -n 9; then
  die "Asennus tai päivitys on käynnissä tässä kansiossa. Odota, että se valmistuu."
fi
docker info >/dev/null 2>&1 || die "Docker ei vastaa."

# the project name Compose uses (it prefixes the volumes), asked before .env goes
PROJECT=$(docker compose config --format json 2>/dev/null | sed -n 's/^  "name": *"\([^"]*\)".*/\1/p' | head -1 || true)
PROJECT=${PROJECT:-$(basename "$(pwd)" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-' | sed 's/^[-_]*//')}

# Does this project own the image? Without a .env the name falls back to banking-app, which may be the image
# of an install in another directory. Asked now, before down removes the container.
owns_image=false
if [[ -n $(docker compose ps -a -q banking 2>/dev/null) ]] \
  || [[ -n $(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null) ]] \
  || grep -qx "INSTANCE=$IMAGE" backups/.last-update 2>/dev/null; then owns_image=true; fi

say "${bold}Talouden nollaus${reset}  ${dim}asennus $IMAGE, kansio $(pwd)${reset}"
if $owns_image; then
  say "Poistetaan tämän asennuksen kontit ja imaget ($IMAGE:latest, $IMAGE:previous), taltiot ${PROJECT}_banking-data ja ${PROJECT}_banking-secrets sekä .env."
else
  say "Poistetaan tämän kansion kontit, taltiot ${PROJECT}_banking-data ja ${PROJECT}_banking-secrets sekä .env. Image $IMAGE jää, koska se ei kuulu tähän kansioon."
fi
say "Muihin samalla koneella oleviin asennuksiin ei kosketa."
say "Tietokanta ja salausavain katoavat, myös taltion sisäiset kopiot. Kansio backups säilyy."

step "Varmuuskopio"
read -r -p "Tehdäänkö ensin varmuuskopio? [K/e]: " answer || answer=""
if [[ ${answer:-K} =~ ^[KkYy] ]]; then
  ./scripts/backup.sh || die "Varmuuskopio ei onnistunut, mitään ei poistettu. Aja komento uudelleen ja vastaa e, jos haluat jatkaa ilman."
fi

step "Varmistus"
read -r -p "Kirjoita POISTA jatkaaksesi: " answer || answer=""
[[ $answer == POISTA ]] || die "Peruttu, mitään ei poistettu."

step "Poistetaan"
# the maintenance helper first, so no tick runs during the wipe (this instance's timer or cron line only)
. scripts/lib/ops-schedule.sh
ops_scheduler_remove "$IMAGE"
rm -rf ops backups/.last-update
# before .env goes: COMPOSE_PROFILES there tells compose which services exist
docker compose down -v --rmi local
# --rmi local skips images that have a tag of their own, and compose does not know $IMAGE:previous (update.sh's rollback image)
if $owns_image; then
  docker image rm "$IMAGE:latest" "$IMAGE:previous" >/dev/null 2>&1 || true
else
  say "Imagea $IMAGE ei poistettu, koska tämä kansio ei omista sitä."
fi
rm -f .env
ok "Kaikki poistettu. Kansio backups on ennallaan."
say "Asenna uudelleen komennolla ./scripts/install.sh"
