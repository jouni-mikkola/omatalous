#!/usr/bin/env bash
# Tests for tools/ci/smoke-image.sh with a stub `docker`: the stub records every call and plays a healthy image, and a
# file in its folder changes one answer (labels, cli-version, applied, unhealthy and so on). The script runs in a copy
# of the tree that holds only what it reads, so the version in the real tree does not matter. No Docker is needed.
#
#   tools/test/smoke-image.test.sh
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
SHA=0123456789abcdef0123456789abcdef01234567
mkdir -p "$TREE/tools/ci" "$TREE/apps/server/src" "$TREE/apps/server/test/fixtures/db" "$STUB"
cp "$REPO/tools/ci/smoke-image.sh" "$TREE/tools/ci/"
printf 'x-talous-compat: 7\nservices: {}\n' >"$TREE/docker-compose.yml"
printf 'export const APP_VERSION = "1.2.3";\n' >"$TREE/apps/server/src/version.ts"
printf 'CREATE TABLE old (id TEXT);\n' >"$TREE/apps/server/test/fixtures/db/0.5.0.sql"

cat >"$STUB/docker" <<'STUB_DOCKER'
#!/usr/bin/env bash
# the stub: one line per call in `calls`, and the answer of a healthy image unless a file here says otherwise
dir=$(dirname "$0")
all=$*
printf '%s\n' "${all//$'\n'/ }" >>"$dir/calls"
val() { if [[ -e $dir/$1 ]]; then cat "$dir/$1"; else printf '%s\n' "$2"; fi; }
report() { printf '{"ok":%s,"file":"/data/banking.db","elapsed_ms":9,"migrate_ms":3,"from":8,"to":15,"applied":[%s],"ahead":[],"problems":[]}\n' "$1" "$2"; }
case $1 in
  image) [[ ! -e $dir/no-image ]] || { echo "Error: No such image" >&2; exit 1; }; val labels 'unknown|unknown|7|linux/amd64' ;;
  version) val host linux/amd64 ;;
  volume)
    if [[ $2 == create ]]; then touch "$dir/volumes/$3"; echo "$3"; else rm -f "$dir/volumes/${!#}"; fi ;;
  run)
    name= detached=0 prev=
    for a in "$@"; do [[ $prev == --name ]] && name=$a; [[ $a == -d ]] && detached=1; prev=$a; done
    if ((detached)); then
      touch "$dir/containers/$name"; echo 0123abcd
    elif [[ $all == *" migrate-check "* ]]; then
      echo "migrate-check: the line for people" >&2
      val check-before "$(report true '"0009_more.sql"')"
      exit "$(val check-before-rc 0)"
    else
      cat >"$dir/seed-stdin"
    fi ;;
  exec)
    c=$2
    case $all in
      *"/api/health")
        n=$(($(cat "$dir/tries-$c" 2>/dev/null || echo 0) + 1)); echo "$n" >"$dir/tries-$c"
        ((n >= $(val healthy-after 1))) || exit 1
        echo '{"ok":true}' ;;
      *"/api/auth/state") if [[ $c == *-new ]]; then val state-new '{"needsSetup":true,"user":null}'; else val state-old '{"needsSetup":false,"user":null}'; fi ;;
      *"dist/node.js version") val cli-version "1.2.3 (1.2.3+0123456789abcdef)" ;;
      *"ls migrations") val files $'0001_init.sql\n0009_more.sql' ;;
      *" migrate-check "*) val check-after "$(report true '')" ;;
      *) val applied $'0001_init.sql\n0009_more.sql' ;;
    esac ;;
  inspect)
    [[ -e $dir/containers/${!#} ]] || exit 1
    [[ $2 != -f ]] || val running true ;;
  logs) echo "log line of ${!#}" ;;
  rm) rm -f "$dir/containers/${!#}" ;;
esac
STUB_DOCKER
chmod +x "$STUB/docker"

reset() {
  find "$STUB" -mindepth 1 ! -name docker -delete
  mkdir -p "$STUB/containers" "$STUB/volumes"
  : >"$STUB/calls"
  put labels "1.2.3|$SHA|7|linux/amd64"
}
put() { printf '%s\n' "$2" >"$STUB/$1"; }
smoke() { PATH="$STUB:$PATH" SMOKE_POLL=0 bash "$TREE/tools/ci/smoke-image.sh" "$@" 2>&1; }
left() { find "$STUB/containers" "$STUB/volumes" -type f | wc -l; }
called() { grep -c -- "$1" "$STUB/calls"; }
# the calls as one word each, in order. `inspect` is left out: it is asked only while waiting and before a log is shown.
steps() {
  local line who words=()
  while IFS= read -r line; do
    who=${line#* }; who=${who%% *}; who=${who##*-}
    case $line in
      "image inspect "*) words+=(labels) ;;
      "version "*) words+=(host) ;;
      "volume create "*) words+=("volume:${line##*-}") ;;
      "volume rm "*) words+=("volume-rm:${line##*-}") ;;
      "run -d "*) if [[ $line == *"-new:/data"* ]]; then words+=(start:new); else words+=(start:old); fi ;;
      "run "*" migrate-check "*) words+=(check-before) ;;
      "run "*) words+=(seed) ;;
      "exec "*"/api/health") words+=("health:$who") ;;
      "exec "*"/api/auth/state") words+=("state:$who") ;;
      "exec "*"dist/node.js version") words+=("version:$who") ;;
      "exec "*"ls migrations") words+=("files:$who") ;;
      "exec "*" migrate-check "*) words+=("check-after:$who") ;;
      "exec "*) words+=("applied:$who") ;;
      "logs "*) words+=("logs:${line##*-}") ;;
      "rm "*) words+=("rm:${line##*-}") ;;
    esac
  done <"$STUB/calls"
  echo "${words[*]}"
}
CLEANUP="rm:new rm:old rm:seed rm:check volume-rm:new volume-rm:old"

