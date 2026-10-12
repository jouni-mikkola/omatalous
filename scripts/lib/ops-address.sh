# shellcheck shell=bash
# The helper's follow-up of the host's home network address, for scripts/ops-helper.sh. The helper's load_libs sources
# this file after check_permissions has passed on scripts/lib.
#
#   address_tick   main calls it, with no arguments, every tick, under the helper's lock, right after watchdog_tick and
#                  before the app_running check and the poll, so also when the app is down. Its status is not read.
#
# Decision: when the router hands this machine a new address, the app comes back at the new one by itself within a
# quarter of an hour, where somebody had to run the installer again before.
#
# It acts only on what the host's own network says. Its inputs are `.env` and this machine's interfaces: no value from
# the database, the state file or a request takes part. All of these must hold:
#   - home network mode: COMPOSE_PROFILES is empty (no tunnel, no Caddy) and BIND_ADDRESS is a private IPv4 address
#   - BIND_ADDRESS has been missing from this machine's interfaces for ten minutes in a row. ops/address-since holds
#     "FIRST LATEST ADDRESS": the first and the latest tick that found it missing, in seconds. A tick that finds the
#     address removes the file, and a pause of over five minutes between two ticks starts the count again
#   - the interface the address was on has one private IPv4 address of RFC 1918 (10/8, 172.16/12, 192.168/16) now.
#     While BIND_ADDRESS is on this machine the name of its interface is kept in ops/address-if ("INTERFACE ADDRESS"),
#     and only that interface is followed: an address on another one, a public or a carrier's (100.64/10) address,
#     several at once or no kept interface changes nothing. A tunnel or point-to-point link is never kept or
#     followed. The default route chooses nothing: with a VPN it names the tunnel, and the app would move there
#   - no request was cut short in this tick (a request itself never runs here: the tick holds the helper's lock), and
#     the installer's lock, which install.sh, update.sh, restore.sh and reset.sh take, is free. It is held meanwhile
#   - the last change, made or only tried, is over an hour old (ops/address-at, in seconds)
# Then `.env` is kept as ops/env.prev and written through access_env_write (scripts/lib/ops-access.sh), as the `access`
# action does: BIND_ADDRESS gets the new address, and so does APP_BASE_URL when it was the installer's
# http://ADDRESS:PORT of the old one (an address someone typed in stays). The other keys access_env_write drops are
# written back as they were. The app is started as `access` starts it. When it does not answer, the kept `.env` goes
# back, unless someone has changed the file since, and the app is started with that.
# ops/address-doing is there from before `.env` is written until all this is settled. A helper killed in between (a
# power cut) leaves it, and the next tick starts the app and settles the change the same way.
#
# One line per change goes to helper.log and to the host's journal: "Osoite vaihtui: http://10.0.0.5:8080". A tick
# that changes nothing writes nothing. What the compose commands printed is in ops/run/address.log.
#
# The two files below are read when the helper loads its parts, from the folder of this file, and not when the address
# changes: a rollback earlier in the tick (the watchdog) puts an older release's files on disk, and the launcher's
# last good copy of the helper has its own beside it. Without them address_tick does nothing.

