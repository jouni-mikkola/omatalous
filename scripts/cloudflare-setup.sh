#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous Cloudflare settings. Writes ~/.config/omatalous/cloudflare.env, the file the installer reads for
# Cloudflare Access (docs/ADVANCED.md, "Cloudflare Tunnel"), so nobody edits it by hand:
#
#   ./scripts/cloudflare-setup.sh                      asks for the API token, the domain and the allowed emails
#   CLOUDFLARE_API_TOKEN=... ./scripts/cloudflare-setup.sh --yes --domain example.fi --emails me@example.fi
#
#   • the token is typed hidden (never echoed, never on a command line), checked with Cloudflare and kept in the
#     file, mode 600, written in one step
#   • the domain is the one zone the token can see, or one you pick when there are several
#   • the emails are the addresses Cloudflare Access lets in, comma-separated
#
# Run it again to change a value: the saved domain and emails are the defaults and Enter keeps the saved token.
#   --domain example.fi            the zone to use, one of the token's zones
#   --emails a@example.fi,b@...    the allowed emails
#   --yes                          no questions: the flags, else the saved values
#   (no flag, so it stays out of ps)   CLOUDFLARE_API_TOKEN   the token; with it set the token is not asked
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
umask 077

API=https://api.cloudflare.com/client/v4
DIR=$HOME/.config/omatalous
FILE=$DIR/cloudflare.env
YES=false; A_DOMAIN=""; A_EMAILS=""
# the token stays in this shell: unset, so no child process inherits it
TOKEN=${CLOUDFLARE_API_TOKEN:-}; unset CLOUDFLARE_API_TOKEN
SCRIPTED=$YES; [[ -z $TOKEN ]] || SCRIPTED=true
TMP=""; NEW=""
WHY=""; NETDOWN=false
ZONES=(); DOMAIN=""; EMAILS=""