check "the old database the script reads is in the tree" test -r "$REPO/apps/server/test/fixtures/db/0.5.0.sql"

# ── a healthy image ──
reset
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 0 on a healthy image" test $rc -eq 0
has "says so at the end" "$out" "smoke ok: img:1"
want="labels host volume:new start:new health:new state:new version:new volume:old seed check-before start:old health:old state:old files:old applied:old check-after:old $CLEANUP"
got=$(steps)
[[ $got == "$want" ]] && pass "the steps run in order: labels, a new install, an old install, then everything is removed" || fail "the steps run in order" "$got"
starts=$(grep '^run -d ' "$STUB/calls")
for flag in "--read-only" "--tmpfs /tmp:noexec,nosuid,nodev" "--cap-drop ALL" "--security-opt no-new-privileges:true" "--network none"; do
  [[ $(grep -c -- "$flag" <<<"$starts") == 2 ]] && pass "both starts carry $flag" || fail "both starts carry $flag" "$starts"
done
[[ $(grep -c -- '-v smoke-[0-9]*-[0-9]*-\(new\|old\):/data ' <<<"$starts") == 2 ]] && pass "each start has a scratch volume of its own behind /data" || fail "each start has a scratch volume of its own behind /data" "$starts"
check "no start publishes a port" test "$(grep -c -- ' -p \| --publish ' <<<"$starts")" -eq 0
check "the fixture went into the image on stdin" cmp -s "$STUB/seed-stdin" "$TREE/apps/server/test/fixtures/db/0.5.0.sql"
has "the database is built with node:sqlite inside the image" "$(grep '^run --rm -i ' "$STUB/calls")" 'require("node:sqlite")'
has "the first migrate-check runs in a container of its own on the old volume" "$(grep '^run .* migrate-check ' "$STUB/calls")" "-old:/data --entrypoint node img:1"
check "no container and no volume is left" test "$(left)" -eq 0
check "a pass shows no container log" test "$(called '^logs ')" -eq 0

