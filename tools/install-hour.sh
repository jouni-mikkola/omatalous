#!/usr/bin/env bash
# Install hour (roadmap step 24, done): the one-line install on a clean machine to the household's own year of figures
# against the fake bank, with the time of each step in a log. Local only: needs Docker, a built tree (`pnpm build`) and a
# Playwright Chromium; it is no part of `pnpm check`, `pnpm e2e` or CI.
#
#   bash tools/install-hour.sh [--keep] [--cold] [--budget MINUTES]
#
# --cold first empties Docker's build cache (all of it, the machine's other builds too), so the build downloads everything.
# The instance is named install-hour (`--new-instance`), so a household's own install on the same Docker is never touched.
# DOCKER_BIN, COMPOSE_PLUGIN and DOCKER_SOCK name the Docker client, its Compose plugin and its socket when they are not
# at /usr/bin/docker, ~/.docker/cli-plugins/docker-compose and /run/user/<uid>/docker.sock (rootless Docker).
#
# The clean machine is an Ubuntu container with nothing but a user, sudo and the Docker client, which talks to the
# host's Docker (socket bridge), so the app comes up as a sibling container. The container runs relay/install.sh as a
# normal user, as a household would (`bash omatalous-install.sh --yes`), with two stand-ins the real thing has no use for:
#   - GitHub: the release API answer is a file served on the machine's own port 8000 and the repository a bare clone of this tree, both through the test
#     hooks of relay/install.sh (OPS_TEST=1). The release is the HEAD commit, tagged v99.0.0 in the copy only.
#   - the bank: e2e/fake-bank runs in the app container's network (EB_API_URL accepts loopback only) from a Compose file
#     in COMPOSE_FILE, outside the clone, which the update policy would refuse as an extra file.
# The image is built from the source (TALOUS_CHANNEL=source), because no signed image exists for this commit. A real
# household pulls a finished image, so the build step here is longer than theirs. Docker's own install is outside the
# run: the container has the client already (the Docker daemon cannot start inside a container without systemd).
# The installer prints no setup link here: Compose's `exec` loses its output through the socket bridge, so the run reads
# the code with `docker exec` instead. On a real machine the link is printed (tools/test/install.test.sh holds it).
# Nothing reaches Enable Banking: the app is pointed at the fake bank and the consent page is answered by the spec.
#
# The log (install-hour.log in the run folder) has the seconds since the start before every line, then a summary of
# the steps and the questions the household answers. The run fails when the total is over the budget (default 60).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
KEEP=false; COLD=false; BUDGET=60
while (($#)); do
  case $1 in
    --keep) KEEP=true ;;
    --cold) COLD=true ;;
    --budget) BUDGET=$2; shift ;;
    *) printf 'Usage: bash tools/install-hour.sh [--keep] [--cold] [--budget MINUTES]\n' >&2; exit 2 ;;
  esac
  shift
done

RUN=${TMPDIR:-/tmp}/install-hour   # emptied at the start of every run
CT=install-hour-clean
APP=install-hour       # the instance name and the clone's folder: no name a household's own install has
PORT=18080
BANK_PORT=19099
IMAGE=ubuntu:24.04
HOME_IN=$RUN/home      # the same path inside and outside, so the Compose paths the installer writes are true on the host too
LOG=$RUN/install-hour.log
SECS=$SECONDS

# the volumes and the image of the instance are named after it: only those, never a household's own
drop_volumes() { docker rmi -f "$APP:latest" >/dev/null 2>&1 || true; docker volume ls -q --filter "name=^${APP}_" | xargs -r docker volume rm >/dev/null 2>&1 || true; }

cleanup() {
  if $KEEP; then return 0; fi
  docker rm -f "$CT" install-hour-bank "$APP" >/dev/null 2>&1 || true
  drop_volumes
}
trap cleanup EXIT

say() { printf '[%4ds] %s\n' $((SECONDS - SECS)) "$*" | tee -a "$LOG"; }
stamp() { while IFS= read -r line; do say "$line"; done; }

docker rm -f "$CT" install-hour-bank "$APP" >/dev/null 2>&1 || true
# the volumes of an earlier run would make the install an existing one with an admin
drop_volumes
if [[ -d $RUN ]]; then
  # files made by the user inside the container belong to another uid on the host: the container removes them
  docker run --rm -v "$RUN:/run-dir" "$IMAGE" rm -rf /run-dir/home /run-dir/fixture
  rm -rf "$RUN"
