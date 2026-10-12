# shellcheck shell=bash
# The `access` action of scripts/ops-helper.sh: applies the way of reaching this copy that the app has prepared,
# Cloudflare Tunnel with Access ("tunnel") or the home network again ("lan"). Only the helper loads this file, once: in
# load_libs, from the helper's own folder, after check_permissions has passed on scripts/lib (a tick holds its lock
# then, the self-test does not). It uses the helper's functions: in_app, env_get, run_cap, wait_healthy, fail, t_for,
# app_running and store_result, host_addrs of host-addr.sh, which ops-address.sh loads, and the writer of .env
# (envfile_stage, envfile_commit and envfile_restore of envfile.sh).
#
# The change comes from the app, and a request from outside can reach the app, so nothing of it is trusted:
#   - it is read only as the one line `ops access` prints, at most ACCESS_MAX printable ASCII characters
#   - the line must match one exact shape, and then each value its one form (access_read). No form lets through a
#     newline, a space, a quote, a `$`, a backtick, a `#` or a backslash, so a value can only be one value in `.env`
#   - the values are compared and printed by bash builtins only. They are never run, never expanded a second time
#     and never put on a command line, in a log, in the journal or in the summary. Only the hostname is shown.
# Behind the tunnel the app's port answers on this machine only (BIND_ADDRESS=127.0.0.1), as in the installer's tunnel
# install: cloudflared is a container of the same Compose project and reaches the app inside that network, at
# http://banking:8080, never through the port published on the host. With TRUST_PROXY=true the app believes the
# address in Cf-Connecting-Ip, so no other device may get to say it. The bind the copy had waits in `.env` as
# ACCESS_LAN_BIND, and `lan` puts it back (access_lan_bind).
# `.env` is rewritten once, beside itself with mode 600 and a rename, each key once. The old file is kept as
# ops/env.prev (one generation, mode 600) and put back when the app does not answer with the new one. ops/env.written
# names the request that wrote `.env` and the checksum of what it wrote: the kept file only ever replaces that one, so
# a `.env` someone has changed by hand since stays theirs.
#
# cut_short is the helper's next tick after it was killed in an `access` or a `restart`. It is here and not in the
# helper, which is at its line cap.

ACCESS_MAX=4096 # the longest valid line is about 2 500 characters
T_ACCESS=$(t_for 300 ACCESS) # seconds for one compose command, as for the helper's other actions
# the forms of the protocol, the same as in apps/server/src/services/access-request.ts
A_LABEL='[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?'
A_RE_HOST="^$A_LABEL(\\.$A_LABEL)+\$"
A_RE_TEAM="^$A_LABEL\\.cloudflareaccess\\.com\$"
# an IPv4 address or an IPv6 address without a zone, at most 45 characters: what Compose takes as a port's host address
A_RE_BIND='^([0-9]{1,3}(\.[0-9]{1,3}){3}|[0-9A-Fa-f]*:[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*)$'
A_RE_TUNNEL='^\{"want":"tunnel","hostname":"([^"\\]*)","tunnelToken":"([^"\\]*)","accessAud":"([^"\\]*)","teamDomain":"([^"\\]*)"\}$'

