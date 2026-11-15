#!/usr/bin/env bash
# Tests for tools/ci/compose-compat.sh with a stand-in baseline helper: its COMPOSE_JQ and compose_policy_ok are stubs
# that answer from a file, so no Docker is needed. The helper image of the commit under test decides whether the check
# expects the known refusal of a helper that does not take a pinned image.
#
#   tools/test/compose-compat.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
has() { if [[ $2 == *"$3"* ]]; then pass "$1"; else fail "$1" "$2"; fi; }
code() { if [[ $2 == "$3" ]]; then pass "$1"; else fail "$1" "exit $2, wanted $3"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
N=0
DIGEST=sha256:$(printf '%064d' 0)
PIN=caddy:2.11.7@$DIGEST

# a repository with the script, a baseline whose helper is the stub, and a compose file at HEAD
new_tree() { # new_tree CADDY_IMAGE HELPER_KNOWS_PIN(yes|no) ANSWER(pass|refuse-pin|refuse-other)
  T=$TMP/tree.$((++N)); mkdir -p "$T/tools/ci" "$T/scripts/lib"
  cp "$REPO/tools/ci/compose-compat.sh" "$T/tools/ci/"
  printf "#!/usr/bin/env bash\n" >"$T/scripts/ops-helper.sh"
  local rule=""; [[ $2 != yes ]] || rule=' | "^caddy:2[.]" as $pin'
  cat >"$T/scripts/lib/ops-git.sh" <<HELPER
COMPOSE_JQ='
  {"caddy":"caddy:2"} as \$images$rule
'
compose_policy_ok() {
  case "$3" in
    pass) return 0 ;;
    refuse-pin) POLICY_MSG="caddy: image $1"; return 1 ;;
    *) POLICY_MSG="banking: image banking-app:2"; return 1 ;;
  esac
}
HELPER
  (cd "$T" && git init -q && git config user.email t@example.com && git config user.name t && git config commit.gpgsign false \
    && git add -A && git commit -qm baseline && git tag baseline \
    && printf 'services:\n  caddy:\n    image: %s\n' "$1" >docker-compose.yml && git add -A && git commit -qm compose)
}
run() { OUT=$(cd "$T" && bash tools/ci/compose-compat.sh baseline 2>&1); RC=$?; }

new_tree "$PIN" no refuse-pin; run
code "an old helper that refuses the pinned image is the known refusal" "$RC" 0
has "and the message says so" "$OUT" "refuses the pinned helper image, as expected"

new_tree "$PIN" no pass; run
code "an old helper that accepts it fails the check" "$RC" 1
has "and the message says the known refusal changed" "$OUT" "The known refusal changed"

new_tree "$PIN" no refuse-other; run
code "an old helper that refuses something else fails the check" "$RC" 1
has "and the message names the refusal" "$OUT" "banking: image banking-app:2"

new_tree "$PIN" yes pass; run
code "a helper that knows the pin and passes the file is a pass" "$RC" 0
has "and says it passes" "$OUT" "passes the compose policy"

new_tree "$PIN" yes refuse-pin; run
code "a helper that knows the pin and refuses it fails the check" "$RC" 1

new_tree "caddy:2" no pass; run
code "an unpinned image expects nothing special: a pass is a pass" "$RC" 0

new_tree "caddy:2" no refuse-pin; run
code "an unpinned image makes no refusal known" "$RC" 1

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED == 0 ]]