fi
$COLD && docker builder prune -af >/dev/null
mkdir -p "$RUN/fixture" "$HOME_IN"; chmod 777 "$HOME_IN"
: >"$LOG"

# ── fixture (not timed): the repository and the release answer the one-line install asks for ──────────────────────
commit=$(git rev-parse HEAD)
git clone --quiet --bare "$ROOT" "$RUN/fixture/repo.git"
git --git-dir="$RUN/fixture/repo.git" update-ref refs/heads/main "$commit"
git --git-dir="$RUN/fixture/repo.git" tag -f v99.0.0 "$commit" >/dev/null
printf '{"tag_name": "v99.0.0", "prerelease": false}\n' >"$RUN/fixture/latest.json"
printf '#!/bin/sh\nread -r _\nprintf "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nConnection: close\\r\\n\\r\\n"\ncat /fixture/latest.json\n' >"$RUN/fixture/api.sh"
cp relay/install.sh "$RUN/fixture/omatalous-install.sh"
cat >"$RUN/fixture/override.yml" <<YAML
services:
  banking:
    environment:
      EB_API_URL: http://127.0.0.1:9099
      EB_AUTH_HOSTS: consent.esimerkkipankki.example
    ports:
      - target: 9098
        host_ip: 127.0.0.1
        published: "$BANK_PORT"
        protocol: tcp
YAML
chmod +x "$RUN/fixture/api.sh"
chmod -R a+rX "$RUN/fixture"
KEY=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)

# ── the clean machine (not timed): a user and sudo, the Docker client, no curl, no git ───────────────────────────────
docker run -d --name "$CT" -v "$RUN/fixture:/fixture:ro" -v "$HOME_IN:$HOME_IN" \
  -v "${DOCKER_BIN:-/usr/bin/docker}:/usr/local/bin/docker:ro" -v "${COMPOSE_PLUGIN:-$HOME/.docker/cli-plugins/docker-compose}:/usr/local/lib/docker/cli-plugins/docker-compose:ro" \
  -v "${DOCKER_SOCK:-/run/user/$(id -u)/docker.sock}:/host-docker.sock" "$IMAGE" sleep infinity >/dev/null
docker exec "$CT" bash -c "apt-get update -qq && apt-get install -y -qq sudo socat >/dev/null \
  && { useradd -d '$HOME_IN' -s /bin/bash -u 2000 household || true; } \
  && printf '[safe]\\n\\tdirectory = *\\n' >/etc/gitconfig \
  && echo 'household ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/household \
  && { setsid socat UNIX-LISTEN:/var/run/docker.sock,fork,mode=666 UNIX-CONNECT:/host-docker.sock >/dev/null 2>&1 & } \
  && { setsid socat TCP-LISTEN:8000,bind=127.0.0.1,fork,reuseaddr EXEC:/fixture/api.sh >/dev/null 2>&1 & } \
  && sleep 1 && ! command -v curl >/dev/null && ! command -v git >/dev/null"
SECS=$SECONDS
say "clean machine ready: $IMAGE, user household, sudo, Docker client, no curl or git"

# ── 1. the one-line install, from the download to the printed address ────────────────────────────────────────────────
say "start: the household runs bash omatalous-install.sh --yes (download, curl and git, clone; stand-ins: release answer, bare repository)"
docker exec -u household -e HOME="$HOME_IN" -e OPS_TEST=1 -e TALOUS_API=http://127.0.0.1:8000/latest -e TALOUS_REPO=file:///fixture/repo.git \
  -e TALOUS_CHANNEL=source -e COMPOSE_FILE=docker-compose.yml:/fixture/override.yml -e TERM=dumb -w "$HOME_IN" "$CT" \
  bash /fixture/omatalous-install.sh --yes --new-instance "$APP" --access local --port "$PORT" 2>&1 | stamp
say "installer done"

# ── 2. the fake bank beside the app, and the household's year of figures through the browser ───────────────────────
docker run -d --name install-hour-bank --network "container:$APP" -v "$ROOT/e2e/fake-bank:/fb:ro" -e FAKE_BANK_PORT=9099 node:24-alpine sh -c \
  "node /fb/server.mjs & node -e \"require('net').createServer(c=>{const u=require('net').connect(9099,'127.0.0.1');c.pipe(u).pipe(c)}).listen(9098,'0.0.0.0')\"" >/dev/null
