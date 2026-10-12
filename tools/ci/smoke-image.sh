#!/usr/bin/env bash
# tools/ci/smoke-image.sh IMAGE VERSION COMMIT
# Starts a built image as a new install and as an old one, and stops at the first thing a household would trip on. The
# release workflow runs it on an amd64 and on an arm64 runner before anything gets a tag or a signature. CI runs it on
# the image its docker job builds, so the script has run for real before a release depends on it.
#
#   1. The labels installs read say VERSION, COMMIT and the layout number of docker-compose.yml, and the image is built
#      for this machine's processor, so nothing below runs under emulation.
#   2. A new install: the image starts the way docker-compose.yml runs it (read-only root, /tmp as tmpfs, no
#      capabilities, 512 MB) on an empty volume, /api/health answers within 120 s and `version` prints VERSION.
#   3. An old install: a database is built from apps/server/test/fixtures/db/0.5.0.sql with node:sqlite inside the
#      image. `migrate-check` accepts it in a container of its own, as an update asks before it switches. The image
#      starts on it and answers, _migrations holds every migration file of the image, and `migrate-check` finds nothing
#      left to apply.
#
# VERSION and COMMIT may be `unknown`, which an image built without build arguments carries. The labels must then say
# unknown, and `version` must print the version of this checkout.
# The containers have no network: the old database holds bank connections and company ids, and a smoke test calls
# nobody. The app is asked from inside its container, as Docker's own health check asks, so no port is taken.
# Every container and volume is removed at the end, also after a failure. A failure prints the last log lines of the
# containers first.
#
# SMOKE_HEALTH_WAIT is the seconds /api/health may take (120), SMOKE_POLL the seconds between two tries (2).
# Exit code 0 when everything passed, 1 when a check failed, 2 for a wrong command line.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

say() { printf '%s\n' "$*"; }
fail() { printf 'smoke: %s\n' "$*" >&2; exit 1; }
usage() { printf '%s\nusage: smoke-image.sh IMAGE VERSION COMMIT\n' "$*" >&2; exit 2; }

