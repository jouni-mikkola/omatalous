#!/usr/bin/env bash
# tools/ci/image-checks.sh IMAGE
# The three Docker checks that the docker job of ci.yml used to hold as lines of the workflow, as a script, so that the
# release machine runs them (tools/ci/local-proof.sh, leg container) and a billed runner needs not:
#
#   1. The image runs the way docker-compose.yml runs it (read-only root, no capabilities, named volumes for the data and
#      the app secret) and the first-run path works through a published port: the app makes its own secret, readable by
#      its owner only; the setup code makes the first user; the bank-app wizard makes a key in the container and only the
#      certificate comes out.
#   2. docker-compose.yml resolves: the port, address and name keys, also for IPv6 and an empty Caddy address.
#   3. The compose file twice, as two projects on one host: own container, image, volumes and port. One cookie jar is
#      logged in to both, which holds only while the cookie names differ.
#
# Nothing here uses a fixed port or name: the ports are free ones the machine hands out and every name carries the
# process id, so a lane of the proof (8080 and up) or an install on this machine is never touched. The containers,
# volumes, tags and projects are removed at the end, also after a failure, which prints the last log lines first.
# CHECKS_HEALTH_WAIT is the seconds the app may take to answer (30).
# Exit code 0 when everything passed, 1 when a check failed, 2 for a wrong command line.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

say() { printf '%s\n' "$*"; }
fail() { printf 'image-checks: %s\n' "$*" >&2; exit 1; }
usage() { printf '%s\nusage: image-checks.sh IMAGE\n' "$*" >&2; exit 2; }

