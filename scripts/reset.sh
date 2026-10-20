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
# Offers a backup first and needs DELETE typed in (POISTA works too). Install again with
# ./scripts/install.sh.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

# image name as in docker-compose.yml: INSTANCE_NAME from the shell or .env (as data), else banking-app
IMAGE=${INSTANCE_NAME:-}
[[ -n $IMAGE || ! -f .env ]] || IMAGE=$(grep -E '^INSTANCE_NAME=' .env | tail -1 | cut -d= -f2- || true)
IMAGE=${IMAGE:-banking-app}
[[ $IMAGE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "INSTANCE_NAME is invalid: $IMAGE" >&2; exit 1; }

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; red=$'\e[31m'; reset=$'\e[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
die()  { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }

# never decide for an unattended run
[[ -t 0 ]] || die "Reset asks for confirmation, so it must run in a terminal."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (docker compose version)."

# do not race an install or update in this directory (installer_lock)
# shellcheck source=lib/release.sh
. scripts/lib/release.sh
if command -v flock >/dev/null && ! installer_lock; then
  die "An install or update is running in this folder. Wait until it finishes."
fi
docker info >/dev/null 2>&1 || die "Docker does not respond."

# the project name Compose uses (it prefixes the volumes), asked before .env goes
PROJECT=$(docker compose config --format json 2>/dev/null | sed -n 's/^  "name": *"\([^"]*\)".*/\1/p' | head -1 || true)
PROJECT=${PROJECT:-$(basename "$(pwd)" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-' | sed 's/^[-_]*//')}

# Does this project own the image? Without a .env the name falls back to banking-app, which may be the image
# of an install in another directory. Asked now, before down removes the container.
owns_image=false
if [[ -n $(docker compose ps -a -q banking 2>/dev/null) ]] \
  || [[ -n $(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null) ]] \
  || grep -qx "INSTANCE=$IMAGE" backups/.last-update 2>/dev/null; then owns_image=true; fi

say "${bold}Omatalous reset${reset}  ${dim}instance $IMAGE, folder $(pwd)${reset}"
if $owns_image; then
  say "This deletes the containers and images of this instance ($IMAGE:latest, $IMAGE:previous), the volumes ${PROJECT}_banking-data and ${PROJECT}_banking-secrets, and .env."
else
  say "This deletes the containers of this folder, the volumes ${PROJECT}_banking-data and ${PROJECT}_banking-secrets, and .env. The image $IMAGE stays, because it does not belong to this folder."
fi
say "Other instances on this machine are not touched."
say "The database and the app secret are lost, including the copies inside the volume. The folder backups stays."

step "Backup"
read -r -p "Make a backup first? [Y/n]: " answer || answer=""
# the Finnish K (kyllä) is still accepted
if [[ ${answer:-y} =~ ^[KkYy] ]]; then
  ./scripts/backup.sh || die "The backup failed, nothing was deleted. Run the command again and answer n to continue without one."
fi

step "Confirm"
read -r -p "Type DELETE to continue: " answer || answer=""
[[ $answer == DELETE || $answer == POISTA ]] || die "Cancelled, nothing was deleted."

step "Deleting"
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
  say "Image $IMAGE was not deleted, because this folder does not own it."
fi
rm -f .env
ok "Everything deleted. The folder backups is unchanged."
say "Install again with ./scripts/install.sh"