(($# == 3)) || usage "Three arguments, not $#."
IMAGE=$1 VERSION=$2 COMMIT=$3
[[ -n $IMAGE ]] || usage "IMAGE is empty."
[[ $VERSION == unknown || $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage "VERSION is X.Y.Z or unknown, not $VERSION."
[[ $COMMIT == unknown || $COMMIT =~ ^[0-9a-f]{40}$ ]] || usage "COMMIT is a full commit hash or unknown, not $COMMIT."

FIXTURE=$ROOT/apps/server/test/fixtures/db/0.5.0.sql
HEALTH_WAIT=${SMOKE_HEALTH_WAIT:-120}
POLL=${SMOKE_POLL:-2}
DB=/data/banking.db
NODE=(node --disable-warning=ExperimentalWarning)
# what docker-compose.yml gives the service, without its port and with no network at all
HARDENED=(--read-only --tmpfs "/tmp:noexec,nosuid,nodev,size=16m" --cap-drop ALL --security-opt no-new-privileges:true
  --memory 512m --pids-limit 200 --network none)
# The file comes on stdin, because the image holds no test fixtures. Nothing reads the database before it is closed,
# so no statement waits for the disk (apps/server/test/fixture-db.ts).
SEED_JS='const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("PRAGMA synchronous = OFF");
db.exec(require("node:fs").readFileSync(0, "utf8"));
db.close();'
APPLIED_JS='const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1], { readOnly: true });
for (const row of db.prepare("SELECT name FROM _migrations ORDER BY name").all()) console.log(row.name);
db.close();'

# one name for a container and the volume behind its /data; the image's own anonymous /secrets volume goes with rm -v
ID=smoke-$$-$(date +%s)
NEW=$ID-new OLD=$ID-old SEED=$ID-seed CHECK=$ID-check
STARTED=$SECONDS

cleanup() {
  local rc=$? c
  trap - EXIT
  # bash 5.2 runs this trap also in a part of a pipeline that dies of an unset variable. Only the script's own end
  # may remove what the steps after it still need.
  [[ $BASHPID == "$$" ]] || exit "$rc"
  if ((rc != 0)); then
    for c in "$NEW" "$OLD"; do
      docker inspect "$c" >/dev/null 2>&1 || continue
      say "--- the last log lines of $c"
      docker logs --tail 40 "$c" 2>&1 || true
    done
  fi
  for c in "$NEW" "$OLD" "$SEED" "$CHECK"; do docker rm -f -v "$c" >/dev/null 2>&1 || true; done
  for c in "$NEW" "$OLD"; do docker volume rm -f "$c" >/dev/null 2>&1 || true; done
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# what the app answers to a GET from inside its own container
answer() { docker exec "$1" wget -qO- "http://127.0.0.1:8080$2" 2>/dev/null; } # answer CONTAINER PATH
wait_health() { # wait_health CONTAINER
  local c=$1 from=$SECONDS body
  while :; do
    if body=$(answer "$c" /api/health) && [[ $body == *'"ok":true'* ]]; then
      say "ok   $c: /api/health answers after $((SECONDS - from)) s"
      return 0
    fi
    [[ $(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null || true) == true ]] || fail "$c stopped before /api/health answered."
    ((SECONDS - from < HEALTH_WAIT)) || fail "$c: /api/health did not answer within $HEALTH_WAIT s."
    sleep "$POLL"
  done
}
# migrate_check NODE...: runs the image's migrate-check with that node command and prints its one JSON line
migrate_check() {
  local report
  report=$("$@" dist/node.js migrate-check "$DB") || fail "migrate-check failed on $DB: ${report:-no report}"
  report=${report##*$'\n'}
  [[ $report == '{"ok":true,'* ]] || fail "migrate-check did not report ok: ${report:-no report}"
  printf '%s\n' "$report"
}

[[ -r $FIXTURE ]] || fail "The old database is missing: $FIXTURE"
compat=$(sed -n '/^x-talous-compat:/{s/^x-talous-compat: *\([0-9][0-9]*\).*/\1/p;q;}' "$ROOT/docker-compose.yml")
[[ -n $compat ]] || fail "docker-compose.yml has no x-talous-compat."
tree=$(sed -n 's/^export const APP_VERSION = "\(.*\)";$/\1/p' "$ROOT/apps/server/src/version.ts")
[[ -n $tree ]] || fail "apps/server/src/version.ts has no APP_VERSION."

# ── 1. labels and processor ──
labels=$(docker image inspect -f '{{index .Config.Labels "talous.version"}}|{{index .Config.Labels "talous.commit"}}|{{index .Config.Labels "talous.compose"}}|{{.Os}}/{{.Architecture}}' "$IMAGE") \
  || fail "This machine has no image $IMAGE."
IFS='|' read -r l_version l_commit l_compose platform <<<"$labels"
[[ $l_version == "$VERSION" ]] || fail "The label talous.version says ${l_version:-nothing}, not $VERSION."
[[ $l_commit == "$COMMIT" ]] || fail "The label talous.commit says ${l_commit:-nothing}, not $COMMIT."
[[ $l_compose == "$compat" ]] || fail "The label talous.compose says ${l_compose:-nothing}, docker-compose.yml has layout $compat."
host=$(docker version -f '{{.Server.Os}}/{{.Server.Arch}}') || fail "Docker does not answer."
[[ $platform == "$host" ]] || fail "The image is built for $platform and this machine is $host."
say "ok   labels: version $l_version, commit ${l_commit:0:12}, compose layout $l_compose, built for $platform"

# ── 2. a new install ──
docker volume create "$NEW" >/dev/null
docker run -d --name "$NEW" "${HARDENED[@]}" -v "$NEW:/data" "$IMAGE" >/dev/null || fail "The image did not start on an empty volume."
wait_health "$NEW"
state=$(answer "$NEW" /api/auth/state) || fail "$NEW: /api/auth/state did not answer."
[[ $state == *'"needsSetup":true'* ]] || fail "$NEW: an empty install does not ask for its first user: $state"
printed=$(docker exec "$NEW" "${NODE[@]}" dist/node.js version) || fail "$NEW: \`version\` failed."
printed=${printed##*$'\n'}
# an image built without build arguments still knows its version: the one in the tree it was built from
[[ $VERSION == unknown ]] && want=$tree || want=$VERSION
[[ ${printed%% *} == "$want" ]] || fail "\`version\` prints ${printed:-nothing}, not $want."
say "ok   $NEW: \`version\` prints $printed"

# ── 3. an old install ──
docker volume create "$OLD" >/dev/null
docker run --rm -i --name "$SEED" "${HARDENED[@]}" -v "$OLD:/data" --entrypoint node "$IMAGE" --disable-warning=ExperimentalWarning -e "$SEED_JS" "$DB" <"$FIXTURE" \
  || fail "node:sqlite inside the image could not build the database of 0.5.0."
before=$(migrate_check docker run --rm --name "$CHECK" "${HARDENED[@]}" -v "$OLD:/data" --entrypoint node "$IMAGE" --disable-warning=ExperimentalWarning) || exit 1
# a check that applied nothing looked at a database that is not old, and would pass whatever the migrations do
[[ $before != *'"applied":[]'* ]] || fail "The database of 0.5.0 had no migration left to apply: $before"
say "ok   migrate-check accepts the database of 0.5.0"
docker run -d --name "$OLD" "${HARDENED[@]}" -v "$OLD:/data" "$IMAGE" >/dev/null || fail "The image did not start on the database of 0.5.0."
wait_health "$OLD"
state=$(answer "$OLD" /api/auth/state) || fail "$OLD: /api/auth/state did not answer."
[[ $state == *'"needsSetup":false'* ]] || fail "$OLD: the users of the old database are gone: $state"
files=$(docker exec "$OLD" ls migrations) || fail "$OLD: cannot list the migration files of the image."
applied=$(docker exec "$OLD" "${NODE[@]}" -e "$APPLIED_JS" "$DB") || fail "$OLD: cannot read _migrations."
count=0 missing=()
while read -r file; do
  [[ $file =~ ^[0-9]{4}_.+\.sql$ ]] || continue
  count=$((count + 1))
  grep -Fx -- "$file" <<<"$applied" >/dev/null || missing+=("$file")
done <<<"$files"
((count > 0)) || fail "$OLD: the image holds no migration files."
((${#missing[@]} == 0)) || fail "$OLD: _migrations lacks ${missing[*]}."
say "ok   $OLD: _migrations holds all $count migration files"
after=$(migrate_check docker exec "$OLD" "${NODE[@]}") || exit 1
[[ $after == *'"applied":[]'* ]] || fail "$OLD: migrations were left to apply after the start: $after"
say "ok   $OLD: migrate-check finds nothing left to apply"

say "smoke ok: $IMAGE in $((SECONDS - STARTED)) s"