(($# == 1)) || usage "One argument, not $#."
IMAGE=$1
[[ -n $IMAGE ]] || usage "IMAGE is empty."
HEALTH_WAIT=${CHECKS_HEALTH_WAIT:-30}

ID=checks-$$
APP=$ID-app
INSTANCES=("$ID-a" "$ID-b")
WORK=$(mktemp -d "${TMPDIR:-/tmp}/image-checks.XXXXXX")
H=(-H 'Content-Type: application/json' -H 'X-Requested-With: fetch')
STARTED=$SECONDS

cleanup() {
  local rc=$? i
  trap - EXIT
  [[ $BASHPID == "$$" ]] || exit "$rc"
  if ((rc != 0)) && docker inspect "$APP" >/dev/null 2>&1; then
    say "--- the last log lines of $APP"
    docker logs --tail 40 "$APP" 2>&1 || true
  fi
  docker rm -f -v "$APP" >/dev/null 2>&1 || true
  docker volume rm -f "$APP-data" "$APP-secrets" >/dev/null 2>&1 || true
  for i in "${INSTANCES[@]}"; do
    if ((rc != 0)) && docker inspect "$i" >/dev/null 2>&1; then
      say "--- the last log lines of $i"
      docker logs --tail 40 "$i" 2>&1 || true
    fi
    (cd "$ROOT" && INSTANCE_NAME=$i COMPOSE_PROJECT_NAME=$i docker compose down -v >/dev/null 2>&1) || true
    docker rmi -f "$i:latest" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# a port nothing listens on now (the machine hands it out)
free_port() { node -e 'const s=require("node:net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
# wait_health PORT NAME
wait_health() {
  local from=$SECONDS
  until curl -fsS "localhost:$1/api/health" >/dev/null 2>&1; do
    ((SECONDS - from < HEALTH_WAIT)) || fail "$2: /api/health did not answer within $HEALTH_WAIT s."
    sleep 1
  done
}
# setup PORT NAME JAR: the first user, with the code the container prints
setup() {
  local code
  code=$(docker exec "$2" node --disable-warning=ExperimentalWarning dist/node.js setup-code | tail -1) || fail "$2: no setup code."
  curl -fsS -b "$3" -c "$3" "${H[@]}" -d "{\"code\":\"$code\",\"username\":\"ci-admin\",\"displayName\":\"CI\",\"password\":\"ci-salasana-123456\"}" "localhost:$1/api/auth/setup" >/dev/null \
    || fail "$2: the first user could not be made."
}

docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "This machine has no image $IMAGE."
cd "$ROOT"

# ── 1. the container the way compose runs it ──
docker volume create "$APP-data" >/dev/null
docker volume create "$APP-secrets" >/dev/null
docker run -d --name "$APP" -p 127.0.0.1::8080 --read-only --tmpfs /tmp:noexec,nosuid,nodev \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$APP-data:/data" -v "$APP-secrets:/secrets" -e APP_SECRET_FILE=/secrets/app_secret "$IMAGE" >/dev/null \
  || fail "The image did not start with a read-only root and no capabilities."
port=$(docker port "$APP" 8080/tcp | head -1)
port=${port##*:}
[[ $port =~ ^[0-9]+$ ]] || fail "$APP: Docker published no port ($port)."
wait_health "$port" "$APP"
say "ok   $APP: /api/health answers on a published port"
# the app created its own secret, readable by its owner only
[[ $(docker exec "$APP" stat -c '%a %U' /secrets/app_secret) == '600 node' ]] || fail "/secrets/app_secret is not 600 node."
[[ $(docker exec "$APP" stat -c '%a %U' /secrets) == '700 node' ]] || fail "/secrets is not 700 node."
curl -fsS "localhost:$port/api/auth/state" | grep '"needsSetup":true' >/dev/null || fail "An empty install does not ask for its first user."
setup "$port" "$APP" "$WORK/jar"
curl -fsS -b "$WORK/jar" "localhost:$port/api/admin/instance" | grep '"secret":{"available":true}' >/dev/null || fail "The admin page does not see the app secret."
# setup wizard: the key is generated in the container and only the certificate comes out
curl -fsS -b "$WORK/jar" "${H[@]}" -X POST "localhost:$port/api/admin/bank-app/key" | grep '"hasCertificate":true' >/dev/null || fail "The wizard made no certificate."
curl -fsS -b "$WORK/jar" "localhost:$port/api/admin/bank-app/certificate" -o "$WORK/ci.crt" || fail "The certificate could not be read."
openssl x509 -in "$WORK/ci.crt" -noout -subject -enddate || fail "The certificate is not one."
if grep "PRIVATE KEY" "$WORK/ci.crt" >/dev/null; then fail "The private key leaked through the certificate route."; fi
say "ok   $APP: secret 600, first user, wizard key kept inside, certificate only"

# ── 2. the compose file ──
docker compose config -q || fail "docker compose config fails."
INSTANCE_NAME=ci-x HOST_PORT=8085 BIND_ADDRESS=::1 docker compose config | grep 'container_name: ci-x' >/dev/null || fail "INSTANCE_NAME does not name the container."
INSTANCE_NAME=ci-x HOST_PORT=8085 BIND_ADDRESS=::1 docker compose config | grep 'image: ci-x:latest' >/dev/null || fail "INSTANCE_NAME does not name the image."
INSTANCE_NAME=ci-x HOST_PORT=8085 BIND_ADDRESS=::1 docker compose config | grep 'host_ip: ::1' >/dev/null || fail "BIND_ADDRESS ::1 does not reach the port."
INSTANCE_NAME=ci-x HOST_PORT=8085 BIND_ADDRESS=::1 docker compose config | grep 'published: "8085"' >/dev/null || fail "HOST_PORT does not reach the port."
COMPOSE_PROFILES=caddy CADDY_ADDRESS=127.0.0.2 docker compose config | grep 'host_ip: 127.0.0.2' >/dev/null || fail "CADDY_ADDRESS does not reach the Caddy port."
COMPOSE_PROFILES=caddy docker compose config | grep 'published: "443"' >/dev/null || fail "An empty CADDY_ADDRESS does not publish 443."
COMPOSE_PROFILES=caddy CADDY_ADDRESS='[::1]' docker compose config | grep 'host_ip: ::1' >/dev/null || fail "CADDY_ADDRESS [::1] does not reach the Caddy port."
say "ok   docker-compose.yml: port, address and name keys resolve"

# ── 3. two instances side by side ──
ports=()
for i in "${INSTANCES[@]}"; do
  p=$(free_port)
  ports+=("$p")
  docker tag "$IMAGE" "$i:latest"
  INSTANCE_NAME=$i COMPOSE_PROJECT_NAME=$i HOST_PORT=$p docker compose up -d --no-build banking >/dev/null || fail "$i did not start."
  wait_health "$p" "$i"
done
for i in "${INSTANCES[@]}"; do
  docker volume ls -q | grep -x "${i}_banking-data" >/dev/null || fail "$i has no volume of its own."
done
for n in 0 1; do setup "${ports[n]}" "${INSTANCES[n]}" "$WORK/both"; done
# the jar holds both cookies and each instance accepts its own
for p in "${ports[0]}" "${ports[1]}" "${ports[0]}"; do
  curl -fsS -b "$WORK/both" -c "$WORK/both" "localhost:$p/api/admin/instance" >/dev/null || fail "Port $p does not accept its own cookie."
done
say "ok   two instances: own container, image, volume and port, one cookie jar for both"

say "image checks ok: $IMAGE in $((SECONDS - STARTED)) s"
