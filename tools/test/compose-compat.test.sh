#!/usr/bin/env bash
# Tests for tools/ci/compose-compat.sh with a stand-in baseline helper: its COMPOSE_JQ and compose_policy_ok are stubs
# that answer from a file, so no Docker is needed. The helper images of the commit under test decide whether the check
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
PIN=cloudflare/cloudflared:2026.10.4@$DIGEST
CADDY=caddy:2.11.7@$DIGEST

# a repository with the script, a baseline whose helper is the stub, and a compose file at HEAD
new_tree() { # new_tree TUNNEL_IMAGE HELPER_KNOWS_PIN(yes|no) ANSWER(pass|refuse-tunnel|refuse-other) [CADDY_IMAGE]
  T=$TMP/tree.$((++N)); mkdir -p "$T/tools/ci" "$T/scripts/lib"
  cp "$REPO/tools/ci/compose-compat.sh" "$T/tools/ci/"
  printf "#!/usr/bin/env bash\n" >"$T/scripts/ops-helper.sh"
  local rule=""; [[ $2 != yes ]] || rule=' "^cloudflare/cloudflared:[0-9]{4}" as $pin | "^caddy:2[.]" as $cpin'
  cat >"$T/scripts/lib/ops-git.sh" <<HELPER
COMPOSE_JQ='
  {"tunnel":"cloudflare/cloudflared:latest"} as \$images$rule
'
compose_policy_ok() {
  case "$3" in
    pass) return 0 ;;
    refuse-tunnel) POLICY_MSG="tunnel: image $1"; return 1 ;;
    refuse-both) POLICY_MSG="caddy: image ${4:-}${4:+;}tunnel: image $1"; return 1 ;;
    *) POLICY_MSG="caddy: image caddy:2.1.1"; return 1 ;;
  esac
}
HELPER
  (cd "$T" && git init -q && git config user.email t@example.com && git config user.name t && git config commit.gpgsign false \
    && git add -A && git commit -qm baseline && git tag baseline \
    && printf 'services:\n' >docker-compose.yml && { [[ -z ${4:-} ]] || printf '  caddy:\n    image: %s\n' "$4" >>docker-compose.yml; } \
    && printf '  tunnel:\n    image: %s\n' "$1" >>docker-compose.yml && git add -A && git commit -qm compose)
}
run() { OUT=$(cd "$T" && bash tools/ci/compose-compat.sh baseline 2>&1); RC=$?; }

new_tree "$PIN" no refuse-tunnel; run
code "an old helper that refuses the pinned tunnel image is the known refusal" "$RC" 0
has "and the message says so" "$OUT" "refuses the pinned helper images, as expected"

new_tree "$PIN" no pass; run
code "an old helper that accepts it fails the check" "$RC" 1
has "and the message says the known refusal changed" "$OUT" "The known refusal changed"

new_tree "$PIN" no refuse-other; run
code "an old helper that refuses something else fails the check" "$RC" 1
has "and the message names the refusal" "$OUT" "caddy: image caddy:2.1.1"

new_tree "$PIN" yes pass; run
code "a helper that knows the pin and passes the file is a pass" "$RC" 0
has "and says it passes" "$OUT" "passes the compose policy"

new_tree "$PIN" yes refuse-tunnel; run
code "a helper that knows the pin and refuses it fails the check" "$RC" 1

new_tree "cloudflare/cloudflared:latest" no pass; run
code "an unpinned tunnel image expects nothing special: a pass is a pass" "$RC" 0

new_tree "cloudflare/cloudflared:latest" no refuse-tunnel; run
code "an unpinned tunnel image makes no refusal known" "$RC" 1

# both helper images pinned: a helper that knows neither pin refuses both, one that knows both passes
new_tree "$PIN" no refuse-both "$CADDY"; run
code "an old helper that refuses both pins is the known refusal" "$RC" 0
has "and the message says so" "$OUT" "refuses the pinned helper images, as expected"

new_tree "$PIN" no refuse-tunnel "$CADDY"; run
code "an old helper that names only one of the two refused pins fails the check" "$RC" 1

new_tree "$PIN" yes pass "$CADDY"; run
code "a helper that knows both pins and passes the file is a pass" "$RC" 0

new_tree "$PIN" no pass "$CADDY"; run
code "an old helper that accepts both pins fails the check" "$RC" 1

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED == 0 ]]
