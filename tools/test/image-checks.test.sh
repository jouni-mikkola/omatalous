#!/usr/bin/env bash
# Tests for tools/ci/image-checks.sh with stub `docker`, `curl` and `openssl`: the stubs record every call and play a
# healthy image, and a file in the stub folder changes one answer. The compose stub prints the keys a real
# `docker compose config` prints for the variables it is given. No Docker is needed.
#
#   tools/test/image-checks.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
has() { if [[ $2 == *"$3"* ]]; then pass "$1"; else fail "$1" "$2"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
TREE=$TMP/tree
STUB=$TMP/stub
mkdir -p "$TREE/tools/ci" "$STUB"
cp "$REPO/tools/ci/image-checks.sh" "$TREE/tools/ci/"
printf 'x-talous-compat: 7\nservices: {}\n' >"$TREE/docker-compose.yml"

cat >"$STUB/docker" <<'STUB_DOCKER'
#!/usr/bin/env bash
dir=$(dirname "$0")
printf '%s\n' "$*" >>"$dir/calls"
val() { if [[ -e $dir/$1 ]]; then cat "$dir/$1"; else printf '%s\n' "$2"; fi; }
case $1 in
  image) [[ ! -e $dir/no-image ]] || exit 1 ;;
  volume)
    case $2 in
      create) touch "$dir/volumes/$3" ;;
      rm) for a in "${@:3}"; do [[ $a == -* ]] || rm -f "$dir/volumes/$a"; done ;;
      ls) ls "$dir/volumes" ;;
    esac ;;
  run) for a in "$@"; do last=$a; done; touch "$dir/containers/$(printf '%s\n' "$@" | grep -A1 -x -e --name | tail -1)" ;;
  port) echo "127.0.0.1:$(val port 40123)" ;;
  exec)
    case $* in
      *"stat -c"*"/secrets/app_secret") val secret-mode "600 node" ;;
      *"stat -c"*"/secrets") val dir-mode "700 node" ;;
      *"setup-code"*) echo "CODE-123" ;;
    esac ;;
  inspect) [[ -e $dir/containers/${!#} ]] || exit 1 ;;
  logs) echo "log line of ${!#}" ;;
  rm) rm -f "$dir/containers/${!#}" ;;
  tag) touch "$dir/tags/${*: -1}" ;;
  rmi) rm -f "$dir/tags/${!#}" ;;
  compose)
    shift
    case $1 in
      config)
        [[ ! -e $dir/bad-compose ]] || { echo "services: {}"; exit 0; }
        name=${INSTANCE_NAME:-banking-app}
        echo "container_name: $name"; echo "image: $name:latest"
        if [[ ${COMPOSE_PROFILES:-} == caddy ]]; then
          a=${CADDY_ADDRESS:-}; a=${a#[}; a=${a%]}
          [[ -z $a ]] && echo 'published: "443"' || echo "host_ip: $a"
        else
          echo "host_ip: ${BIND_ADDRESS:-127.0.0.1}"; echo "published: \"${HOST_PORT:-8080}\""
        fi ;;
      up)
        touch "$dir/containers/$INSTANCE_NAME"
        [[ -e $dir/no-instance-volume ]] || touch "$dir/volumes/${INSTANCE_NAME}_banking-data" ;;
      down)
        rm -f "$dir/containers/$INSTANCE_NAME" "$dir/volumes/${INSTANCE_NAME}_banking-data" ;;
    esac ;;
esac
STUB_DOCKER
cat >"$STUB/curl" <<'STUB_CURL'
#!/usr/bin/env bash
dir=$(dirname "$0")
printf '%s\n' "$*" >>"$dir/curl-calls"
val() { if [[ -e $dir/$1 ]]; then cat "$dir/$1"; else printf '%s\n' "$2"; fi; }
out= url= prev=
for a in "$@"; do [[ $prev == -o ]] && out=$a; [[ $a == localhost:* ]] && url=$a; prev=$a; done
case $url in
  */api/health) [[ ! -e $dir/no-health ]] && echo '{"ok":true}' || exit 22 ;;
  */api/auth/state) val state '{"needsSetup":true,"user":null}' ;;
  */api/auth/setup) echo '{"ok":true}' ;;
  */api/admin/instance) val instance '{"secret":{"available":true}}' ;;
  */bank-app/key) val key '{"hasCertificate":true}' ;;
  */bank-app/certificate) val cert '-----BEGIN CERTIFICATE-----' >"$out" ;;
esac
STUB_CURL
cat >"$STUB/openssl" <<'STUB_OPENSSL'
#!/usr/bin/env bash
echo "subject=CN = test"; echo "notAfter=Jan  1 00:00:00 2030 GMT"
STUB_OPENSSL
chmod +x "$STUB/docker" "$STUB/curl" "$STUB/openssl"

