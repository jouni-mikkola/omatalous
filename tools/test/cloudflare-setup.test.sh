#!/usr/bin/env bash
# Tests for scripts/cloudflare-setup.sh, the command that writes ~/.config/omatalous/cloudflare.env. curl is a stub that
# answers like the Cloudflare API from files, so nothing leaves the machine. Every scenario has its own HOME.
#
#   tools/test/cloudflare-setup.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
FILTER=${1:-}
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

TMPBASE=$(mktemp -d)
trap 'rm -rf "$TMPBASE"' EXIT
ORIG_PATH=$PATH
UM=$(umask)
# made-up tokens: the stub accepts goodtoken*, refuses the rest, and zonedeny* verifies but may not list zones
GOOD=goodtoken_aB3dE5gH7jK9mN1pQ3sT5vX7zA9cF2hJ4lO6
NEW=goodtoken_zY8xW6vU4tS2rQ0pO8nM6lK4jI2hG0fE8dC6
BAD=badtoken_Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz1Xc3Vb5
DENY=zonedeny_Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz1Xc3Vb5

mkdir -p "$TMPBASE/bin"
cat >"$TMPBASE/bin/curl" <<'STUB'
#!/usr/bin/env bash
# stands in for curl: logs the command line, takes the Authorization header from the -H @file the script gives it,
# and answers like api.cloudflare.com from $STUB_DIR
printf '%s\n' "$*" >>"$STUB_DIR/argv"
printf '%s\n' "${CLOUDFLARE_API_TOKEN:-none}" >>"$STUB_DIR/env"
hdr=""; url=""
while (($#)); do
  case $1 in
    -H) shift; [[ $1 == @* ]] && hdr=$(cat "${1#@}") ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
token=${hdr#Authorization: Bearer }
case $url in
  https://api.cloudflare.com/client/v4/*) ;;
  *) echo "stub curl: unexpected URL $url" >&2; exit 22 ;;
esac
path=${url#https://api.cloudflare.com/client/v4}
printf '%s %s\n' "$path" "$token" >>"$STUB_DIR/calls"
if [[ -e $STUB_DIR/down ]]; then echo "curl: (6) Could not resolve host: api.cloudflare.com" >&2; exit 6; fi
invalid='{"success":false,"errors":[{"code":1000,"message":"Invalid API Token"}],"messages":[],"result":null}'
case $path in
  /user/tokens/verify)
    case $token in
      goodtoken*|zonedeny*) echo '{"success":true,"errors":[],"messages":[],"result":{"id":"0123456789abcdef0123456789abcdef","status":"active"}}' ;;
      *) echo "$invalid" ;;
    esac ;;
  /zones\?*)
    case $token in
      goodtoken*) cat "$STUB_DIR/zones-${path##*page=}.json" ;;
      zonedeny*) echo '{"success":false,"errors":[{"code":9109,"message":"Unauthorized to access requested resource"}],"messages":[],"result":null}' ;;
      *) echo "$invalid" ;;
    esac ;;
  *) echo "stub curl: unexpected path $path" >&2; exit 22 ;;
esac
STUB
chmod +x "$TMPBASE/bin/curl"

# zones_page PAGE TOTAL NAME...: what the stub answers to the zone list for that page
zones_page() {
  local page=$1 total=$2; shift 2
  jq -nc --argjson page "$page" --argjson total "$total" \
    '{success: true, errors: [], messages: [], result: [$ARGS.positional[] | {id: "0123456789abcdef0123456789abcdef", name: ., status: "active", account: {id: "fedcba9876543210fedcba9876543210", name: "Made up"}}], result_info: {page: $page, total_pages: $total}}' \
    --args "$@" >"$STUB_DIR/zones-$page.json"
}
new_env() {
  W=$(mktemp -d -p "$TMPBASE"); mkdir -p "$W/home" "$W/stub"
  export HOME=$W/home STUB_DIR=$W/stub
  PATH=$TMPBASE/bin:$ORIG_PATH; export PATH
  CF=$HOME/.config/omatalous/cloudflare.env
  zones_page 1 1 example.fi
}
# run ARGS: the script with the stdin the caller gives, its output in $W/out, its exit code in $RC
run() { bash "$SRC/scripts/cloudflare-setup.sh" "$@" >"$W/out" 2>&1; RC=$?; }
out() { cat "$W/out"; }
mode() { stat -c %a "$1"; }
has_line() { grep -qxF "$1" "$CF"; }
never_shown() { # the token is in neither the output, nor the stub's command lines, nor its environment
  local t
  for t in "$@"; do
    grep -qF "$t" "$W/out" && return 1
    grep -qF "$t" "$STUB_DIR/argv" 2>/dev/null && return 1
    grep -qF "$t" "$STUB_DIR/env" 2>/dev/null && return 1
  done
  return 0
}
calls() { grep -c "^$1 " "$STUB_DIR/calls" 2>/dev/null || true; }