until curl -fsS "http://127.0.0.1:$BANK_PORT/fake/evening-expected" -o "$RUN/expected.json" 2>/dev/null; do sleep 1; done
CODE=$(docker exec "$APP" node --disable-warning=ExperimentalWarning dist/node.js setup-code | tail -1)
say "fake bank up, setup code read from the app"
export KEY
INSTALL=$(node -e 'console.log(JSON.stringify({ base: "http://localhost:" + process.argv[1], dir: process.argv[2], setupCode: process.argv[3],
  fakeBank: JSON.stringify({ url: "http://127.0.0.1:" + process.argv[4], consentHost: "consent.esimerkkipankki.example", appId: "00000000-0000-4000-8000-000000000001", privateKeyPem: process.env.KEY }) }))' \
  "$PORT" "$RUN" "$CODE" "$BANK_PORT")
set +e
E2E_INSTALL=$INSTALL E2E_EVENING_EXPECTED=$RUN/expected.json E2E_SERVERS="[$INSTALL]" E2E_FIRST_EVENING=1 \
  pnpm exec playwright test -c e2e/playwright.config.ts --project=first-evening 2>&1 | stamp
STATUS=${PIPESTATUS[0]}
set -e
say "browser steps done"

# ── summary ─────────────────────────────────────────────────────────────────────────────────────────────────────────
TOTAL=$((SECONDS - SECS))
# nothing went to the bank's own address: the app was pointed at the fake bank and has not named Enable Banking since
[[ $(docker exec "$APP" printenv EB_API_URL) == http://127.0.0.1:* ]] || { say "PROBLEM: the app is not pointed at the fake bank"; STATUS=1; }
docker logs "$APP" >"$RUN/app.log" 2>&1
if grep -qi 'enablebanking\.com' "$RUN/app.log"; then say "PROBLEM: the app log names enablebanking.com"; STATUS=1; fi
{
  printf '\nSteps (seconds since the start; the time each step took is the next number):\n'
  grep -E '▸|start:|installer done|fake bank up|browser steps done' "$LOG" | sed 's/\x1b\[[0-9;]*m//g; s/^\[ *//; s/s\] / /' \
    | awk '{ at = $1 + 0; if (NR > 1) printf "  %4d s  %s\n", at - prev_at, prev; prev = $0; sub(/^[0-9]+ /, "", prev); prev_at = at } END { printf "  %4d s  %s\n", 0, prev }'
  printf '\nBrowser steps (seconds since the page opened, from the spec):\n'
  grep -E '(empty install|administrator made|first fetch done|picture drawn|rows compared): ' "$LOG" | sed 's/^\[ *[0-9]*s\] /  /'
  printf '\nQuestions the household answers:\n'
  printf '  Installer, only without --yes:\n'
  grep -ho '\(confirm\|ask\|ask_secret\) \([A-Z_]* \)\?"[^"]*"' relay/install.sh scripts/install.sh scripts/lib/install-host.sh | grep -v '"Question"\|"\$__q"' | sed -E 's/^[a-z_]+ ([A-Z_]+ )?"/    /; s/"$//' | sort -u
  printf '  Browser (the labels of the setup form and the buttons the spec presses):\n'
  grep -E 'getByLabel\(|getByRole\("button"' e2e/first-evening/first-evening.spec.ts | sed -E 's/.*getByLabel\("([^"]*)".*/    field: \1/; s/.*getByRole\("button", \{ name: "([^"]*)".*/    button: \1/' | sort -u
  printf '    (linkFakeBank, e2e/helpers.ts:) the bank application (App ID, private key), the bank (Nordea), the bank login and consent\n'
  printf '\nTotal: %d s (%d min), budget %d min, without the bank'"'"'s own pages (the fake bank answers at once).\n' "$TOTAL" $((TOTAL / 60)) "$BUDGET"
} | tee -a "$LOG"
((STATUS == 0)) || { say "the browser steps failed (exit $STATUS)"; exit 1; }
((TOTAL <= BUDGET * 60)) || { say "over the budget"; exit 1; }
say "done; log: $LOG"
