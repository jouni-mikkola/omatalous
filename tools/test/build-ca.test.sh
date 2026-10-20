#!/usr/bin/env bash
# Tests for tools/ci/build-ca.sh, the docker of the proof (no test run in a build, and the CA of PROOF_BUILD_CA). No Docker is needed: the docker it calls is a stub that
# writes what it was given (its words, COMPOSE_FILE, the Dockerfile it read and the override file) into a folder.
#
#   tools/test/build-ca.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
has() { if [[ $2 == *"$3"* ]]; then pass "$1"; else fail "$1" "$2"; fi; }
lacks() { if [[ $2 != *"$3"* ]]; then pass "$1"; else fail "$1" "$2"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SEEN=$TMP/seen BIN=$TMP/bin
mkdir -p "$BIN" "$TMP/tmp" "$TMP/app/other"
export SEEN TMPDIR=$TMP/tmp
cat >"$BIN/docker" <<'STUB'
#!/usr/bin/env bash
rm -rf "$SEEN"; mkdir -p "$SEEN"
printf '%s\n' "$*" >"$SEEN/args"
printf '%s' "${COMPOSE_FILE-unset}" >"$SEEN/compose_file"
[[ " $* " != *" -f - "* ]] || cat >"$SEEN/stdin"
# the override, wherever it was named, and the Dockerfile it names, while they still exist
for f in ${COMPOSE_FILE//:/ } "$@"; do
  [[ $f == */build-ca.*/compose.yml ]] || continue
  cp "$f" "$SEEN/override"
  cp "$(sed -n 's/^      dockerfile: //p' "$f")" "$SEEN/dockerfile"
done
exit 0
STUB
chmod +x "$BIN/docker"
echo 'the proxy CA' >"$TMP/ca.crt"
printf '%s\n' '# syntax=docker/dockerfile:1' 'FROM --platform=$BUILDPLATFORM node:22 AS build' 'RUN pnpm install' 'FROM node:22' 'COPY --from=build /app /app' >"$TMP/app/Dockerfile"
printf '%s\n' 'FROM node:22 AS build' 'FROM node:22' >"$TMP/app/other/Dockerfile.x"
printf '%s\n' 'FROM node:22' 'RUN true' >"$TMP/flat.Dockerfile"
mkdir -p "$TMP/flat" && cp "$TMP/flat.Dockerfile" "$TMP/flat/Dockerfile"

# ── setup ──
D=$(PATH=$BIN:$PATH PROOF_BUILD_CA=$TMP/ca.crt "$REPO/tools/ci/build-ca.sh" setup "$TMP/work"); rc=$?
check "setup ends 0" test $rc -eq 0
check "setup prints the folder it made" test "$D" = "$TMP/work/build-ca"
check "the CA is copied, readable by the users of the legs" test "$(stat -c %a "$D/build-ca.crt")" = 644
check "the docker of the folder is this script, for every user" test "$(stat -c %a "$D/docker")" = 755
check "it calls the docker that was first in PATH" test "$(cat "$D/real")" = "$BIN/docker"
out=$(PROOF_BUILD_CA=$TMP/none "$REPO/tools/ci/build-ca.sh" setup "$TMP/w2" 2>&1); rc=$?
check "setup refuses a CA that is not a file (exit 2)" test $rc -eq 2
has "and names it" "$out" "PROOF_BUILD_CA names no file that can be read: $TMP/none"
N=$(PATH=$BIN:$PATH env -u PROOF_BUILD_CA "$REPO/tools/ci/build-ca.sh" setup "$TMP/w3"); rc=$?
check "setup with no PROOF_BUILD_CA makes the docker of the proof all the same" test $rc -eq 0 -a -x "$N/docker"
check "and copies no CA" test ! -e "$N/build-ca.crt"

# ── docker build ──
(cd "$TMP/app" && "$D/docker" build -q -t banking-app:ci .); rc=$?
check "a build ends with the status of docker" test $rc -eq 0
args=$(cat "$SEEN/args")
check "the build reads the Dockerfile from stdin, with the CA folder as the context ca" \
  test "${args%%ca=*}" = "build -q -t banking-app:ci -f - --build-context "
check "the context is the folder the caller named" test "${args##* }" = "."
want=$(printf '%s\n' '# syntax=docker/dockerfile:1' 'FROM --platform=$BUILDPLATFORM node:22 AS build' 'COPY --from=ca build-ca.crt /etc/ssl/build-ca.crt' 'ENV NODE_EXTRA_CA_CERTS=/etc/ssl/build-ca.crt' 'RUN pnpm install' 'FROM node:22' 'COPY --from=build /app /app')
check "the CA comes right after the line of the build stage, and only there" test "$(cat "$SEEN/stdin")" = "$want"
check "the final stage has no line of the CA" test "$(sed -n '/^FROM node:22$/,$p' "$SEEN/stdin" | grep -c build-ca)" = 0
check "the Dockerfile in the context is left as it was" test "$(grep -c build-ca "$TMP/app/Dockerfile")" = 0
check "the folder of the CA is removed when docker ends" test -z "$(ls "$TMPDIR")"

(cd "$TMP/app" && "$D/docker" build -f other/Dockerfile.x -t x .)
args=$(cat "$SEEN/args")
lacks "-f FILE: the file's name does not reach docker" "$args" "Dockerfile.x"
check "-f FILE: that file is the one patched" test "$(sed -n 2p "$SEEN/stdin")" = "COPY --from=ca build-ca.crt /etc/ssl/build-ca.crt"
(cd "$TMP/app" && "$D/docker" build --file=other/Dockerfile.x -t x .)
check "--file=FILE too" test "$(sed -n 3p "$SEEN/stdin")" = "ENV NODE_EXTRA_CA_CERTS=/etc/ssl/build-ca.crt"

echo 'FROM scratch' | (cd "$TMP/app" && "$D/docker" build -q -t stand-in -)
check "a build whose Dockerfile is the caller's stdin is docker's own" test "$(cat "$SEEN/args")" = "build -q -t stand-in -"
(cd "$TMP/app" && "$D/docker" build -f - -t y . </dev/null)
check "so is one with -f -" test "$(cat "$SEEN/args")" = "build -f - -t y ."
out=$(cd "$TMP/flat" && "$D/docker" build -t z . 2>&1); rc=$?
check "a Dockerfile with no build stage is refused" test $rc -eq 1
has "and the refusal says why" "$out" "PROOF_BUILD_CA: ./Dockerfile has no 'FROM ... AS build' stage, so the CA cannot reach its build."

# ── docker compose ──
(cd "$TMP/app" && COMPOSE_FILE=docker-compose.yml "$D/docker" compose build --build-arg PRIVATE_BUILD=false banking)
check "compose build: the words are the caller's" test "$(cat "$SEEN/args")" = "compose build --build-arg PRIVATE_BUILD=false banking"
cf=$(cat "$SEEN/compose_file")
check "and an override follows the project's own file" test "${cf%%:*}" = docker-compose.yml
ov=$(cat "$SEEN/override")
has "the override builds banking from the project's folder" "$ov" $'  banking:\n    build:\n      context: '"$TMP/app"$'\n'
has "with the CA folder as the context ca" "$ov" "        ca: $TMPDIR/build-ca."
check "and a copy of the project's Dockerfile with the CA in its build stage" test "$(cat "$SEEN/dockerfile")" = "$want"
check "the folder of the override is removed when docker ends" test -z "$(ls "$TMPDIR")"
(cd "$TMP/app" && env -u COMPOSE_FILE "$D/docker" compose up -d --build)
check "no COMPOSE_FILE: the project's docker-compose.yml, then the override" test "$(cut -d: -f1 "$SEEN/compose_file")" = docker-compose.yml
(cd "$TMP/app" && "$D/docker" compose -f docker-compose.yml --env-file /dev/null run --rm banking true)
args=$(cat "$SEEN/args")
check "compose -f FILE run: the override is a -f right after the caller's" \
  test "${args%%build-ca.*}" = "compose -f docker-compose.yml -f $TMPDIR/"
has "and the rest follows as it was" "$args" "/compose.yml --env-file /dev/null run --rm banking true"
(cd / && "$D/docker" compose --project-directory "$TMP/app" -p proof-1 create)
has "--project-directory names the folder whose Dockerfile is built" "$(cat "$SEEN/override")" "context: $TMP/app"
for w in "config --images" "ps -q banking" "exec -T banking ls" "down -v"; do
  # shellcheck disable=SC2086 # the words of the command
  (cd "$TMP/app" && COMPOSE_FILE=docker-compose.yml "$D/docker" compose $w)
  check "compose $w is docker's own" test "$(cat "$SEEN/args")|$(cat "$SEEN/compose_file")" = "compose $w|docker-compose.yml"
done
(cd "$TMP" && env -u COMPOSE_FILE "$D/docker" compose build)
check "a folder with no Dockerfile builds as docker would" test "$(cat "$SEEN/compose_file")" = unset
out=$(cd "$TMP/flat" && "$D/docker" compose up -d 2>&1); rc=$?
check "compose: a Dockerfile with no build stage is refused" test $rc -eq 1
has "and the refusal names it" "$out" "$TMP/flat/Dockerfile has no 'FROM ... AS build' stage"

# ── no test run in a build ──
OLD=$TMP/old NEW=$TMP/new ODD=$TMP/odd
mkdir -p "$OLD" "$NEW" "$ODD"
# the three forms of the baselines: before 0.4.0, 0.4.0 to 0.8.1, and from 0.8.2 (the one under proof too)
printf '%s\n' '# ── build: install, test, bundle' 'FROM node:22-alpine AS build' 'RUN pnpm install --frozen-lockfile' 'COPY . .' 'RUN pnpm test && pnpm build' 'FROM node:22-alpine' >"$OLD/Dockerfile"
for r in 812b219 da9d66e HEAD; do git -C "$REPO" show "$r:Dockerfile" >"$NEW/Dockerfile.$r"; done
printf '%s\n' 'FROM node:22 AS build' 'RUN pnpm test:server && pnpm build' 'FROM node:22' >"$ODD/Dockerfile"
(cd "$OLD" && "$N/docker" build -t old .)
check "no CA, a build that ran the tests: the Dockerfile on stdin, with no context ca" test "$(cat "$SEEN/args")" = "build -t old -f - ."
check "and its test run is gone, the build kept" test "$(sed -n 5p "$SEEN/stdin")" = "RUN pnpm build"
check "and nothing else changed" test "$(grep -vc '^RUN pnpm build$' "$SEEN/stdin")" = 5
check "the Dockerfile in the context is left as it was" test "$(grep -c 'pnpm test' "$OLD/Dockerfile")" = 1
for r in 812b219 da9d66e HEAD; do
  (cd "$NEW" && "$N/docker" build -f "Dockerfile.$r" -t new . 2>"$TMP/err")
  check "no CA, the Dockerfile of $r (tests only with RUN_TESTS=true) is docker's own" test "$(cat "$SEEN/args")" = "build -f Dockerfile.$r -t new ."
  check "and says nothing" test ! -s "$TMP/err"
  (cd "$NEW" && "$D/docker" build -f "Dockerfile.$r" -t new .)
  check "with the CA, the Dockerfile of $r keeps its RUN_TESTS line" test "$(grep -c 'RUN_TESTS' "$SEEN/stdin")" = "$(grep -c 'RUN_TESTS' "$NEW/Dockerfile.$r")"
done
(cd "$OLD" && "$D/docker" build -t old .)
check "with the CA, a build that ran the tests gets both" \
  test "$(sed -n '3p;7p' "$SEEN/stdin" | tr '\n' '|')" = "COPY --from=ca build-ca.crt /etc/ssl/build-ca.crt|RUN pnpm build|"
out=$(cd "$ODD" && "$N/docker" build -t odd . 2>&1)
check "a test run of another form builds as it is" test "$(cat "$SEEN/args")" = "build -t odd ."
has "and one line says so" "$out" "proof docker: ./Dockerfile runs pnpm test in a form this docker does not rewrite, so its build runs the tests"
(cd "$TMP/flat" && "$N/docker" build -t z .); rc=$?
check "no CA: a Dockerfile with no build stage is docker's own" test $rc -eq 0 -a "$(cat "$SEEN/args")" = "build -t z ."
(cd "$OLD" && COMPOSE_FILE=docker-compose.yml "$N/docker" compose up -d --build)
ov=$(cat "$SEEN/override")
lacks "compose, no CA: the override has no context ca" "$ov" "additional_contexts"
check "and its Dockerfile runs the build alone" test "$(sed -n 5p "$SEEN/dockerfile")" = "RUN pnpm build"
(cd "$NEW" && cp Dockerfile.HEAD Dockerfile && COMPOSE_FILE=docker-compose.yml "$N/docker" compose up -d --build)
check "compose, no CA, the Dockerfile under proof: docker's own" test "$(cat "$SEEN/compose_file")" = docker-compose.yml

# ── the rest ──
"$D/docker" run --rm -i --network none node:22 node -e 1
check "any other command is docker's own" test "$(cat "$SEEN/args")" = "run --rm -i --network none node:22 node -e 1"

echo
echo "build-ca: $PASS passed, $FAILED failed"
((FAILED == 0))