t_curl_is_the_stub() {
  new_env
  check "curl resolves to the stub, so no request leaves the machine" test "$(command -v curl)" = "$TMPBASE/bin/curl"
}
t_one_zone() {
  new_env
  umask 000
  run <<<"$GOOD"$'\n'"Anna@example.fi, ville@example.fi,anna@EXAMPLE.fi,"
  umask "$UM"
  check "the only zone: the script succeeds" test "$RC" = 0
  check "the file has mode 600 although the umask said 000" test "$(mode "$CF")" = 600
  check "the directory it created is private" test "$(mode "$HOME/.config/omatalous")" = 700
  check "the token, the emails (trimmed, no repeats) and the zone are in it" bash -c "$(declare -f has_line); CF='$CF'; has_line 'CLOUDFLARE_API_TOKEN=$GOOD' && has_line 'CLOUDFLARE_ACCESS_EMAILS=Anna@example.fi,ville@example.fi' && has_line 'CLOUDFLARE_BASE_DOMAIN=example.fi'"
  check "the zone is taken without a question" bash -c "! grep -q 'Base domain' '$W/out'"
  check "nothing but the file is left in the directory" test "$(ls -A "$HOME/.config/omatalous")" = cloudflare.env
  check "the token is not in the output, the command lines or the environment of curl" never_shown "$GOOD"
  check "curl got the token as a header from a file (-H @file)" grep -q -- '-H @' "$STUB_DIR/argv"
  check "Cloudflare saw the token on the verify call and on the zone list" bash -c "grep -qF '/user/tokens/verify $GOOD' '$STUB_DIR/calls' && grep -qF '/zones?per_page=50&page=1 $GOOD' '$STUB_DIR/calls'"
}
t_several_zones() {
  new_env; zones_page 1 1 example.fi example.org example.net
  run <<<"$GOOD"$'\n2\nme@example.fi'
  check "several zones: the number picks the second" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_BASE_DOMAIN=example.org'"
  check "all three are listed" bash -c "grep -q '1) example.fi' '$W/out' && grep -q '2) example.org' '$W/out' && grep -q '3) example.net' '$W/out'"
  new_env; zones_page 1 1 example.fi example.org example.net
  run <<<"$GOOD"$'\nEXAMPLE.NET\nme@example.fi'
  check "the name picks a zone, in any case" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_BASE_DOMAIN=example.net'"
  new_env; zones_page 1 1 example.fi example.org
  run <<<"$GOOD"$'\n9\nexample.invalid\n1\nme@example.fi'
  check "an answer that is not a zone is asked again" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_BASE_DOMAIN=example.fi' && grep -q 'not one of the zones' '$W/out'"
  new_env; zones_page 1 2 example.fi; zones_page 2 2 example.org
  run <<<"$GOOD"$'\nexample.org\nme@example.fi'
  check "zones on a second page are listed too" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_BASE_DOMAIN=example.org'"
  new_env; zones_page 1 1 example.fi example.org
  export CLOUDFLARE_API_TOKEN=$GOOD
  run --yes --domain Example.Org --emails me@example.fi </dev/null
  unset CLOUDFLARE_API_TOKEN
  check "--domain picks one without a question" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_BASE_DOMAIN=example.org'"
}
t_bad_token() {
  new_env
  run <<<"$BAD"$'\n'"$BAD"$'\n'"$BAD"
  check "a bad token three times: refused, exit 1" test "$RC" = 1
  check "Cloudflare's reason is shown" bash -c "grep -q 'did not accept the token: Invalid API Token' '$W/out'"
  check "no file is written" test ! -e "$CF"
  check "the zones are never asked for with a refused token" test "$(calls '/zones?per_page=50&page=1')" = 0
  check "the refused token is not in the output" never_shown "$BAD"
  new_env
  run <<<"$BAD"$'\n'"$GOOD"$'\nme@example.fi'
  check "a bad token, then a good one: the good one is saved" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_API_TOKEN=$GOOD' && ! grep -qF '$BAD' '$CF'"
  new_env; mkdir -p "$HOME/.config/omatalous"
  printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ACCESS_EMAILS=me@example.fi\nCLOUDFLARE_BASE_DOMAIN=example.fi\n' "$GOOD" >"$CF"; cp "$CF" "$W/before"
  run <<<"$BAD"$'\n'"$BAD"$'\n'"$BAD"
  check "a refused run leaves the saved file as it was" cmp -s "$CF" "$W/before"
  new_env
  run <<<$'bad token!\nalso bad!\n'"$GOOD"$'\nme@example.fi'
  check "a token with spaces or marks is refused before Cloudflare is asked" bash -c "[[ $RC = 0 ]] && grep -q 'does not look like an API token' '$W/out' && [[ \$(grep -c . '$STUB_DIR/calls') = 2 ]]"
  new_env; touch "$STUB_DIR/down"
  run <<<"$GOOD"$'\n'"$GOOD"
  check "no network: one try, a plain message, no file" bash -c "[[ $RC = 1 && ! -e '$CF' ]] && grep -q 'Could not reach Cloudflare' '$W/out' && [[ \$(grep -c . '$STUB_DIR/calls') = 1 ]]"
}
t_zones_refused() {
  new_env
  run <<<"$DENY"
  check "a token that may not list zones: refused, and the message names the permission" bash -c "[[ $RC = 1 && ! -e '$CF' ]] && grep -q 'Zone: Zone Read' '$W/out'"
  new_env; zones_page 1 1
  run <<<"$GOOD"
  check "a token with no active zone: refused, no file" bash -c "[[ $RC = 1 && ! -e '$CF' ]] && grep -q 'no active zone' '$W/out'"
}
t_second_run_keeps() {
  new_env
  run <<<"$GOOD"$'\nAnna@example.fi,ville@example.fi'
  cp "$CF" "$W/first"; first_inode=$(stat -c %i "$CF")
  chmod 644 "$CF"
  run <<<$'\n\n'
  check "a second run with Enter everywhere: the file is the same" bash -c "[[ $RC = 0 ]] && cmp -s '$CF' '$W/first' && grep -q 'Nothing changed' '$W/out'"
  check "it shows the saved emails as the default" grep -qF '[Anna@example.fi,ville@example.fi]' "$W/out"
  check "it offers to keep the token and does not print it" bash -c "grep -q 'Enter keeps the saved one' '$W/out'"
  check "the saved token was checked with Cloudflare again" test "$(calls /user/tokens/verify)" = 2
  check "the file is back to mode 600" test "$(mode "$CF")" = 600
  check "the saved token is not in the output" never_shown "$GOOD"
  run <<<"$NEW"$'\nville@example.fi'
  check "a new token and one email replace the old values" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_API_TOKEN=$NEW' && has_line 'CLOUDFLARE_ACCESS_EMAILS=ville@example.fi' && has_line 'CLOUDFLARE_BASE_DOMAIN=example.fi' && ! grep -qF '$GOOD' '$CF'"
  check "the file keeps mode 600 and is replaced as a whole" test "$(mode "$CF")" = 600 -a "$(stat -c %i "$CF")" != "$first_inode"
  check "neither token is in the output" never_shown "$GOOD" "$NEW"
  # the saved token stops working: the offer to keep it is not repeated
  printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ACCESS_EMAILS=ville@example.fi\nCLOUDFLARE_BASE_DOMAIN=example.fi\n' "$BAD" >"$CF"
  run <<<$'\n'"$GOOD"$'\n'
  check "a saved token that no longer works: refused, asked for a new one, emails kept" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_API_TOKEN=$GOOD' && has_line 'CLOUDFLARE_ACCESS_EMAILS=ville@example.fi' && [[ \$(grep -c 'Enter keeps' '$W/out') = 1 ]]"
  # several zones: the saved one is the default
  zones_page 1 1 example.fi example.org
  printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ACCESS_EMAILS=ville@example.fi\nCLOUDFLARE_BASE_DOMAIN=example.org\n' "$GOOD" >"$CF"
  run <<<$'\n\n\n'
  check "several zones: the saved domain is the default" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_BASE_DOMAIN=example.org' && grep -qF '[example.org]' '$W/out'"
}
t_scripted() {
  new_env
  export CLOUDFLARE_API_TOKEN=$GOOD
  run --yes --emails me@example.fi </dev/null
  unset CLOUDFLARE_API_TOKEN
  check "a scripted run takes the token from the environment and writes the file" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_API_TOKEN=$GOOD' && has_line 'CLOUDFLARE_ACCESS_EMAILS=me@example.fi' && [[ \$(stat -c %a '$CF') = 600 ]]"
  check "it asks nothing" bash -c "! grep -q 'API token:' '$W/out'"
  check "curl did not inherit the token's variable" bash -c "! grep -qv '^none\$' '$STUB_DIR/env'"
  check "the token is not in the output or the command lines" never_shown "$GOOD"
  export CLOUDFLARE_API_TOKEN=$BAD
  run --yes --emails me@example.fi </dev/null
  unset CLOUDFLARE_API_TOKEN
  check "a refused token in the environment fails at once, the file stays" bash -c "[[ $RC = 1 ]] && grep -q 'did not accept' '$W/out' && grep -qF 'CLOUDFLARE_API_TOKEN=$GOOD' '$CF'"
  new_env
  run --yes </dev/null
  check "--yes with nothing saved and no token: refused" bash -c "[[ $RC = 1 && ! -e '$CF' ]] && grep -q 'No token' '$W/out'"
  new_env
  export CLOUDFLARE_API_TOKEN=$GOOD
  run --yes --emails me@example.fi </dev/null
  unset CLOUDFLARE_API_TOKEN
  cp "$CF" "$W/before"
  run --yes </dev/null
  check "--yes on a saved file keeps every value" bash -c "[[ $RC = 0 ]] && cmp -s '$CF' '$W/before' && grep -q 'Nothing changed' '$W/out'"
}
t_input_checks() {
  new_env
  run <<<"$GOOD"$'\nnot-an-email\nme@example\nme@example.fi'
  check "an address that is not one is asked again" bash -c "$(declare -f has_line); CF='$CF'; [[ $RC = 0 ]] && has_line 'CLOUDFLARE_ACCESS_EMAILS=me@example.fi' && grep -qF '\"not-an-email\" is not an email address' '$W/out' && grep -qF '\"me@example\" is not an email address' '$W/out'"
  new_env
  run <<<"$GOOD"$'\n\n\n\n'
  check "no emails after three tries: refused, no file" bash -c "[[ $RC = 1 && ! -e '$CF' ]] && grep -q 'No email address' '$W/out'"
  new_env
  export CLOUDFLARE_API_TOKEN=$GOOD
  run --yes --emails 'me@example.fi,oops' </dev/null
  check "--emails with a bad address: exit 2, no file" bash -c "[[ $RC = 2 && ! -e '$CF' ]] && grep -q 'oops' '$W/out'"
  run --yes </dev/null
  check "--yes without emails and none saved: exit 2 names --emails" bash -c "[[ $RC = 2 && ! -e '$CF' ]] && grep -q -- '--emails' '$W/out'"
  run --yes --domain other.example --emails me@example.fi </dev/null
  check "--domain that is not a zone of the token: exit 2, names the zones" bash -c "[[ $RC = 2 && ! -e '$CF' ]] && grep -q 'example.fi' '$W/out'"
  zones_page 1 1 example.fi example.org
  run --yes --emails me@example.fi </dev/null
  check "several zones, --yes, no --domain and none saved: exit 2" bash -c "[[ $RC = 2 && ! -e '$CF' ]] && grep -q -- '--domain' '$W/out'"
  unset CLOUDFLARE_API_TOKEN
  run --nope </dev/null
  check "an unknown option: exit 2" test "$RC" = 2
  run --help </dev/null
  check "--help: exit 0 and the flags" bash -c "[[ $RC = 0 ]] && grep -q -- '--yes' '$W/out' && grep -q -- '--domain' '$W/out'"
}
t_tunnel_token_form() {
  # the token of a tunnel made by hand (scripts/lib/cloudflare.sh) has the form the app takes, so a token the app would
  # refuse is refused by the installer, before anything is built
  # shellcheck source=/dev/null
  source <(sed -n '/^tunnel_token_ok()/,/^}/p' "$SRC/scripts/lib/cloudflare.sh")
  refused() { ! tunnel_token_ok "$1"; }
  local base=eyJhIjoiYWJjZGVmZ2hpamtsbW5vcA
  check "a tunnel token of 20 characters, with _ - and =, is taken" tunnel_token_ok "${base:0:16}_-=="
  check "a tunnel token with a dot is refused" refused "${base}.${base}"
  check "a tunnel token of 19 characters is refused" refused "${base:0:19}"
  check "a tunnel token of 2000 characters is taken, one of 2001 is refused" bash -c "$(declare -f tunnel_token_ok refused); tunnel_token_ok \$(printf 'a%.0s' \$(seq 2000)) && refused \$(printf 'a%.0s' \$(seq 2001))"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