reset() {
  find "$STUB" -mindepth 1 ! -name docker ! -name curl ! -name openssl -delete
  mkdir -p "$STUB/containers" "$STUB/volumes" "$STUB/tags"
  : >"$STUB/calls"; : >"$STUB/curl-calls"
}
put() { printf '%s\n' "$2" >"$STUB/$1"; }
run() { PATH="$STUB:$PATH" CHECKS_HEALTH_WAIT=${WAIT:-2} TMPDIR=$TMP bash "$TREE/tools/ci/image-checks.sh" "$@" 2>&1; }
left() { find "$STUB/containers" "$STUB/volumes" "$STUB/tags" -type f | wc -l; }
called() { grep -c -- "$1" "$STUB/calls"; }

# ── a healthy image ──
reset
out=$(run img:1); rc=$?
check "exit 0 on a healthy image" test $rc -eq 0
has "says so at the end" "$out" "image checks ok: img:1"
has "the container runs read-only, without capabilities, with a published port" "$(grep '^run -d' "$STUB/calls")" "-p 127.0.0.1::8080 --read-only --tmpfs /tmp:noexec,nosuid,nodev --cap-drop ALL --security-opt no-new-privileges:true"
has "it has the data and secret volumes and the secret file" "$(grep '^run -d' "$STUB/calls")" "-e APP_SECRET_FILE=/secrets/app_secret"
check "the wizard's key is asked for through the route, the certificate is read" test "$(grep -c 'bank-app/key' "$STUB/curl-calls")" -eq 1 -a "$(grep -c 'bank-app/certificate' "$STUB/curl-calls")" -eq 1
check "two instances come up as two compose projects" test "$(called '^compose up -d --no-build banking')" -eq 2
check "each instance image is tagged and the compose file is read for the keys" test "$(called '^tag img:1 checks-')" -eq 2 -a "$(called '^compose config')" -ge 7
check "no fixed port is used" test "$(grep -c -e 'localhost:80[0-9][0-9]/' "$STUB/curl-calls")" -eq 0
check "no container, volume or tag is left" test "$(left)" -eq 0
check "the instances are taken down with their volumes" test "$(called '^compose down -v')" -eq 2
check "the temp folder of the run is removed" test -z "$(find "$TMP" -maxdepth 1 -name 'image-checks.*')"

# ── faults ──
reset; put no-image 1
out=$(run img:1); rc=$?
check "exit 1 when the image is not on the machine" test $rc -eq 1 -a "$(called '^run ')" -eq 0
reset; put no-health 1
out=$(WAIT=1 run img:1); rc=$?
check "exit 1 when the app does not answer" test $rc -eq 1
has "names the wait" "$out" "/api/health did not answer within 1 s"
has "shows the log of the container" "$out" "log line of checks-"
check "and nothing is left" test "$(left)" -eq 0
reset; put secret-mode "644 root"
out=$(run img:1); rc=$?
check "exit 1 when the app secret is not 600 node" test $rc -eq 1
has "names the file" "$out" "/secrets/app_secret is not 600 node"
reset; put dir-mode "755 node"
out=$(run img:1); rc=$?
check "exit 1 when the secrets folder is not 700 node" test $rc -eq 1
reset; put state '{"needsSetup":false}'
out=$(run img:1); rc=$?
check "exit 1 when an empty install does not ask for its first user" test $rc -eq 1
reset; put cert '-----BEGIN PRIVATE KEY-----'
out=$(run img:1); rc=$?
check "exit 1 when the certificate route leaks the private key" test $rc -eq 1
has "says so" "$out" "private key leaked"
check "and nothing is left" test "$(left)" -eq 0
reset; put key '{"hasCertificate":false}'
out=$(run img:1); rc=$?
check "exit 1 when the wizard makes no certificate" test $rc -eq 1
reset; put bad-compose 1
out=$(run img:1); rc=$?
check "exit 1 when the compose file ignores its keys" test $rc -eq 1
has "names the key" "$out" "INSTANCE_NAME does not name the container"
check "the instances are not started then" test "$(called '^compose up')" -eq 0
reset; put no-instance-volume 1
out=$(run img:1); rc=$?
check "exit 1 when an instance has no volume of its own" test $rc -eq 1
has "names the instance" "$out" "has no volume of its own"
check "both instances are taken down" test "$(called '^compose down -v')" -eq 2 -a "$(left)" -eq 0

# ── the command line ──
reset
out=$(run); rc=$?
check "exit 2 without an image" test $rc -eq 2 -a "$(called .)" -eq 0
out=$(run a b); rc=$?
check "exit 2 with two" test $rc -eq 2

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