if [[ -t 1 ]]; then bold=$'\e[1m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'; else bold=""; green=""; yellow=""; red=""; reset=""; fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%s!%s %s\n' "$yellow" "$reset" "$*"; }
die()  { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
bad()  { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 2; }   # input the caller gave

while (($#)); do
  case $1 in
    --domain) (($# >= 2)) || bad "--domain needs a value."; A_DOMAIN=$2; shift ;;
    --emails) (($# >= 2)) || bad "--emails needs a value."; A_EMAILS=$2; shift ;;
    --yes|-y) YES=true ;;
    -h|--help) sed -n '3,/^# ──/{/^# ──/!s/^# \{0,1\}//p}' "$0"; exit 0 ;;
    *) bad "Unknown option: $1 (see --help)." ;;
  esac
  shift
done
$YES && SCRIPTED=true

cleanup() { rm -rf "$TMP"; [[ -z $NEW ]] || rm -f "$NEW"; }
trap cleanup EXIT
command -v curl >/dev/null 2>&1 || die "curl is missing: sudo apt install curl"
command -v jq >/dev/null 2>&1 || die "jq is missing: sudo apt install jq"
TMP=$(mktemp -d)
HDR=$TMP/header

# prompt VAR "Question" "default": an empty answer or the end of input keeps the default
prompt() {
  local __var=$1 __q=$2 __def=${3:-} __ans=""
  if [[ -n $__def ]]; then printf '%s [%s]: ' "$__q" "$__def"; else printf '%s: ' "$__q"; fi
  read -r __ans || true
  [[ -t 0 ]] || echo
  printf -v "$__var" '%s' "${__ans:-$__def}"
}
# prompt_secret VAR "Question": hidden input
prompt_secret() {
  local __var=$1 __q=$2 __ans=""
  printf '%s: ' "$__q"
  read -r -s __ans || true
  echo
  printf -v "$__var" '%s' "$__ans"
}
# a saved value of the existing file, or nothing. The file is read, never sourced.
saved() { [[ -f $FILE ]] && sed -n "s/^$1=//p" "$FILE" | tail -n 1 | tr -d '\r' | sed -E "s/^([\"'])(.*)\\1\$/\\2/" || true; }

# cf PATH: GET from the Cloudflare API, the answer on stdout. The token reaches curl in a header file, so it is not
# in the command line that ps shows.
cf() { curl -sS --max-time 30 -H "@$HDR" "$API$1"; }

# token_ok: Cloudflare's token verify call. Sets WHY when it fails, NETDOWN when Cloudflare was not reached.
token_ok() {
  local body rc=0 status
  printf 'Authorization: Bearer %s\n' "$TOKEN" >"$HDR"
  body=$(cf /user/tokens/verify) || rc=$?
  if ((rc != 0)); then NETDOWN=true; WHY="Could not reach Cloudflare (curl exit $rc). Check the network connection."; return 1; fi
  if jq -e '.success == true and .result.status == "active"' <<<"$body" >/dev/null 2>&1; then return 0; fi
  status=$(jq -r '.errors[0].message // (.result.status | select(. != null and . != "active") | "the token is " + .) // empty' <<<"$body" 2>/dev/null) || status=""
  WHY="Cloudflare did not accept the token${status:+: $status}."
  return 1
}

get_token() {
  local ans re='^[A-Za-z0-9_-]+$'
  for _ in 1 2 3; do
    if [[ -z $TOKEN ]]; then
      if $YES; then
        TOKEN=$OLD_TOKEN
      elif [[ -n $OLD_TOKEN ]]; then
        prompt_secret ans "API token (Enter keeps the saved one)"; TOKEN=${ans:-$OLD_TOKEN}
      else
        prompt_secret ans "API token"; TOKEN=$ans
      fi
    fi
    TOKEN=${TOKEN//[[:space:]]/}
    if [[ -z $TOKEN ]]; then WHY="No token. Set CLOUDFLARE_API_TOKEN, or run this without --yes and type it."
    elif [[ ! $TOKEN =~ $re ]]; then WHY="That does not look like an API token (letters, digits, - and _ only)."
    elif token_ok; then ok "Cloudflare accepts the token."; return
    fi
    if $NETDOWN || $SCRIPTED; then die "$WHY"; fi
    warn "$WHY"
    TOKEN=""; OLD_TOKEN=""   # a saved token that failed is not offered again
  done
  die "No working token after three tries."
}

# list_zones: fills ZONES with the active zones the token can see
list_zones() {
  local page=1 pages body msg
  while :; do
    body=$(cf "/zones?per_page=50&page=$page") || die "Could not reach Cloudflare while listing the zones."
    if ! jq -e '.success == true' <<<"$body" >/dev/null 2>&1; then
      msg=$(jq -r '.errors[0].message // empty' <<<"$body" 2>/dev/null) || msg=""
      die "Cloudflare would not list the zones${msg:+ ($msg)}. The token needs Zone: Zone Read."
    fi
    mapfile -t -O "${#ZONES[@]}" ZONES < <(jq -r '.result[] | select(.status == "active") | .name' <<<"$body")
    pages=$(jq -r '.result_info.total_pages // 1' <<<"$body")
    ((page < pages && page < 20)) || break
    page=$((page + 1))
  done
}

choose_domain() {
  local z i def="" ans
  ((${#ZONES[@]})) || die "The token sees no active zone. Add the domain to Cloudflare, and give the token Zone: Zone Read for it."
  if [[ -n $A_DOMAIN ]]; then
    for z in "${ZONES[@]}"; do [[ ${z,,} == "${A_DOMAIN,,}" ]] && { DOMAIN=$z; ok "Zone: $DOMAIN"; return; }; done
    bad "$A_DOMAIN is not a zone of this token. Its zones: ${ZONES[*]}"
  fi
  if ((${#ZONES[@]} == 1)); then DOMAIN=${ZONES[0]}; ok "Zone: $DOMAIN (the only one the token sees)"; return; fi
  for z in "${ZONES[@]}"; do [[ ${z,,} == "${OLD_DOMAIN,,}" ]] && def=$z; done
  if $YES; then
    [[ -n $def ]] || bad "The token sees several zones (${ZONES[*]}). Pass --domain."
    DOMAIN=$def; ok "Zone: $DOMAIN"; return
  fi
  say "The token sees these zones:"
  i=0; for z in "${ZONES[@]}"; do i=$((i + 1)); printf '  %d) %s\n' "$i" "$z"; done
  for _ in 1 2 3; do
    prompt ans "Base domain (number or name)" "$def"
    if [[ $ans =~ ^[0-9]+$ ]] && ((ans >= 1 && ans <= ${#ZONES[@]})); then DOMAIN=${ZONES[ans - 1]}; return; fi
    for z in "${ZONES[@]}"; do [[ -n $ans && ${z,,} == "${ans,,}" ]] && { DOMAIN=$z; return; }; done
    warn "That is not one of the zones."
  done
  die "No domain chosen."
}

# normalize_emails LIST: sets EMAILS (trimmed, no repeats, comma-separated). Returns 1 with WHY when one is not an address.
normalize_emails() {
  local raw=() list=() seen=" " e re='^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$'
  IFS=, read -ra raw <<<"$1" || true
  for e in "${raw[@]}"; do
    e=${e#"${e%%[![:space:]]*}"}; e=${e%"${e##*[![:space:]]}"}
    [[ -n $e ]] || continue
    [[ $e =~ $re ]] || { WHY="\"$e\" is not an email address."; return 1; }
    [[ $seen == *" ${e,,} "* ]] && continue
    seen+="${e,,} "; list+=("$e")
  done
  ((${#list[@]})) || { WHY="No email address given."; return 1; }
  EMAILS=$(IFS=,; echo "${list[*]}")
}

choose_emails() {
  local ans
  if [[ -n $A_EMAILS ]]; then
    normalize_emails "$A_EMAILS" || bad "--emails: $WHY"
  elif $YES; then
    normalize_emails "$OLD_EMAILS" || bad "Pass --emails with the addresses to let in. $WHY"
  else
    for _ in 1 2 3; do
      prompt ans "Emails allowed in, comma-separated" "$OLD_EMAILS"
      normalize_emails "$ans" && break
      warn "$WHY"
    done
    [[ -n $EMAILS ]] || die "No email addresses given."
  fi
  ok "Emails: $EMAILS"
}

write_file() {
  mkdir -p "$DIR"
  NEW=$(mktemp "$DIR/.cloudflare.env.XXXXXX")
  {
    echo "# Written by scripts/cloudflare-setup.sh. Run it again to change a value."
    printf 'CLOUDFLARE_API_TOKEN=%s\n' "$TOKEN"
    printf 'CLOUDFLARE_ACCESS_EMAILS=%s\n' "$EMAILS"
    printf 'CLOUDFLARE_BASE_DOMAIN=%s\n' "$DOMAIN"
  } >"$NEW"
  chmod 600 "$NEW"
  if [[ -f $FILE ]] && cmp -s "$NEW" "$FILE"; then
    rm -f "$NEW"; NEW=""; chmod 600 "$FILE"
    ok "Nothing changed in $FILE."
  else
    mv -f "$NEW" "$FILE"; NEW=""
    ok "Saved $FILE (mode 600)."
  fi
}

OLD_TOKEN=$(saved CLOUDFLARE_API_TOKEN); OLD_EMAILS=$(saved CLOUDFLARE_ACCESS_EMAILS); OLD_DOMAIN=$(saved CLOUDFLARE_BASE_DOMAIN)
HAD_TOKEN=$OLD_TOKEN

((EUID != 0)) || warn "Running as root: this writes root's file ($FILE). The installer reads the file of the user who runs it, so run this as that user."

step "Cloudflare API token"
[[ -n $TOKEN ]] || say "The permissions it needs are in docs/ADVANCED.md, \"Cloudflare Tunnel\"."
get_token
step "Domain"
list_zones
choose_domain
step "Allowed emails"
choose_emails
step "Saving"
write_file
if [[ $TOKEN == "$HAD_TOKEN" ]]; then say "The saved token was kept."; else say "The new token is saved."; fi
say "The installer reads this file when you choose tunnel access."