# Reads what the app prepared: A_WANT is tunnel or lan, and a tunnel also sets A_HOST, A_TOKEN, A_AUD and A_TEAM.
# Returns 1 with the reason in A_ERR (Finnish, for the summary) when there is nothing to apply or a value is off.
access_read() {
  # byte by byte, so [a-z] and [:print:] mean ASCII whatever the locale of the host is
  local LC_ALL=C out h t a d none="Mitään ei muutettu."
  A_WANT=""; A_HOST=""; A_TOKEN=""; A_AUD=""; A_TEAM=""; A_ERR=""
  out=$(in_app dist/node.js ops access --helper "$OPS_HELPER_VERSION" 2>/dev/null | head -c $((ACCESS_MAX + 1))) || out=""
  if [[ -z $out ]]; then A_ERR="Sovellus ei kertonut etäkäytön muutosta. $none"; return 1; fi
  if [[ $out == '{"want":null}' ]]; then A_ERR="Etäkäytön muutosta ei ole valmisteltu."; return 1; fi
  if [[ $out == '{"want":"lan"}' ]]; then A_WANT=lan; return 0; fi
  if ((${#out} > ACCESS_MAX)) || [[ $out == *[![:print:]]* || ! $out =~ $A_RE_TUNNEL ]]; then
    A_ERR="Etäkäytön muutos ei ole odotetussa muodossa. $none"; return 1
  fi
  h=${BASH_REMATCH[1]}; t=${BASH_REMATCH[2]}; a=${BASH_REMATCH[3]}; d=${BASH_REMATCH[4]}
  # the last label holds a letter: an IPv4 address is no hostname (doctor.sh fetches this address from the host)
  if ((${#h} > 253)) || [[ ! $h =~ $A_RE_HOST || ${h##*.} != *[a-z]* ]]; then A_ERR="Etäkäytön osoite ei ole kelvollinen. $none"; return 1; fi
  # the length apart from the characters: a repeat count of 2000 is more than every regex library takes
  if ((${#t} < 20 || ${#t} > 2000)) || [[ ! $t =~ ^[A-Za-z0-9_=-]+$ ]]; then A_ERR="Tunnelin tunniste ei ole kelvollinen. $none"; return 1; fi
  if [[ ! $a =~ ^[0-9a-f]{64}$ ]]; then A_ERR="Cloudflare Accessin sovelluksen tunniste ei ole kelvollinen. $none"; return 1; fi
  if [[ ! $d =~ $A_RE_TEAM ]]; then A_ERR="Cloudflare Accessin tiimin osoite ei ole kelvollinen. $none"; return 1; fi
  A_WANT=tunnel; A_HOST=$h; A_TOKEN=$t; A_AUD=$a; A_TEAM=$d
}

access_is_addr() { local LC_ALL=C; ((${#1} <= 45)) && [[ $1 =~ $A_RE_BIND ]]; }

# The bind address `lan` would give right now: the one remembered when the copy went behind the tunnel, read only
# while `.env` asks for the tunnel, else the one `.env` holds. A value that is no IP address is read as this machine
# only, which is what Compose does with none. Nothing else than an address is ever written back to `.env`.
access_lan_bind() {
  local keep=""
  [[ $(env_get COMPOSE_PROFILES) != *tunnel* ]] || keep=$(env_get ACCESS_LAN_BIND)
  access_is_addr "$keep" || keep=$(env_get BIND_ADDRESS)
  access_is_addr "$keep" || keep=127.0.0.1
  printf '%s' "$keep"
}

# The home network address by the installer's rule (install.sh): that bind address and the port `.env` holds, and
# this machine's first address when the app listens on all of them. `lan` writes it and the helper's state reports it
# in every mode (lanAddress), so the address an admin sees before remote access goes off is the one `lan` then gives.
# Fails only when the port is not a number. (state_json of the helper calls it for lanAddress.)
access_lan_url() {
  local port addr
  port=$(env_get HOST_PORT); port=${port:-8080}
  [[ $port =~ ^[0-9]{2,5}$ ]] || return 1
  addr=$(access_lan_bind)
  case $addr in
    127.0.0.1 | ::1) addr=localhost ;;
    0.0.0.0 | ::) addr=$(host_addrs | head -1) ;;
  esac
  # turning remote access off must not stop at this: an address that cannot be told is this machine itself
  [[ $addr == localhost ]] || access_is_addr "$addr" || addr=localhost
  [[ $addr != *:* ]] || addr="[$addr]"
  printf 'http://%s:%s' "$addr" "$port"
}

# The eight keys a change of access owns in .env: every line of them leaves its place in a rewrite (access_env_write).
ACCESS_KEYS="CLOUDFLARE_TUNNEL_TOKEN COMPOSE_PROFILES TRUST_PROXY APP_BASE_URL CF_ACCESS_AUD CF_ACCESS_TEAM_DOMAIN BIND_ADDRESS ACCESS_LAN_BIND"

# .env as it is now, kept as ops/env.prev (one generation, mode 600) before a rewrite
access_env_keep() { rm -f "$OPS/env.prev" && cp .env "$OPS/env.prev" && chmod 600 "$OPS/env.prev"; }

# Rewrites .env once, through the one writer (scripts/lib/envfile.sh, which the installer's env_set uses too): every
# line of the eight keys goes, and the items given follow the other lines in the order given, each once. KEY=value sets
# a key and +KEY keeps it as .env has it. The other lines stay as they are (env_check passed them at the start of this
# tick). One rename, so a helper killed half way never leaves a tunnel token without the Access pair. The request and
# the checksum of the new file go to ops/env.written before the rename (access_env_state reads them).
access_env_write() { # access_env_write ID ITEM...
  local id=$1 k sum named=" " go=(); shift
  rm -f .env.new "$OPS/env.written" 2>/dev/null || return 1
  for k in "$@"; do k=${k#+}; named+="${k%%=*} "; done
  for k in $ACCESS_KEYS; do [[ $named == *" $k "* ]] || go+=("$k"); done
  envfile_stage .env end "$@" ${go[@]+"${go[@]}"} || return 1
  sum=$(sha256sum <.env.new) && [[ $sum =~ ^[0-9a-f]{64} ]] && printf '%s %s\n' "$id" "${sum%% *}" >"$OPS/env.written" || { rm -f .env.new; return 1; }
  envfile_commit .env 600
}

# What .env is after request ID: `new` when it is the file that request wrote, `old` when it is the one from before
# the request (nothing was written, or the kept file was put back), `hand` when someone has changed it since.
access_env_state() { # access_env_state ID
  local mark="" sum prev
  [[ ! -f $OPS/env.written ]] || mark=$(<"$OPS/env.written")
  [[ $mark == "$1 "* ]] || { echo old; return; }
  sum=$(sha256sum 2>/dev/null <.env); prev=$(sha256sum 2>/dev/null <"$OPS/env.prev")
  if [[ -n $sum && $mark == "$1 ${sum%% *}" ]]; then echo new; elif [[ -n $sum && $sum == "$prev" ]]; then echo old; else echo hand; fi
}

# Stops and removes the tunnel container. `up` leaves a service alone once its profile is off, so it is named here.
access_tunnel_off() { run_cap "$T_ACCESS" docker compose --profile tunnel rm -sf tunnel; }

# The tunnel was stopped for a change that then was not made: the containers are started again with .env as it is,
# or nobody would get in (.env still asks for the tunnel, and the app for Access) until someone starts them by hand.
access_not_made() { # access_not_made WHY
  if run_cap "$T_ACCESS" docker compose up -d --no-build; then fail "$1 Asetuksia ei muutettu, ja tunneli on taas käynnissä."
  else fail "$1 Asetuksia ei muutettu, mutta tunneli ei käynnistynyt uudelleen. Käynnistä se palvelimella komennolla docker compose up -d."; fi
}

# The app did not come up with the new .env: the kept one goes back and the app is started with it. Only the file
# this request wrote is replaced. The health wait is long, and a .env someone has changed meanwhile is theirs.
access_back() { # access_back ID WHY
  local why=$2
  if [[ $(access_env_state "$1") != new ]]; then
    fail "$why Tiedostoa .env on sen jälkeen muutettu käsin, joten aiempia asetuksia ei palautettu. Ne ovat palvelimella tiedostossa ops/env.prev."; return
  fi
  echo "Sovellus ei vastannut uusilla asetuksilla. Palautetaan aiemmat asetukset." >>"$LOGF"
  if ! envfile_restore .env "$OPS/env.prev"; then
    fail "$why Aiempia asetuksia ei saatu palautettua: ne ovat palvelimella tiedostossa ops/env.prev."; return
  fi
  # a tunnel the new settings started does not stay up beside settings that have none
  [[ $(env_get COMPOSE_PROFILES) == *tunnel* ]] || access_tunnel_off || true
  run_cap "$T_ACCESS" docker compose up -d --no-build || true
  if wait_healthy 45; then fail "$why Aiemmat asetukset palautettiin, ja sovellus toimii niillä."
  else fail "$why Aiemmat asetukset palautettiin, mutta sovellus ei vastaa."; fi
}

access_apply() { # access_apply ID
  local id=$1 url bind pairs=()
  echo "STEP: 1/3 Luetaan valmisteltu muutos" >>"$LOGF"
  access_read || { fail "$A_ERR"; return; }
  # (a .env that is a link never gets here: the helper's check_permissions stops the tick first)
  [[ -f .env ]] || { fail "Asennuksen .env-tiedostoa ei ole. Mitään ei muutettu."; return; }
  # an install with its own domain (Caddy) answers on ports 80 and 443 itself: a tunnel beside it is not set up here
  if [[ $(env_get COMPOSE_PROFILES) == *caddy* ]]; then fail "Tällä asennuksella on oma verkkotunnus (Caddy), eikä etäkäyttöä vaihdeta sen rinnalla. Mitään ei muutettu."; return; fi
  bind=$(access_lan_bind)
  if [[ $A_WANT == tunnel ]]; then
    url=https://$A_HOST
    # a second `tunnel` finds the remembered bind in $bind and writes it again, so it is never lost to 127.0.0.1
    pairs=("CLOUDFLARE_TUNNEL_TOKEN=$A_TOKEN" COMPOSE_PROFILES=tunnel TRUST_PROXY=true "APP_BASE_URL=$url" "CF_ACCESS_AUD=$A_AUD" "CF_ACCESS_TEAM_DOMAIN=$A_TEAM" BIND_ADDRESS=127.0.0.1 "ACCESS_LAN_BIND=$bind")
  else
    url=$(access_lan_url) || { fail "Portti (HOST_PORT) tiedostossa .env ei ole kelvollinen. Mitään ei muutettu."; return; }
    pairs=("APP_BASE_URL=$url" "BIND_ADDRESS=$bind")
  fi
  echo "STEP: 2/3 Kirjoitetaan asetukset ja käynnistetään sovellus" >>"$LOGF"
  access_env_keep || { fail "Aiempia asetuksia ei saatu talteen. Mitään ei muutettu."; return; }
  # back to the home network: the tunnel goes first, so it never leads to an app that has dropped its Access check
  if [[ $A_WANT == lan ]] && ! access_tunnel_off; then access_not_made "Tunnelia ei saatu pysäytettyä."; return; fi
  if ! access_env_write "$id" "${pairs[@]}"; then
    rm -f .env.new 2>/dev/null
    if [[ $A_WANT == lan ]]; then access_not_made "Asetusten kirjoitus ei onnistunut."; else fail "Asetusten kirjoitus ei onnistunut. Mitään ei muutettu."; fi
    return
  fi
  A_TOKEN=""; pairs=()
  # `up` and not `restart`: only a container made again reads the new .env. It also starts the tunnel service.
  if run_cap "$T_ACCESS" docker compose up -d --no-build; then
    echo "STEP: 3/3 Odotetaan että sovellus vastaa" >>"$LOGF"
    if wait_healthy 45; then
      # shellcheck disable=SC2034 # SUMMARY is read by the helper's run_request
      if [[ $A_WANT == tunnel ]]; then SUMMARY="Etäkäyttö on päällä. Uusi osoite: $url"; else SUMMARY="Etäkäyttö on pois päältä. Uusi osoite: $url"; fi
      return
    fi
  fi
  access_back "$id" "Sovellus ei käynnistynyt uusilla asetuksilla."
}

# The helper was killed in request ID, an `access` or a `restart` (a power cut, a reboot, a stopped unit), and
# finish_unfinished has stored it as failed. The containers are started again with .env as it is. A killed `access`
# is settled like a whole one: the new settings stay when the app answers with them, else the kept file goes back.
# No version is rolled back for either. The summary of what was done replaces the stored one.
cut_short() { # cut_short ID ACTION
  local id=$1 said state
  LOGF=$OPS/run/$id.log; SUMMARY=""
  if [[ $2 == access ]]; then
    said="Apuri keskeytyi kesken etäkäytön muutoksen."
    state=$(access_env_state "$id")
    run_cap "$T_ACCESS" docker compose up -d --no-build || true
    # a tunnel does not stay up beside settings that have none
    [[ $(env_get COMPOSE_PROFILES) == *tunnel* ]] || access_tunnel_off || true
    if wait_healthy 45; then
      case $state in
        new) SUMMARY="$said Uudet asetukset ovat käytössä, ja sovellus toimii niillä. Osoite: $(env_get APP_BASE_URL)" ;;
        old) SUMMARY="$said Aiemmat asetukset ovat käytössä, ja sovellus toimii niillä." ;;
        *) SUMMARY="$said Tiedostoa .env on sen jälkeen muutettu käsin, ja sovellus toimii sen asetuksilla." ;;
      esac
    else
      case $state in
        new) access_back "$id" "$said Sovellus ei käynnistynyt uusilla asetuksilla." ;;
        old) SUMMARY="$said Aiemmat asetukset ovat käytössä, mutta sovellus ei vastaa." ;;
        *) SUMMARY="$said Tiedostoa .env on sen jälkeen muutettu käsin, eikä siihen koskettu. Sovellus ei vastaa. Aiemmat asetukset ovat palvelimella tiedostossa ops/env.prev." ;;
      esac
    fi
  elif ! app_running; then
    said="Apuri keskeytyi kesken uudelleenkäynnistyksen."
    run_cap "$T_ACCESS" docker compose up -d --no-build || true
    if wait_healthy 45; then SUMMARY="$said Sovellus käynnistettiin, ja se vastaa."; else SUMMARY="$said Sovellus käynnistettiin, mutta se ei vastaa."; fi
  fi
  [[ -z $SUMMARY ]] || store_result "$id" failed 1 "$SUMMARY" "$LOGF"
  LOGF=""
}