ADDR_MISSING=600; ADDR_GAP=300; ADDR_APART=3600
T_ADDRESS=$(t_for 300 ADDRESS) # seconds for one compose command
ADDR_LIB=${BASH_SOURCE[0]%/*}
# shellcheck source=host-addr.sh
. "$ADDR_LIB/host-addr.sh" 2>/dev/null || true
# shellcheck source=ops-access.sh
. "$ADDR_LIB/ops-access.sh" 2>/dev/null || true

# address_private ADDRESS: one IPv4 address of RFC 1918, written the way `ip` prints it, and nothing else
address_private() {
  local LC_ALL=C a b
  [[ ${1:-} =~ ^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$ ]] || return 1
  a=${BASH_REMATCH[1]}; b=${BASH_REMATCH[2]}
  ((a <= 255 && b <= 255 && BASH_REMATCH[3] <= 255 && BASH_REMATCH[4] <= 255)) || return 1
  ((a == 10)) || ((a == 172 && b >= 16 && b <= 31)) || ((a == 192 && b == 168))
}

# Starts the app with `.env` as it is and tells how the change ended. A `.env` written here that the app does not
# answer with goes back, as in access_back. The caller holds the installer's lock.
address_settle() {
  local url state up=no LOGF=$OPS/run/address.log
  url=$(access_lan_url) || url="the new address"
  { : >"$LOGF" && chmod 600 "$LOGF"; } 2>/dev/null || LOGF=""
  if run_cap "$T_ADDRESS" docker compose up -d --no-build && wait_healthy 45; then up=yes; fi
  state=$(access_env_state address)
  case $up$state in
    yesnew) log "Osoite vaihtui: $url" ;;
    yes*) ;; # the app answers with a .env that is not the one written here: nothing to tell
    nonew)
      if ! { rm -f .env.new && cp "$OPS/env.prev" .env.new && chmod 600 .env.new && mv -f .env.new .env; }; then
        log "address: the app did not start at $url, and the earlier settings could not be put back. They are in ops/env.prev."
      else
        run_cap "$T_ADDRESS" docker compose up -d --no-build || true
        if wait_healthy 45; then log "address: the app did not start at $url. The earlier settings were put back, and the app answers with them."
        else log "address: the app did not start at $url. The earlier settings were put back, but the app does not answer."; fi
      fi ;;
    noold) log "address: a change of the address was cut short before .env was written, and the app does not answer." ;;
    *) log "address: the app did not start at the new address, and .env has been changed by hand since, so the earlier settings were not put back. They are in ops/env.prev." ;;
  esac
  rm -f "$OPS/address-doing"
}

# address_rebind OLD NEW NOW, in a shell of its own: the installer's lock goes with it
address_rebind() {
  local old=$1 new=$2 url line k pairs=("BIND_ADDRESS=$2")
  local -A had=()
  installer_lock || return 0
  url=$(access_lan_url) || return 0 # HOST_PORT is no port
  printf '%s\n' "$3" >"$OPS/address-at" || return 0
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line == *=* ]] || continue
    case ${line%%=*} in CLOUDFLARE_TUNNEL_TOKEN | COMPOSE_PROFILES | TRUST_PROXY | APP_BASE_URL | CF_ACCESS_AUD | CF_ACCESS_TEAM_DOMAIN | ACCESS_LAN_BIND) had[${line%%=*}]=${line#*=} ;; esac
  done <.env
  [[ ${had[APP_BASE_URL]-} != "$url" ]] || had[APP_BASE_URL]=http://$new:${url##*:}
  for k in APP_BASE_URL TRUST_PROXY COMPOSE_PROFILES CLOUDFLARE_TUNNEL_TOKEN CF_ACCESS_AUD CF_ACCESS_TEAM_DOMAIN ACCESS_LAN_BIND; do
    [[ -z ${had[$k]+x} ]] || pairs+=("$k=${had[$k]}")
  done
  # the mark of an earlier change goes before address-doing is made: a helper killed right here must not tell of that one
  if ! { rm -f "$OPS/env.prev" "$OPS/env.written" && cp .env "$OPS/env.prev" && chmod 600 "$OPS/env.prev" && : >"$OPS/address-doing"; }; then
    log "address: $old is no longer on this machine, but the settings could not be kept in ops/env.prev. Nothing was changed."; return 0
  fi
  if ! access_env_write address "${pairs[@]}"; then
    rm -f .env.new "$OPS/address-doing" 2>/dev/null
    log "address: $old is no longer on this machine, but .env could not be written. Nothing was changed."; return 0
  fi
  address_settle
}

# address_candidate INTERFACE: the one private address that interface has now (nothing when it has none or several)
address_candidate() {
  local a addrs found="" n=0
  addrs=$(host_if_addrs "$1")
  while IFS= read -r a; do
    address_private "$a" || continue
    found=$a; n=$((n + 1))
  done <<<"$addrs"
  ((n == 1)) && printf '%s\n' "$found"
}

address_tick() {
  local bind new now at dev first="" latest="" was="" rdev="" raddr=""
  # a host-addr.sh or release.sh of an older release (the launcher's copy, a rollback) has not all of these: then nothing is done
  declare -F env_get log run_cap wait_healthy host_addr_if host_if_addrs host_if_tunnel access_env_write access_env_state access_lan_url installer_lock >/dev/null || return 0
  if [[ -e $OPS/address-doing ]]; then
    [[ -n ${CUT:-}${LOGF:-} ]] || (installer_lock && address_settle) || true
    return 0
  fi
  bind=$(env_get BIND_ADDRESS)
  if [[ -n $(env_get COMPOSE_PROFILES) ]] || ! address_private "$bind"; then
    [[ ! -e $OPS/address-since && ! -e $OPS/address-if ]] || rm -f "$OPS/address-since" "$OPS/address-if"
    return 0
  fi
  [[ ! -f $OPS/address-if ]] || read -r rdev raddr <"$OPS/address-if" || true
  dev=$(host_addr_if "$bind")
  if [[ -n $dev ]]; then
    # the address is here: keep the name of its interface, the only one a later change follows. A tunnel is not kept
    [[ ! -e $OPS/address-since ]] || rm -f "$OPS/address-since"
    if [[ "$rdev $raddr" != "$dev $bind" ]]; then
      if host_if_tunnel "$dev"; then rm -f "$OPS/address-if"; else printf '%s %s\n' "$dev" "$bind" >"$OPS/address-if"; fi
    fi
    return 0
  fi
  now=$(date +%s)
  [[ ! -f $OPS/address-since ]] || read -r first latest was <"$OPS/address-since" || true
  if [[ $first =~ ^[0-9]{1,12}$ && $latest =~ ^[0-9]{1,12}$ && $was == "$bind" ]] && ((10#$first <= 10#$latest && 10#$latest <= now && now - 10#$latest <= ADDR_GAP)); then
    first=$((10#$first))
  else
    first=$now
  fi
  printf '%s %s %s\n' "$first" "$now" "$bind" >"$OPS/address-since" || return 0
  ((now - first >= ADDR_MISSING)) || return 0
  [[ -z ${CUT:-}${LOGF:-} ]] || return 0
  at=$(cat "$OPS/address-at" 2>/dev/null) || at=""
  # a time in the future (the clock went back) or one that is not a time holds nothing back
  if [[ $at =~ ^[0-9]{1,12}$ ]] && ((10#$at <= now && now - 10#$at < ADDR_APART)); then return 0; fi
  # only the interface the address was on, and never a tunnel, whatever the default route says
  [[ -n $rdev && $raddr == "$bind" ]] && ! host_if_tunnel "$rdev" || return 0
  new=$(address_candidate "$rdev") && [[ -n $new && $new != "$bind" ]] || return 0
  (address_rebind "$bind" "$new" "$now") || true
  return 0
}