# ── slow starts ──
reset; put healthy-after 3
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "it asks /api/health again until it answers" test $rc -eq 0 -a "$(called 'new .*/api/health$')" -eq 3
reset; put healthy-after 99
out=$(SMOKE_HEALTH_WAIT=0 smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 when /api/health does not answer in time" test $rc -eq 1
has "names the wait" "$out" "/api/health did not answer within 0 s"
has "shows the log of the container that failed" "$out" "log line of smoke-"
got=$(steps)
[[ $got == "labels host volume:new start:new health:new logs:new $CLEANUP" ]] && pass "cleanup after a failure: the log first, then every container and volume" || fail "cleanup after a failure" "$got"
check "nothing is left after a failure" test "$(left)" -eq 0
reset; put healthy-after 99; put running false
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "a container that stopped fails at once, without the wait" test $rc -eq 1 -a "$(called '/api/health$')" -eq 1
has "says that it stopped" "$out" "stopped before /api/health answered"

# ── version, labels, processor ──
reset; put cli-version "1.2.2 (1.2.2+0123456789abcdef)"
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 when \`version\` prints another version" test $rc -eq 1
has "names both versions" "$out" "prints 1.2.2 (1.2.2+0123456789abcdef), not 1.2.3"
check "the old install is not tried after that" test "$(called '^volume create .*-old$')" -eq 0
check "and nothing is left" test "$(left)" -eq 0
reset; put labels "1.2.2|$SHA|7|linux/amd64"
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 on a version label that differs, before anything starts" test $rc -eq 1 -a "$(called '^run ')" -eq 0
has "names the label" "$out" "talous.version says 1.2.2, not 1.2.3"
reset; put labels "1.2.3|unknown|7|linux/amd64"
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 on a commit label that differs" test $rc -eq 1 -a "$(called '^run ')" -eq 0
reset; put labels "1.2.3|$SHA|6|linux/amd64"
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 on a layout label that docker-compose.yml does not have" test $rc -eq 1 -a "$(called '^run ')" -eq 0
has "names both layouts" "$out" "talous.compose says 6, docker-compose.yml has layout 7"
reset; put labels "1.2.3|$SHA|7|linux/arm64"
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 on an image built for another processor" test $rc -eq 1 -a "$(called '^run ')" -eq 0
has "names both processors" "$out" "built for linux/arm64 and this machine is linux/amd64"
reset; put no-image 1
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 when the image is not on the machine" test $rc -eq 1
reset; put labels "unknown|unknown|7|linux/amd64"
out=$(smoke img:ci unknown unknown); rc=$?
check "an image built without build arguments passes as unknown unknown" test $rc -eq 0
reset; put labels "unknown|unknown|7|linux/amd64"; put cli-version "1.2.2 (1.2.2+0123456789abcdef)"
out=$(smoke img:ci unknown unknown); rc=$?
check "and \`version\` must then print the version of the tree" test $rc -eq 1
has "names the tree's version" "$out" "not 1.2.3"

# ── the old database ──
reset; put applied "0001_init.sql"
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 when a migration file is missing in _migrations" test $rc -eq 1
has "names the missing file" "$out" "_migrations lacks 0009_more.sql"
has "shows the logs of both installs" "$(steps)" "logs:new logs:old $CLEANUP"
check "and nothing is left" test "$(left)" -eq 0
reset; put files "README"
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 when the image holds no migration files" test $rc -eq 1
reset; put check-before '{"ok":false,"file":"/data/banking.db","applied":[],"problems":["0009_more.sql: no such table"]}'; put check-before-rc 1
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 when migrate-check refuses the old database" test $rc -eq 1
has "shows the report" "$out" "no such table"
check "the image is not started on a database it refuses" test "$(called '^run -d .*-old:/data')" -eq 0
check "the log is shown once and the cleanup runs once" test "$(called '^logs ')" -eq 1 -a "$(called '^volume rm ')" -eq 2
check "and nothing is left" test "$(left)" -eq 0
reset; put check-before '{"ok":true,"file":"/data/banking.db","applied":[],"problems":[]}'
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 when the old database had nothing to migrate: the check would prove nothing" test $rc -eq 1
reset; put check-after '{"ok":true,"file":"/data/banking.db","applied":["0009_more.sql"],"problems":[]}'
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 when migrations are left to apply after the start" test $rc -eq 1
reset; put state-old '{"needsSetup":true,"user":null}'
out=$(smoke img:1 1.2.3 "$SHA"); rc=$?
check "exit 1 when the old install asks for a first user" test $rc -eq 1
has "says what that means" "$out" "the users of the old database are gone"

# ── the command line ──
reset
out=$(smoke img:1 1.2.3); rc=$?
check "exit 2 without a commit" test $rc -eq 2 -a "$(called .)" -eq 0
out=$(smoke img:1 v1.2.3 "$SHA"); rc=$?
check "exit 2 on a version that is not X.Y.Z or unknown" test $rc -eq 2 -a "$(called .)" -eq 0
out=$(smoke img:1 1.2.3 0123abc); rc=$?
check "exit 2 on a short commit" test $rc -eq 2 -a "$(called .)" -eq 0

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
