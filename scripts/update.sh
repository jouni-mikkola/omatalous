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
#   • when the new image has the command `migrate-check` (0.6.0 and later), its migrations are tried on that copy.
#     A failure stops the update with the old version still running (exit code 3). The time the check took sets how
#     long the start may take afterwards: three times as long, at least 120 s
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
  [[ $TARGET =~ ^[0-9a-f]{40}$ && $MODE =~ ^(release|source)$ ]] || { echo "TALOUS_TARGET or TALOUS_MODE is invalid." >&2; exit 1; }
fi

# Release helpers (signature check, image pull, labels), shared with install.sh. Keep SIGN_IDENTITY_REGEXP there in step
# with .github/workflows/release.yml (a test compares them).
# shellcheck disable=SC2034
KEEP_NOTE="The old version is still running."
# shellcheck source=lib/release.sh
. scripts/lib/release.sh
# shellcheck source=lib/dbcopy.sh
. scripts/lib/dbcopy.sh
# shellcheck source=lib/preflight.sh
. scripts/lib/preflight.sh

[[ $IMAGE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "INSTANCE_NAME is invalid: $IMAGE" >&2; exit 1; }

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%s!%s %s\n' "$yellow" "$reset" "$*"; }
REPORTED=false
# CHANNEL and prev_commit are set while the update runs. BEFORE_SWITCH is true from the first change (the new image
# or checkout) until `docker compose up` starts the new version: an exit in between puts the old version back (on_exit).
CHANNEL=''; prev_commit=''; BEFORE_SWITCH=false
die()  { REPORTED=true; printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
# like die, with an exit code the maintenance helper reads (3 = the migration check failed, 4 = it could not run;
# nothing was changed in both)
die_code() { local c=$1; shift; REPORTED=true; printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit "$c"; }
confirm() {
  local __ans
  $YES && return 0
  [[ -t 0 ]] || return 1 # never decide for an unattended run
  read -r -p "$1 [Y/n]: " __ans
  [[ ${__ans:-Y} =~ ^[KkYy] ]]   # the Finnish K (kyllä) still works
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
  ((free_kb >= 1024 * 1024)) || die "Only $((free_kb / 1024)) MB of disk is free ($root) and the update needs about 2 GB. Nothing was changed. Free some space (docker image prune -f; docker builder prune -f; df -h) and run this again."
}
# builds the image and explains a failure. The running version is untouched by a failed build.
build_image() {
  local log rc=0
  GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo unknown)
  APP_VERSION=$(sed -n 's/^export const APP_VERSION = "\(.*\)";$/\1/p' apps/server/src/version.ts 2>/dev/null | head -1)
  APP_VERSION=${APP_VERSION:-unknown}
  export GIT_COMMIT APP_VERSION
  log=$(mktemp)
  run_logged "$log" "Building" docker compose build banking || rc=$?
  if ((rc != 0)); then
    tail -n 25 "$log" | cut -c1-200
    local why="The build failed (end of the log above)."
    if grep -qiE 'no space left|ENOSPC|disk quota' "$log"; then why="The disk filled up during the build. Free some space (df -h; docker image prune -f; docker builder prune -f)."
    elif grep -qiE '429 Too Many|toomanyrequests|rate limit' "$log"; then why="Docker Hub is limiting pulls from this address. Wait an hour or log in: docker login."
    elif grep -qiE 'ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|could not resolve|temporary failure in name|i/o timeout|dial tcp|TLS handshake|failed to fetch|failed to resolve source|network is unreachable|unable to get image|Get "https' "$log"; then why="The build could not reach the network. Check the connection (curl -I https://registry.npmjs.org)."
    elif grep -qE 'FAIL|Test Files .*failed|tests? failed' "$log"; then why="The tests of the new version failed, so it is not used."; fi
    rm -f "$log"
    die "$why The old version is still running. Run ./scripts/update.sh again once the cause is fixed."
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
  # shellcheck disable=SC2034 # read by record_schema_change (lib/preflight.sh)
  COPY_SNAPSHOT=$snapshot
  # a full disk fails here, before the old container is touched
  in_app -e "$DBCOPY_JS" exists "$snapshot" || die "Could not copy the database (is the disk full?). The old version is still running."
  # the new version's migrations are tried on that copy, so a migration that fails costs no downtime
  local checked=0
  preflight_migrations "$snapshot" || checked=$?
  if ((checked != 0)); then
    in_app -e 'require("node:fs").rmSync(process.argv[1], { force: true })' "$snapshot" >/dev/null 2>&1 || true
    ((checked == 2)) || die_code 3 "The database changes of the new version failed on a copy of your data (above). The old version is still running and nothing was changed. Try again with the next release, or see docs/TROUBLESHOOTING.md."
    die_code 4 "The migration check could not run (above), so the new version was not tried. The old version is still running and nothing was changed. Try the update again, or see docs/TROUBLESHOOTING.md."
  fi
  # Only now does the running image become :previous, together with the state file. A failure before this point
  # leaves the older pair as it was.
  docker image tag "$IMAGE:pending-previous" "$IMAGE:previous" || die "Could not save the previous image. The old version is still running."
  # replaced as a whole (temp file, flush, rename): a power cut must not leave an empty file that --rollback refuses
  printf 'AT=%s\nPREV_COMMIT=%s\nSNAPSHOT=%s\nPREV_VERSION=%s\nINSTANCE=%s\n' "$1" "$prev_commit" "$snapshot" "$before" "$IMAGE" | (umask 077; atomic_write "$STATE") \
    || die "Could not write $STATE. The old version is still running."
  docker image rm "$IMAGE:pending-previous" >/dev/null 2>&1 || true
  ok "Database copy $snapshot and previous image $IMAGE:previous saved."
}

# ── rollback ────────────────────────────────────────────────────────────────
rollback() {
  [[ -f $STATE ]] || die "No record of a previous update ($STATE)."
  local snapshot prev_commit at saved
  snapshot=$(state SNAPSHOT); prev_commit=$(state PREV_COMMIT); at=$(state AT); saved=$(state INSTANCE)
  # the saved image belongs to the name it was taken under; a state file from before the key has none
  [[ -z $saved || $saved == "$IMAGE" ]] || die "The install name changed after the update ($saved to $IMAGE). Put the old INSTANCE_NAME back in .env."
  [[ $snapshot =~ ^/data/backups/pre-update-[0-9TZ]+\.db$ ]] || die "The backup path in the state file is invalid."
  # the state file is data: the commit has to be a full hash that this checkout descends from
  [[ -z $prev_commit ]] || { [[ $prev_commit =~ ^[0-9a-f]{40}$ ]] && git merge-base --is-ancestor "$prev_commit" HEAD 2>/dev/null; } || die "The commit in the state file is not valid (it is not an earlier version of this folder)."
  docker image inspect "$IMAGE:previous" >/dev/null 2>&1 || die "The previous image ($IMAGE:previous) does not exist."
  # the saved image has to be the build of the commit the state file names (a failed update must not have moved it)
  # (an image from before the label existed has none, and one built by hand says unknown; both are accepted)
  local built_from
  built_from=$(image_label "$IMAGE:previous" talous.commit)
  [[ -z $prev_commit || -z $built_from || $built_from == unknown || $built_from == "$prev_commit" ]] \
    || die "The previous image ($IMAGE:previous) does not match the version in the state file. The rollback is not done, so no data is lost."

  # the copy is what a rollback may have to put back: it must exist and be intact before anything is stopped
  docker compose run --rm --no-deps -T --entrypoint node banking --disable-warning=ExperimentalWarning -e "$DBCHECK_JS" "$snapshot" \
    || die "The database copy from before the update ($snapshot) is missing or damaged. Nothing was stopped or changed. See docs/TROUBLESHOOTING.md."

  step "Restoring the version from before the update ($at)"
  HEALTH_WAIT=120 # the version being restored has no migration to wait for
  docker compose stop banking >/dev/null
  # Does the database still have the schema the previous version knows? Compare the migration history.
  # If not, the newest copy with the old schema wins: the app's own copy taken right before the migration is
  # newer than the update script's, and both hold the old schema.
  local choice target
  choice=$(docker compose run --rm --no-deps -T --entrypoint node banking --disable-warning=ExperimentalWarning -e '
    const fs = require("node:fs");
    const { DatabaseSync } = require("node:sqlite");
    const names = (f, readOnly = true) => new DatabaseSync(f, { readOnly }).prepare("SELECT group_concat(name) AS n FROM (SELECT name FROM _migrations ORDER BY name)").get().n;
    const intact = (f) => { const d = new DatabaseSync(f, { readOnly: true }); const q = d.prepare("PRAGMA quick_check(1)").all(); d.close(); return q.length === 1 && q[0].quick_check === "ok"; };
    const want = names(process.argv[1]);
    if (names("/data/banking.db", false) === want) { console.log("same"); process.exit(0); }
    const dir = "/data/backups";
    const copies = fs.readdirSync(dir).filter((f) => /^pre-[A-Za-z0-9_]+-[0-9TZ]+\.db$/.test(f))
      .map((f) => ({ f, t: fs.statSync(`${dir}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of copies) {
      try { if (names(`${dir}/${f}`) === want && intact(`${dir}/${f}`)) { console.log(`restore ${dir}/${f}`); process.exit(0); } } catch { /* unreadable or damaged copy, try the next */ }
    }
    console.log(`restore ${process.argv[1]}`);' "$snapshot" | tail -1)
  if [[ $choice == same ]]; then
    ok "The database is unchanged, so the data stays."
  else
    target=${choice#restore }
    [[ $target =~ ^/data/backups/pre-[A-Za-z0-9_]+-[0-9TZ]+\.db$ ]] || die "Could not choose a backup."
    warn "The new version changed the database. Restoring the copy $(basename "$target"). Changes made after it are lost."
    if [[ -t 0 ]] && ! confirm "Continue?"; then
      docker compose start banking >/dev/null; die "Cancelled, the current version was started again."
    fi
    # what the rollback is about to overwrite is kept first, so nothing is lost for good
    docker compose run --rm --no-deps -T --entrypoint node banking --disable-warning=ExperimentalWarning -e "$DBCOPY_JS" 'exists,keep:^pre-rollback-[0-9TZ]+\.db$' "/data/backups/pre-rollback-$(date -u +%Y%m%dT%H%M%SZ).db" || die "Could not copy the current database, nothing was restored."
    ok "The current database was saved before the restore (pre-rollback-*.db)."
    # the copy is flushed before it replaces the database (a failure stops before the swap), and /data after (the swap
    # is done by then, so a failure there only warns)
    docker compose run --rm --no-deps -T --entrypoint sh banking -c \
      'set -e; cp "$1" /data/banking.db.restore; sync /data/banking.db.restore; rm -f /data/banking.db-wal /data/banking.db-shm; mv /data/banking.db.restore /data/banking.db; sync /data || echo "warning: could not flush /data" >&2' sh "$target"
    ok "Database restored: $target"
  fi

  docker image tag "$IMAGE:previous" "$IMAGE:latest"
  # the source goes back first: docker-compose.yml belongs to the version being restored (--keep refuses to
  # touch files with local changes)
  if [[ -n $prev_commit ]] && git cat-file -e "$prev_commit" 2>/dev/null; then
    git reset --keep "$prev_commit" >/dev/null && ok "Source restored: $(git log -1 --format='%h %s')"
  fi
  # never a build: the previous image is the one just tagged
  docker compose up -d --no-build
  healthy || die "The previous version does not start either. Logs: docker compose logs banking"
  rm -f "$STATE" # one rollback per update
  ok "Running: $(version)"
  say "${dim}The next ./scripts/update.sh tries the update again.${reset}"
}

# the whole run is one function, so bash has read the entire file before it starts: replacing this
# file while it runs (a copy over it) cannot corrupt the update
# The helper's script schedule and policy come from this clone, so a new version may change them: renew them
# after a good update, and only when the helper is on (an install that left it out stays without). A problem
# here never fails the update.
renew_helper() {
  local out
  # shellcheck source=lib/ops-schedule.sh
  . scripts/lib/ops-schedule.sh
  ops_scheduler_present "$IMAGE" || return 0
  # install.sh takes the same per-folder lock as this script (fd 9), so ours goes first; the update is done
  exec 9<&-
  if out=$(./scripts/install.sh --ops-helper 2>&1); then ok "Maintenance helper renewed"
  else
    warn "Could not renew the maintenance helper. Run: ./scripts/install.sh --ops-helper"
    printf '%s\n' "$out" | tail -3
  fi
  return 0
}

main() {
  # one run per directory (the lock is on install.sh, which takes the same one)
  exec 9<scripts/install.sh
  if command -v flock >/dev/null && ! flock -n 9; then
    die "Another update or install is already running in this folder. Wait for it to finish."
  fi
  on_exit() {
    local rc=$?
    ((rc == 0)) && return
    # a die, an interrupt or the helper's timeout before the switch: :latest and the checkout go back to what runs
    [[ $BEFORE_SWITCH == true ]] && keep_old_running
    [[ $REPORTED == true ]] && return
    printf '\n%s✗ The update was interrupted.%s Run ./scripts/update.sh again, it continues where it stopped. If the fault repeats: ./scripts/doctor.sh\n' "$red" "$reset" >&2
  }
  trap on_exit EXIT
  interrupted() {
    REPORTED=true
    printf '\n%sInterrupted. Run ./scripts/update.sh again if the update was left unfinished.%s\n' "$yellow" "$reset" >&2
    exit 130
  }
  trap interrupted INT TERM

  command -v docker >/dev/null || die "Docker is missing. Install it: curl -fsSL https://get.docker.com | sudo sh   (docs/INSTALL.md)."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing. Install: sudo apt install docker-compose-plugin"
  if ! docker info >/dev/null 2>&1; then
    if [[ $(docker info 2>&1 >/dev/null | head -3) == *"permission denied"* ]]; then
      die "Your user has no permission to use Docker. Run: sudo usermod -aG docker \$USER   then log out and in (or: newgrp docker)."
    fi
    die "The Docker service does not respond. Run: sudo systemctl start docker   then this again. Cause: sudo journalctl -u docker -n 30"
  fi
  [[ $IMAGE == "$DEFAULT_INSTANCE" ]] || say "Install: ${bold}$IMAGE${reset} (folder $(pwd))"

  if [[ ${1:-} == --rollback ]]; then rollback; return 0; fi
  [[ -z ${1:-} ]] || die "Usage: ./scripts/update.sh [--yes] [--rollback]"

  # ── update ──
  step "Checking"
  git diff --quiet && git diff --cached --quiet || die "The repository has local changes (git status). Clean them up first."
  # An image of this name without a container or volumes here belongs to another directory (a clone with no .env
  # falls back to banking-app). Tagging :previous over it would break that install's rollback.
  if docker image inspect "$IMAGE:latest" >/dev/null 2>&1 \
    && [[ -z $(docker compose ps -a -q banking 2>/dev/null) ]] \
    && [[ -z $(docker volume ls -q --filter "label=com.docker.compose.project=$(project_name)" 2>/dev/null) ]] \
    && ! grep -qx "INSTANCE=$IMAGE" "$STATE" 2>/dev/null; then
    die "Image $IMAGE:latest exists but does not belong to this folder. Run ./scripts/install.sh first."
  fi
  [[ -n $TARGET ]] || git fetch --quiet --tags 2>/dev/null || die "Could not reach the remote repository (git fetch failed). Nothing was changed, the current version is running. Check the network (git remote -v; git ls-remote origin) and run this again."
  prev_commit=$(git rev-parse HEAD)
  local upstream=''
  if [[ -n $TARGET ]]; then
    git cat-file -e "$TARGET^{commit}" 2>/dev/null || die "Commit $TARGET is not in this folder."
  else
    upstream=$(git rev-parse '@{u}' 2>/dev/null) || die "The branch has no upstream branch (git branch -u origin/<branch>)."
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
    [[ $floor != old ]] || die "The database was made before version 0.1.0 and cannot be updated. Nothing was changed. Install again (docs/INSTALL.md) and import the transactions from CSV files."
  fi

  # Which channel: releases once one exists and this checkout is not ahead of it, else the source
  CHANNEL=source
  local tag='' target=$upstream setting
  [[ -z $TARGET ]] && tag=$(latest_release)
  # the web helper names the exact release it checked (the Releases API); a tag has to exist locally
  if [[ -n ${TALOUS_RELEASE:-} ]]; then
    [[ $TALOUS_RELEASE =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] && git rev-parse -q --verify "refs/tags/$TALOUS_RELEASE^{commit}" >/dev/null || die "Release $TALOUS_RELEASE not found."
    tag=$TALOUS_RELEASE
  fi
  setting=$(channel_setting)
  if [[ -n $TARGET ]]; then
    # the helper chose the commit and the channel; the .env setting may only agree
    [[ -z $setting || $setting == "$MODE" ]] || die "TALOUS_CHANNEL ($setting) does not match the maintenance helper choice ($MODE). Nothing was changed."
    if [[ $MODE == release ]]; then
      [[ -n $tag ]] || die "No release was given."
      [[ $(git rev-parse "refs/tags/$tag^{commit}" 2>/dev/null) == "$TARGET" ]] || die "Release $tag does not point at the checked commit."
    fi
    [[ $MODE == source ]] && tag=''
    CHANNEL=$MODE; target=$TARGET
    git merge-base --is-ancestor HEAD "$target" 2>/dev/null || die "The checked commit does not continue the history of this folder. Nothing was changed."
    say "Channel: $MODE${tag:+ $tag}"
  else
  case $setting in
    source) ;;
    release)
      [[ -n $tag ]] || die "TALOUS_CHANNEL=release is set but there are no releases yet."
      CHANNEL=release ;;
    '')
      if [[ -n $tag ]] && git merge-base --is-ancestor HEAD "$tag^{commit}" 2>/dev/null; then CHANNEL=release; fi ;;
    *) die "TALOUS_CHANNEL is invalid ($setting). Allowed: source, release." ;;
  esac
  if [[ $CHANNEL == release ]]; then
    target=$(git rev-parse "$tag^{commit}")
    # a tag pushed on a side branch is not a release: its commit has to be on the branch this clone follows
    git merge-base --is-ancestor "$target" "$upstream" 2>/dev/null || die "The code of release $tag is not on the branch this clone follows. Nothing was changed."
    git merge-base --is-ancestor HEAD "$target" 2>/dev/null || die "This folder is newer than the latest release ($tag). Use the source channel: add the line TALOUS_CHANNEL=source to .env."
    say "Channel: release $tag"
  fi
  fi

  if [[ $prev_commit == "$target" ]] && docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
    local built
    built=$(image_label "$IMAGE:latest" talous.commit)
    # the running container has to use that image too (a build that finished before a copy failed leaves the
    # old container running on an older image)
    if [[ $built == "$prev_commit" ]] && running && app_up && running_latest; then
      ok "Already current ($(git log -1 --format='%h %s'))."
      return 0
    fi
    # the code is current but the image is older or the app is down (say, a failed update): fetch or build and
    # start again, without a new copy, so $IMAGE:previous stays the version that worked
    if [[ $built == "$prev_commit" ]]; then warn "The newest version is fetched but the app is not running on it. Starting it again."
    else warn "The code is current but the running image was built from another version. Fetching it again."; fi
    check_disk
    if [[ $CHANNEL == release ]]; then fetch_release_image "$tag" "$target"; docker compose up -d --no-build
    else build_image; docker compose up -d; fi
    if healthy; then ok "Running: $(version)"; return 0; fi
    warn "The app did not start. Log:"
    docker compose logs --tail 30 banking || true
    if [[ -f $STATE ]] && confirm "Roll back to the previous version now?"; then
      rollback
    elif [[ -f $STATE ]]; then
      say "Rollback: ${bold}./scripts/update.sh --rollback${reset}"
    fi
    REPORTED=true
    return 1
  fi
  before=$(running && version || echo "not running")
  say "Current: $before"
  say "New changes:"; git log --oneline -20 "HEAD..$target" | sed 's/^/  /'

  check_disk
  # owner-only applies to the state file alone: a global umask would also reach the files
  # git pull writes, and the app in the image could not read them
  mkdir -p backups && chmod 700 backups
  local stamp have_old=false
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  # The running version is kept as :pending-previous before anything new is tagged :latest, and becomes
  # :previous only in take_copy, together with the state file
  # The running container's image is the one to keep: :latest may already be a new image that an earlier run left behind.
  if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
    have_old=true; BEFORE_SWITCH=true
    docker image tag "$(running_image || echo "$IMAGE:latest")" "$IMAGE:pending-previous"
  fi

  step "Fetching the new version"
  if [[ $CHANNEL == release ]]; then
    fetch_release_image "$tag" "$target"
  else
    if [[ -n $TARGET ]]; then git merge --ff-only --quiet "$TARGET"; else git pull --ff-only --quiet; fi
    ok "Source: $(git log -1 --format='%h %s')"
    docker compose pull --ignore-buildable --quiet 2>/dev/null || true # Caddy / cloudflared
    build_image
  fi

  # The copy comes last, so a rollback loses only what was written since this moment
  step "Backup before the switch"
  if [[ $have_old == true ]]; then take_copy "$stamp"; else warn "There is no previous image. No backup is made."; fi
  if [[ $CHANNEL == release ]]; then
    git merge --ff-only --quiet "$target"
    ok "Source: $(git log -1 --format='%h %s')"
    docker compose pull --ignore-buildable --quiet 2>/dev/null || true # Caddy / cloudflared
    BEFORE_SWITCH=false
    docker compose up -d --no-build
  else
    BEFORE_SWITCH=false
    docker compose up -d
  fi

  step "Starting…"
  ((HEALTH_WAIT <= 120)) || say "The migration check took long, so the new version gets up to $HEALTH_WAIT s to start."
  if healthy; then
    ok "Updated: $before to $(version)"
    record_schema_change
    # keep the five newest pre-update copies; the names sort by time
    in_app -e '
      const fs = require("node:fs");
      const dir = "/data/backups";
      if (!fs.existsSync(dir)) process.exit(0);
      const old = fs.readdirSync(dir).filter((f) => /^pre-update-[0-9TZ]+\.db$/.test(f)).sort().reverse().slice(5);
      for (const f of old) fs.rmSync(`${dir}/${f}`);' || true
    renew_helper
    say "${dim}If something is wrong: ./scripts/update.sh --rollback${reset}"
    return 0
  fi

  warn "The new version did not start. Log:"
  docker compose logs --tail 30 banking || true
  if [[ -f $STATE ]] && confirm "Roll back to the previous version now?"; then
    rollback
  else
    say "Roll back later: ${bold}./scripts/update.sh --rollback${reset}"
  fi
  REPORTED=true
  return 1
}
main "$@"
exit $?
