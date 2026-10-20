#!/usr/bin/env bash
# Tests for the `access` action of scripts/ops-helper.sh (scripts/lib/ops-access.sh): the helper applies the change
# of remote access the app prepared. A stub docker stands for the app and for Compose, so nothing here touches the
# network or a real container. Every host, token and tag below is made up.
#
#   tools/test/ops-access.test.sh [name-filter]
#
# The stub's state is files in S: `access` is the line `ops access` prints (none: {"want":null}), `env.live` the .env
# the app was last started with, `tunnel-up` the tunnel container. `unhealthy` makes the app never answer, `bad-when`
# makes it not answer while env.live holds that line, `up-fails` makes the next `compose up` fail. `app-down` is an
# app with no running container, until the next `compose up`. `kill-on-up`, `kill-on-rm` and `kill-on-restart` kill
# the helper inside that compose command, as a power cut or `systemctl stop` would. `run.kept` is the helper's
# ops/run as it was when the result was reported (the helper deletes the log right after), `trace` what `traced` kept.
set -u
umask 022
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
# shellcheck source=fake-host.sh
. "$HERE/fake-host.sh"
# the helper refuses root: a root run goes again as nobody on a copy
unprivileged ops-access.test.sh "$FILTER"
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

TMPBASE=$(mktemp -d)
trap 'rm -rf "$TMPBASE"' EXIT
ID=op_0123456789abcdef
HOST=koti.example.fi
TOKEN=$(printf 'tunneltokenTESTVALUE%.0s' 1 2 3 4 5 6 7 8)
AUD=$(printf 'a1b2c3d4%.0s' 1 2 3 4 5 6 7 8)
TEAM=tiimi.cloudflareaccess.com

write_stubs() {
  cat >"$S/bin/docker" <<'EOF'
#!/usr/bin/env bash
S=$OPS_STUB_DIR
printf 'docker %s\n' "$*" >>"$S/calls.log"
[[ ${1:-} == compose ]] || exit 0
shift
# the helper runs this stub under `timeout`, so the helper is the parent of this process's parent
die_on() { # die_on COMMAND
  [[ -e $S/kill-on-$1 ]] || return 0
  rm -f "$S/kill-on-$1"
  local h; h=$(cut -d' ' -f4 "/proc/$PPID/stat")
  grep -q ops-helper "/proc/$h/cmdline" && kill -9 "$h"
  exit 137
}
case " $* " in
  *" exec "*)
    [[ ! -e $S/app-down ]] || exit 1
    case $* in
      *wget*) [[ ! -e $S/unhealthy ]] && ! { [[ -f $S/bad-when ]] && grep -qxFf "$S/bad-when" "$S/env.live"; }; exit $? ;;
      *"ops poll"*) if [[ -f $S/poll ]]; then cat "$S/poll"; rm -f "$S/poll"; else echo '{"request":null}'; fi ;;
      *"ops access"*) if [[ -f $S/access ]]; then cat "$S/access"; else echo '{"want":null}'; fi ;;
      *"ops report"*) cat >"$S/report.json"; rm -rf "$S/run.kept"; cp -r ops/run "$S/run.kept"; echo '{"ok":true}' ;;
      *"ops state"*) cat >/dev/null; echo '{"ok":true}' ;;
      *"dist/node.js version"*) echo "0.8.7 (test)" ;;
    esac ;;
  *" ps "*) [[ -e $S/app-down ]] || echo cid1 ;;
  *" up "*)
    die_on up # before anything is made again
    if [[ -e $S/up-fails ]]; then rm -f "$S/up-fails"; echo "up: boom" >&2; exit 1; fi
    cp .env "$S/env.live"; rm -f "$S/app-down"
    if grep -qx 'COMPOSE_PROFILES=tunnel' .env; then touch "$S/tunnel-up"; fi ;;
  *" rm "*) rm -f "$S/tunnel-up"; die_on rm ;;
  *" restart "*) touch "$S/app-down"; die_on restart; rm -f "$S/app-down" ;; # stopped, then started
esac
exit 0
EOF
  printf '#!/bin/sh\nexec /bin/sleep 0.01\n' >"$S/bin/sleep"
  # this machine's address, as `ip -o addr show scope global` prints it
  printf '#!/bin/sh\necho "2: eth0    inet 192.0.2.44/24 brd 192.0.2.255 scope global eth0"\n' >"$S/bin/ip"
  chmod +x "$S/bin"/*
}

# a world: a clone with the helper and the .env given (one line per argument), a running app, an `access` request
new_world() {
  W=$(mktemp -d "$TMPBASE/w.XXXXXX"); S=$W/stub; CL=$W/clone
  mkdir -p "$S/bin" "$W/home" "$CL/scripts/lib" "$CL/ops"; chmod 700 "$CL/ops"
  cp "$SRC"/scripts/*.sh "$CL/scripts/"; cp "$SRC"/scripts/lib/*.sh "$CL/scripts/lib/"
  write_stubs
  printf '%s\n' "$@" >"$CL/.env"; chmod 600 "$CL/.env"
  cp "$CL/.env" "$W/env.before"; cp "$CL/.env" "$S/env.live"; : >"$S/calls.log"
  request access
}
lan_world() { new_world HOST_PORT=8081 BIND_ADDRESS=192.0.2.10 APP_BASE_URL=http://old.example.fi:1 CLOUDFLARE_TUNNEL_TOKEN= OTHER_KEY=stays APP_BASE_URL=http://192.0.2.10:8081; }
tunnel_world() { # tunnel_world [BIND_ADDRESS line]
  new_world HOST_PORT=8081 ${1:+"$1"} DOMAIN=$HOST "CLOUDFLARE_TUNNEL_TOKEN=$TOKEN" COMPOSE_PROFILES=tunnel TRUST_PROXY=true "APP_BASE_URL=https://$HOST" "CF_ACCESS_AUD=$AUD" "CF_ACCESS_TEAM_DOMAIN=$TEAM"
  touch "$S/tunnel-up"; echo '{"want":"lan"}' >"$S/access"
}
request() { printf '{"request":{"id":"%s","action":"%s","params":{},"secret":null}}\n' "$ID" "$1" >"$S/poll"; }
tunnel_json() { printf '{"want":"tunnel","hostname":"%s","tunnelToken":"%s","accessAud":"%s","teamDomain":"%s"}\n' "$1" "$2" "$3" "$4"; }
tick() { (cd "$CL" && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/ops-helper.sh >"$W/tick.out" 2>&1); }
# the server as a killed helper leaves it: the calls from here on are the next tick's, update.sh only records that
# it was asked, and the day's check of the host is done (a tick with no request would run doctor.sh here)
after_kill() {
  : >"$S/calls.log"; rm -f "$S/report.json"; touch "$CL/ops/last-check"
  printf '#!/bin/sh\necho "update.sh $*" >>"$OPS_STUB_DIR/calls.log"\nexit 1\n' >"$CL/scripts/update.sh"; chmod 755 "$CL/scripts/update.sh"
}
# a tick the stub kills the helper in (the shell's own "Killed" line is not a finding)
killed_tick() { tick 2>/dev/null; after_kill; }
# this world's copy of the helper writes every command it runs, as bash expanded it, into S/trace
traced() { sed -i 's|^set +x$|exec 9>>"$OPS_STUB_DIR/trace"; BASH_XTRACEFD=9; set -x|' "$CL/scripts/ops-helper.sh"; }
n_calls() { grep -cE "$1" "$S/calls.log" || true; }
reported() { grep -q "\"status\":\"$1\"" "$S/report.json" 2>/dev/null; }
summary() { grep -qF "\"summary\":\"$1\"" "$S/report.json" 2>/dev/null; }
env_line() { [[ $(grep -c "^${1%%=*}=" "$CL/.env") == 1 ]] && grep -qxF "$1" "$CL/.env"; } # the key once, with this value
env_same() { cmp -s "$CL/.env" "$W/env.before" && [[ $(stat -c %a "$CL/.env") == 600 && ! -e $CL/.env.new ]]; }
# where the token is, of the places it must never reach: the helper's folder (journal, helper.log), the run log as
# it was when the result went out, the tick's output, the report and every docker command line
token_in() { grep -rlF "$TOKEN" "$CL/ops" "$S/run.kept" "$W/tick.out" "$S/calls.log" "$S/report.json" 2>/dev/null | tr '\n' ' '; }
no_rollback() { [[ $(n_calls '^update\.sh') == 0 && ! -e $CL/ops/RECOVERY.txt ]]; } # no version rollback was asked for
# the address the report says the copy would answer at after `lan` (lanAddress of the state)
lan_address() { grep -qF "\"lanAddress\":\"$1\"" "$S/report.json" 2>/dev/null; }
# the next request of the same world. A request id is run once, so each gets its own (the caller keeps ID local).
again() { # again N ACTION [the line `ops access` prints]
  ID=${ID%?}$1; : >"$S/calls.log"; rm -f "$S/report.json"
  [[ -z ${3:-} ]] || printf '%s\n' "$3" >"$S/access"
  request "$2"; tick
}

t_tunnel_on_from_lan() {
  lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"
  tick
  check "tunnel on: reported ok" reported ok
  check "tunnel on: the summary names the new address" summary "Etäkäyttö on päällä. Uusi osoite: https://$HOST"
  local line
  for line in "CLOUDFLARE_TUNNEL_TOKEN=$TOKEN" COMPOSE_PROFILES=tunnel TRUST_PROXY=true "APP_BASE_URL=https://$HOST" "CF_ACCESS_AUD=$AUD" "CF_ACCESS_TEAM_DOMAIN=$TEAM"; do
    check "tunnel on: .env has ${line%%=*} once, with its value" env_line "$line"
  done
  check "tunnel on: the other lines stay" bash -c "grep -qx OTHER_KEY=stays '$CL/.env' && grep -qx HOST_PORT=8081 '$CL/.env'"
  check "tunnel on: .env has mode 600 and nothing is left beside it" bash -c "[[ \$(stat -c %a '$CL/.env') == 600 && ! -e '$CL/.env.new' ]]"
  check "tunnel on: the app was made again once, with the new .env" bash -c "[[ \$(grep -c '^docker compose up -d --no-build\$' '$S/calls.log') == 1 ]] && cmp -s '$CL/.env' '$S/env.live'"
  check "tunnel on: the tunnel runs" test -e "$S/tunnel-up"
  check "tunnel on: the old .env is kept (600)" bash -c "cmp -s '$CL/ops/env.prev' '$W/env.before' && [[ \$(stat -c %a '$CL/ops/env.prev') == 600 ]]"
  check "tunnel on: the report tells the new mode and address" bash -c "grep -q '\"mode\":\"tunnel\"' '$S/report.json' && grep -q '\"address\":\"https://$HOST\"' '$S/report.json'"
  check "tunnel on: the request was read as version 5" test "$(n_calls 'dist/node.js ops access --helper 5$')" = 1
  check "tunnel on: the journal says reported" grep -q '"reported":true' "$CL/ops/journal/$ID.json"
  check "tunnel on: no token in the journal, the logs, the output, the report or a command line" test -z "$(token_in)"
}

t_tunnel_bad_values_change_nothing() {
  local name bad nl=$'\n'
  while IFS='|' read -r name bad; do
    lan_world; printf '%s\n' "${bad//@NL@/$nl}" >"$S/access"
    tick
    check "bad value, $name: reported failed, nothing changed" bash -c "grep -q '\"status\":\"failed\"' '$S/report.json' && grep -q 'ei muutettu' '$S/report.json'"
    check "bad value, $name: .env is the same file, no copy made, nothing started" bash -c "cmp -s '$CL/.env' '$W/env.before' && [[ ! -e '$CL/.env.new' && ! -e '$CL/ops/env.prev' ]] && ! grep -qE '^docker compose (up|rm|restart|--profile)' '$S/calls.log'"
    check "bad value, $name: no token anywhere" test -z "$(token_in)"
  done <<EOF
hostname in upper case|$(tunnel_json "Koti.example.fi" "$TOKEN" "$AUD" "$TEAM")
hostname with a path|$(tunnel_json "$HOST/x" "$TOKEN" "$AUD" "$TEAM")
hostname of one label|$(tunnel_json koti "$TOKEN" "$AUD" "$TEAM")
hostname starting with a hyphen|$(tunnel_json "-koti.example.fi" "$TOKEN" "$AUD" "$TEAM")
hostname over 253 characters|$(tunnel_json "$(printf 'abcdefghij.%.0s' 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3)example.fi" "$TOKEN" "$AUD" "$TEAM")
token with a newline|$(tunnel_json "$HOST" "${TOKEN}@NL@APP_BASE_URL=https://paha.example" "$AUD" "$TEAM")
token with an escaped newline|$(tunnel_json "$HOST" "${TOKEN}\\nAPP_BASE_URL=https://paha.example" "$AUD" "$TEAM")
token with a space and a second key|$(tunnel_json "$HOST" "$TOKEN TRUST_PROXY=false" "$AUD" "$TEAM")
token with shell text|$(tunnel_json "$HOST" "$TOKEN\$(id)" "$AUD" "$TEAM")
token too short|$(tunnel_json "$HOST" "short-token" "$AUD" "$TEAM")
token over 2000 characters|$(tunnel_json "$HOST" "$TOKEN$(printf '%01900d' 0)" "$AUD" "$TEAM")
wrong team domain|$(tunnel_json "$HOST" "$TOKEN" "$AUD" "tiimi.example.com")
team domain with a tail|$(tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM.paha.example")
audience tag of 63 characters|$(tunnel_json "$HOST" "$TOKEN" "${AUD:1}" "$TEAM")
audience tag in upper case|$(tunnel_json "$HOST" "$TOKEN" "${AUD^^}" "$TEAM")
a key too many|$(tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM\",\"extra\":\"1")
keys in another order|{"hostname":"$HOST","want":"tunnel","tunnelToken":"$TOKEN","accessAud":"$AUD","teamDomain":"$TEAM"}
text after the line|$(tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM")@NL@{"want":"lan"}
an unknown want|{"want":"domain"}
not JSON|lan
a line over the cap|$(tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM")$(printf '%04200d' 0)
EOF
}

t_nothing_prepared() {
  lan_world
  tick
  check "want null: reported failed with its own summary" bash -c "grep -q '\"status\":\"failed\"' '$S/report.json' && grep -qF '\"summary\":\"Etäkäytön muutosta ei ole valmisteltu.\"' '$S/report.json'"
  check "want null: .env is the same file and nothing was started" bash -c "cmp -s '$CL/.env' '$W/env.before' && ! grep -qE '^docker compose (up|rm|restart|--profile)' '$S/calls.log'"
  lan_world; : >"$S/access"
  tick
  check "no answer from the app: reported failed, .env is the same file" bash -c "grep -q '\"status\":\"failed\"' '$S/report.json' && cmp -s '$CL/.env' '$W/env.before'"
}

t_unhealthy_puts_the_old_env_back() {
  lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; echo TRUST_PROXY=true >"$S/bad-when"
  tick
  check "never healthy: reported failed" reported failed
  check "never healthy: the summary says the old settings are back and work" summary "Sovellus ei käynnistynyt uusilla asetuksilla. Aiemmat asetukset palautettiin, ja sovellus toimii niillä."
  check "never healthy: .env is the old file again (600)" env_same
  check "never healthy: the app was started again with the old .env" bash -c "[[ \$(grep -c '^docker compose up -d --no-build\$' '$S/calls.log') == 2 ]] && cmp -s '$W/env.before' '$S/env.live'"
  check "never healthy: the tunnel the new settings started is removed" bash -c "[[ ! -e '$S/tunnel-up' ]] && grep -q '^docker compose --profile tunnel rm -sf tunnel\$' '$S/calls.log'"
  check "never healthy: no token is left anywhere" bash -c "[[ -z '$(token_in)' ]] && ! grep -qF '$TOKEN' '$CL/.env'"

  lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; touch "$S/unhealthy"
  tick
  check "app stays down: the summary says the old settings are back and the app does not answer" summary "Sovellus ei käynnistynyt uusilla asetuksilla. Aiemmat asetukset palautettiin, mutta sovellus ei vastaa."
  check "app stays down: .env is the old file again (600)" env_same

  lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; touch "$S/up-fails"
  tick
  check "compose up fails: reported failed, .env is the old file again (600)" bash -c "grep -q '\"status\":\"failed\"' '$S/report.json' && cmp -s '$CL/.env' '$W/env.before' && [[ \$(stat -c %a '$CL/.env') == 600 ]]"
}

t_lan_from_tunnel() {
  tunnel_world BIND_ADDRESS=192.0.2.10
  tick
  check "lan: reported ok" reported ok
  check "lan: the summary names the home network address" summary "Etäkäyttö on pois päältä. Uusi osoite: http://192.0.2.10:8081"
  check "lan: the five keys are gone" bash -c "! grep -qE '^(CLOUDFLARE_TUNNEL_TOKEN|COMPOSE_PROFILES|TRUST_PROXY|CF_ACCESS_AUD|CF_ACCESS_TEAM_DOMAIN)=' '$CL/.env'"
  check "lan: the address is the bind address and port, once" env_line APP_BASE_URL=http://192.0.2.10:8081
  check "lan: the other lines stay, mode 600" bash -c "grep -qx HOST_PORT=8081 '$CL/.env' && grep -qx 'DOMAIN=$HOST' '$CL/.env' && [[ \$(stat -c %a '$CL/.env') == 600 ]]"
  check "lan: the tunnel is removed before the app is made again" bash -c "[[ ! -e '$S/tunnel-up' ]] && [[ \$(grep -nE '^docker compose (--profile tunnel rm -sf tunnel|up -d --no-build)\$' '$S/calls.log' | cut -d' ' -f3 | tr '\n' ' ') == '--profile up ' ]]"
  check "lan: the app runs with the new .env" cmp -s "$CL/.env" "$S/env.live"
  check "lan: the report tells the new mode" grep -q '"mode":"lan"' "$S/report.json"
  check "lan: the old token is only in the kept copy of the old .env" test "$(token_in)" = "$CL/ops/env.prev "

  tunnel_world BIND_ADDRESS=0.0.0.0; tick
  check "lan, all addresses: this machine's first address" env_line APP_BASE_URL=http://192.0.2.44:8081
  tunnel_world; tick
  check "lan, this machine only: localhost" env_line APP_BASE_URL=http://localhost:8081
  check "lan, this machine only: the bind is written out" env_line BIND_ADDRESS=127.0.0.1
  tunnel_world BIND_ADDRESS=2001:db8::5; tick
  check "lan, an IPv6 address: in brackets" env_line "APP_BASE_URL=http://[2001:db8::5]:8081"
  tunnel_world "BIND_ADDRESS=bad address"; tick
  check "lan, an address that cannot be told: localhost, and remote access still goes off" bash -c "grep -qx APP_BASE_URL=http://localhost:8081 '$CL/.env' && grep -q '\"status\":\"ok\"' '$S/report.json'"

  tunnel_world BIND_ADDRESS=192.0.2.10; echo APP_BASE_URL=http://192.0.2.10:8081 >"$S/bad-when"; tick
  check "lan, never healthy: the tunnel settings are back and the tunnel runs again" bash -c "cmp -s '$CL/.env' '$W/env.before' && [[ -e '$S/tunnel-up' ]] && grep -q '\"status\":\"failed\"' '$S/report.json'"
}

# Behind the tunnel the app's port answers on this machine only, as in the installer's tunnel install, and the bind
# from before is kept in .env (ACCESS_LAN_BIND) for `lan`. Every report tells the address `lan` would give right now.
t_bind_behind_the_tunnel() {
  local ID=$ID
  lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; tick
  check "bind: behind the tunnel the port answers on this machine only" env_line BIND_ADDRESS=127.0.0.1
  check "bind: the bind from before is remembered" env_line ACCESS_LAN_BIND=192.0.2.10
  check "bind: the app was made again with both" cmp -s "$CL/.env" "$S/env.live"
  check "bind: the report in tunnel mode tells the address lan would give" lan_address http://192.0.2.10:8081
  check "bind: neither the token nor the audience tag is in the report" bash -c "! grep -qF -e '$TOKEN' -e '$AUD' '$S/report.json'"
  again 1 access "$(tunnel_json uusi.example.fi "$TOKEN" "$AUD" "$TEAM")"
  check "bind, a second tunnel: applied" bash -c "grep -q '\"status\":\"ok\"' '$S/report.json' && grep -qx APP_BASE_URL=https://uusi.example.fi '$CL/.env'"
  check "bind, a second tunnel: still this machine only" env_line BIND_ADDRESS=127.0.0.1
  check "bind, a second tunnel: the remembered bind is not overwritten" env_line ACCESS_LAN_BIND=192.0.2.10
  check "bind, a second tunnel: the report tells the same address" lan_address http://192.0.2.10:8081
  again 2 access '{"want":"lan"}'
  check "bind, lan: the summary names the address the reports promised" summary "Etäkäyttö on pois päältä. Uusi osoite: http://192.0.2.10:8081"
  check "bind, lan: the earlier bind is back" env_line BIND_ADDRESS=192.0.2.10
  check "bind, lan: nothing is remembered any more" bash -c "! grep -q '^ACCESS_LAN_BIND=' '$CL/.env'"
  check "bind, lan: the address is that bind and the port" env_line APP_BASE_URL=http://192.0.2.10:8081
  check "bind, lan: the app runs with that .env" cmp -s "$CL/.env" "$S/env.live"
  check "bind, lan: the report in lan mode tells the address too" bash -c "grep -q '\"mode\":\"lan\"' '$S/report.json' && grep -qF '\"lanAddress\":\"http://192.0.2.10:8081\"' '$S/report.json'"
  check "bind, lan: the token is only in the kept copy of the old .env" test "$(token_in)" = "$CL/ops/env.prev "

  # the app does not answer on the new bind: the old .env goes back whole, the bind with it
  lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; echo BIND_ADDRESS=127.0.0.1 >"$S/bad-when"; tick
  check "bind, the app does not answer: the old .env is back and the app runs with its bind" bash -c "cmp -s '$CL/.env' '$W/env.before' && grep -qx BIND_ADDRESS=192.0.2.10 '$S/env.live'"
  check "bind, the app does not answer: the failed report tells the home network address" bash -c "grep -q '\"status\":\"failed\"' '$S/report.json' && grep -qF '\"lanAddress\":\"http://192.0.2.10:8081\"' '$S/report.json'"

  # a remembered bind is believed only behind the tunnel: one left in another .env is replaced by the present bind
  new_world HOST_PORT=8081 BIND_ADDRESS=192.0.2.10 ACCESS_LAN_BIND=192.0.2.99; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; tick
  check "bind, a remembered bind left in a .env with no tunnel: the present bind is remembered, once" env_line ACCESS_LAN_BIND=192.0.2.10
  # one that is no address is never written again: the copy answers on this machine only
  new_world HOST_PORT=8081 COMPOSE_PROFILES=tunnel BIND_ADDRESS=127.0.0.1 "ACCESS_LAN_BIND=192.0.2.10 COMPOSE_FILE=/x"; echo '{"want":"lan"}' >"$S/access"; tick
  check "bind, a remembered bind that is no address: lan is applied on this machine only" bash -c "grep -q '\"status\":\"ok\"' '$S/report.json' && grep -qx BIND_ADDRESS=127.0.0.1 '$CL/.env' && grep -qx APP_BASE_URL=http://localhost:8081 '$CL/.env'"
  check "bind, a remembered bind that is no address: its text is gone from .env" bash -c "! grep -qE 'COMPOSE_FILE|ACCESS_LAN_BIND' '$CL/.env'"
}

# Must fix 2 of the review: a copy that answered on this machine only is reachable from nowhere else once remote access
# goes off, so the report says where `lan` leads while the tunnel is still up.
t_lan_address_of_a_local_copy() {
  local ID=$ID
  new_world HOST_PORT=8081 BIND_ADDRESS=127.0.0.1 APP_BASE_URL=http://localhost:8081; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; tick
  check "local copy behind the tunnel: the report tells that lan leads to localhost" lan_address http://localhost:8081
  check "local copy behind the tunnel: the bind stays, and it is the one remembered" bash -c "grep -qx BIND_ADDRESS=127.0.0.1 '$CL/.env' && grep -qx ACCESS_LAN_BIND=127.0.0.1 '$CL/.env'"
  again 1 access '{"want":"lan"}'
  check "local copy, lan: this machine only, at localhost" bash -c "grep -qx BIND_ADDRESS=127.0.0.1 '$CL/.env' && grep -qx APP_BASE_URL=http://localhost:8081 '$CL/.env'"
  check "local copy, lan: the report tells mode local and the same address" bash -c "grep -q '\"mode\":\"local\"' '$S/report.json' && grep -qF '\"lanAddress\":\"http://localhost:8081\"' '$S/report.json'"
  # the installer's tunnel install: no bind is remembered, and the one in .env is this machine
  tunnel_world BIND_ADDRESS=127.0.0.1; request restart; tick
  check "the installer's tunnel install: a report of any action tells localhost" bash -c "grep -q '\"mode\":\"tunnel\"' '$S/report.json' && grep -qF '\"lanAddress\":\"http://localhost:8081\"' '$S/report.json'"
  check "the installer's tunnel install: no token in that report" test -z "$(token_in)"
}

# The address is in the report of every action and in every mode, by the rule `lan` uses. Each line: name|the lines of
# .env beside the port|the address.
t_lan_address_in_every_report() {
  local name env want
  while IFS='|' read -r name env want; do
    # shellcheck disable=SC2086 # the lines of .env, split at the spaces
    new_world HOST_PORT=8081 $env; request restart; tick
    check "lanAddress, $name: $want" lan_address "$want"
  done <<'EOF'
a home network address|BIND_ADDRESS=192.0.2.10|http://192.0.2.10:8081
all addresses, this machine's first one|BIND_ADDRESS=0.0.0.0|http://192.0.2.44:8081
an IPv6 address, in brackets|BIND_ADDRESS=2001:db8::5|http://[2001:db8::5]:8081
the IPv6 loopback|BIND_ADDRESS=::1|http://localhost:8081
no bind in .env|OTHER_KEY=stays|http://localhost:8081
a bind that is no address|BIND_ADDRESS=koti.example.fi|http://localhost:8081
a bind of one colon|BIND_ADDRESS=:|http://localhost:8081
an install with its own domain|COMPOSE_PROFILES=caddy DOMAIN=oma.example.fi|http://localhost:8081
a remembered bind in a .env with no tunnel is not believed|BIND_ADDRESS=192.0.2.10 ACCESS_LAN_BIND=192.0.2.99|http://192.0.2.10:8081
behind the tunnel, the remembered bind|COMPOSE_PROFILES=tunnel BIND_ADDRESS=127.0.0.1 ACCESS_LAN_BIND=192.0.2.10|http://192.0.2.10:8081
behind the tunnel, a remembered bind with a mask|COMPOSE_PROFILES=tunnel BIND_ADDRESS=127.0.0.1 ACCESS_LAN_BIND=192.0.2.10/24|http://localhost:8081
behind the tunnel, a remembered bind over 45 characters|COMPOSE_PROFILES=tunnel BIND_ADDRESS=127.0.0.1 ACCESS_LAN_BIND=2001:db8:0000:0000:0000:0000:0000:0000:0000:0005|http://localhost:8081
EOF
  new_world HOST_PORT=abc BIND_ADDRESS=192.0.2.10; request restart; tick
  check "lanAddress, a port that is no number: the report goes out without it" bash -c "grep -q '\"status\":\"ok\"' '$S/report.json' && grep -q '\"mode\":\"lan\"' '$S/report.json' && ! grep -q lanAddress '$S/report.json'"
}

t_refused() {
  lan_world; request port; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"
  tick
  check "port: still refused" bash -c "grep -q '\"status\":\"failed\"' '$S/report.json' && grep -qF '\"summary\":\"Tuntematon toiminto.\"' '$S/report.json'"
  check "port: nothing was read or run for it, .env is the same file" bash -c "cmp -s '$CL/.env' '$W/env.before' && ! grep -qE 'ops access|^docker compose (up|rm|restart|--profile)' '$S/calls.log'"

  new_world HOST_PORT=8081 COMPOSE_PROFILES=caddy DOMAIN=oma.example.fi APP_BASE_URL=https://oma.example.fi; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"
  tick
  check "an install with its own domain: refused, .env is the same file" bash -c "grep -q '\"status\":\"failed\"' '$S/report.json' && grep -q 'ei muutettu' '$S/report.json' && cmp -s '$CL/.env' '$W/env.before' && ! grep -qE '^docker compose (up|rm|--profile)' '$S/calls.log'"
}

# a refused change: reported failed with "ei muutettu", .env the same file, no copy kept, nothing stopped or started
untouched() { reported failed && grep -q 'ei muutettu' "$S/report.json" && cmp -s "$CL/.env" "$W/env.before" && [[ ! -e $CL/.env.new && ! -e $CL/ops/env.prev ]] && ! grep -qE '^docker compose (up|rm|restart|--profile)' "$S/calls.log"; }

# What a hostile app could print for `ops access`. Each line: name|the value it replaces (host, token, team, or raw for
# the whole line)|the value as printf %b reads it. @HOST@, @TOKEN@, @AUD@ and @TEAM@ are the valid values.
t_hostile_values_change_nothing() {
  local name field value line a20=aaaaaaaaaaaaaaaaaaaa a64
  a64=$(printf 'a%.0s' {1..64})
  while IFS='|' read -r name field value; do
    case $field in
      host) line=$(tunnel_json "$value" @TOKEN@ @AUD@ @TEAM@) ;;
      token) line=$(tunnel_json @HOST@ "$value" @AUD@ @TEAM@) ;;
      team) line=$(tunnel_json @HOST@ @TOKEN@ @AUD@ "$value") ;;
      *) line=$value ;;
    esac
    line=${line//@HOST@/$HOST}; line=${line//@TOKEN@/$TOKEN}; line=${line//@AUD@/$AUD}; line=${line//@TEAM@/$TEAM}; line=${line//@A20@/$a20}; line=${line//@A64@/$a64}
    lan_world; printf '%b\n' "$line" >"$S/access"
    tick
    check "hostile, $name: refused, nothing changed or started" untouched
    check "hostile, $name: no token anywhere" test -z "$(token_in)"
  done <<'EOF'
hostname that is an IPv4 address|host|127.0.0.1
hostname that is a link-local address|host|169.254.169.254
hostname with a number as its last label|host|koti.example.123
hostname with a dot at its end|host|koti.example.fi.
hostname with an underscore|host|ko_ti.example.fi
hostname with a Cyrillic look-alike|host|k\xd0\xbeti.example.fi
hostname with a JSON escape|host|k\\u006fti.example.fi
hostname with a port|host|koti.example.fi:8443
hostname with a user part|host|a@koti.example.fi
hostname with a label of 64 characters|host|@A64@.example.fi
token with a hash|token|@A20@#x
token with a semicolon|token|@A20@;id
token with a backtick|token|@A20@`id`
token with a dot|token|@A20@.x
token with a plus and a slash|token|@A20@+/x
token with a tab|token|@A20@\tx
token with a carriage return|token|@A20@\rx
team domain of two labels|team|a.b.cloudflareaccess.com
lan with a carriage return|raw|{"want":"lan"}\r
lan with a space|raw|{"want": "lan"}
lan twice|raw|{"want":"lan"}\n{"want":"lan"}
a byte order mark|raw|\xef\xbb\xbf{"want":"lan"}
the want key twice|raw|{"want":"lan","want":"tunnel","hostname":"@HOST@","tunnelToken":"@TOKEN@","accessAud":"@AUD@","teamDomain":"@TEAM@"}
a number for a string|raw|{"want":"tunnel","hostname":1,"tunnelToken":"@TOKEN@","accessAud":"@AUD@","teamDomain":"@TEAM@"}
a COMPOSE_FILE key|raw|{"want":"tunnel","hostname":"@HOST@","tunnelToken":"@TOKEN@","accessAud":"@AUD@","teamDomain":"@TEAM@","COMPOSE_FILE":"/x"}
EOF
  lan_world; head -c 10000000 /dev/zero | tr '\0' a >"$S/access"; tick
  check "hostile, 10 MB of output: refused, nothing changed or started" untouched
  lan_world; { tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" | tr -d '\n'; head -c 5000000 /dev/zero | tr '\0' a; } >"$S/access"; tick
  check "hostile, a valid line with 5 MB after it: refused, nothing changed or started" untouched
  check "hostile, a valid line with 5 MB after it: no token anywhere" test -z "$(token_in)"
}

t_library_does_not_load() {
  local how
  for how in missing broken; do
    lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"
    if [[ $how == missing ]]; then rm "$CL/scripts/lib/ops-access.sh"; else echo 'if ((' >>"$CL/scripts/lib/ops-access.sh"; fi
    tick
    check "library $how: reported failed, with a summary that says why" summary "Etäkäytön muutosta ei voitu tehdä: osa apurista puuttuu. Mitään ei muutettu."
    check "library $how: nothing changed or started" untouched
    check "library $how: the report still tells the mode, with no address for lan" bash -c "grep -q '\"mode\":\"lan\"' '$S/report.json' && ! grep -q lanAddress '$S/report.json'"
  done
}

t_cut_short_access() {
  local cut="Apuri keskeytyi kesken etäkäytön muutoksen."
  # killed while the containers were made again, and no container runs when the next tick comes
  lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; touch "$S/kill-on-up"; killed_tick; touch "$S/app-down"
  check "cut short: the killed tick left the request open, with the new .env written" bash -c "grep -q '\"reported\":false' '$CL/ops/journal/$ID.json' && [[ ! -e '$CL/ops/journal/$ID.result' ]] && grep -qx 'COMPOSE_PROFILES=tunnel' '$CL/.env'"
  tick
  check "cut short: no version rollback" no_rollback
  check "cut short: the containers were started again with the new .env, and the tunnel runs" bash -c "[[ \$(grep -c '^docker compose up -d --no-build\$' '$S/calls.log') == 1 && -e '$S/tunnel-up' ]] && cmp -s '$CL/.env' '$S/env.live' && grep -qx 'COMPOSE_PROFILES=tunnel' '$CL/.env'"
  check "cut short: reported failed" reported failed
  check "cut short: the summary says the new settings are in use" summary "$cut Uudet asetukset ovat käytössä, ja sovellus toimii niillä. Osoite: https://$HOST"
  check "cut short: no token in the journal, the logs, the output, the report or a command line" test -z "$(token_in)"

  # the same, and the app never answers with the new settings
  lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; echo TRUST_PROXY=true >"$S/bad-when"; touch "$S/kill-on-up"; killed_tick; touch "$S/app-down"
  tick
  check "cut short, never healthy: no version rollback" no_rollback
  check "cut short, never healthy: .env is the old file again (600), the app runs with it, the tunnel is gone" bash -c "cmp -s '$CL/.env' '$W/env.before' && [[ \$(stat -c %a '$CL/.env') == 600 && ! -e '$CL/.env.new' && ! -e '$S/tunnel-up' ]] && cmp -s '$W/env.before' '$S/env.live'"
  check "cut short, never healthy: the summary says the old settings are back" summary "$cut Sovellus ei käynnistynyt uusilla asetuksilla. Aiemmat asetukset palautettiin, ja sovellus toimii niillä."

  # the same, and the owner has changed .env by hand before the next tick
  lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; echo TRUST_PROXY=true >"$S/bad-when"; touch "$S/kill-on-up"; killed_tick; echo OWNER_EDIT=1 >>"$CL/.env"
  tick
  check "cut short, a hand edit since: the owner's file is left as it is" bash -c "grep -qx OWNER_EDIT=1 '$CL/.env' && grep -qx 'COMPOSE_PROFILES=tunnel' '$CL/.env' && cmp -s '$CL/ops/env.prev' '$W/env.before'"
  check "cut short, a hand edit since: the summary says so and names the kept copy" summary "$cut Tiedostoa .env on sen jälkeen muutettu käsin, eikä siihen koskettu. Sovellus ei vastaa. Aiemmat asetukset ovat palvelimella tiedostossa ops/env.prev."

  # to the home network, killed right after the tunnel was removed: .env still asks for the tunnel and for Access
  tunnel_world BIND_ADDRESS=192.0.2.10; touch "$S/kill-on-rm"; killed_tick
  check "cut short after the tunnel was removed: the killed tick left no tunnel" test ! -e "$S/tunnel-up"
  tick
  check "cut short after the tunnel was removed: .env is the same file and the tunnel runs again" bash -c "cmp -s '$CL/.env' '$W/env.before' && [[ -e '$S/tunnel-up' ]]"
  check "cut short after the tunnel was removed: the summary says the old settings are in use" summary "$cut Aiemmat asetukset ovat käytössä, ja sovellus toimii niillä."
}

# an open request in the journal, as a killed helper leaves it
cut_journal() { mkdir -p "$CL/ops/journal"; chmod 700 "$CL/ops/journal"; printf '{"id":"%s","action":"%s","started":"2026-01-01T00:00:00Z","reported":false}\n' "$ID" "$1" >"$CL/ops/journal/$ID.json"; }
t_cut_short_other_actions() {
  lan_world; request restart; touch "$S/kill-on-restart"; killed_tick
  check "restart cut short: the killed tick left the app down" test -e "$S/app-down"
  tick
  check "restart cut short: no version rollback" no_rollback
  check "restart cut short: the containers were started, .env is the same file" bash -c "[[ \$(grep -c '^docker compose up -d --no-build\$' '$S/calls.log') == 1 && ! -e '$S/app-down' ]] && cmp -s '$CL/.env' '$W/env.before'"
  check "restart cut short: reported failed" reported failed
  check "restart cut short: the summary says the app is up" summary "Apuri keskeytyi kesken uudelleenkäynnistyksen. Sovellus käynnistettiin, ja se vastaa."

  # any other action cut short with the app down is only finished as failed
  lan_world; rm -f "$S/poll"; cut_journal backup; touch "$S/app-down"; after_kill; tick
  check "backup cut short, app down: no version rollback, nothing started" bash -c "[[ \$(grep -cE '^update\\.sh|^docker compose (up|rm|restart)' '$S/calls.log') == 0 && ! -e '$CL/ops/RECOVERY.txt' ]]"
  check "backup cut short, app down: finished as failed" grep -q '"status":"failed".*"summary":"Apuri keskeytyi kesken toiminnon."' "$CL/ops/journal/$ID.result"

  # an update cut short with the app down still goes back to the previous version
  lan_world; rm -f "$S/poll"; cut_journal update; touch "$S/app-down"; after_kill; tick
  check "update cut short, app down: the previous version is asked for" test "$(n_calls '^update\.sh --rollback --yes$')" = 1
}

t_files_beside_env() {
  # a link where the helper keeps the old .env and one where it writes the new: neither is followed
  lan_world; chmod 644 "$CL/.env"; echo victim >"$W/victim"; ln -s "$W/victim" "$CL/ops/env.prev"; ln -s "$W/victim" "$CL/.env.new"
  tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; tick
  check "links: the change is applied and the file they point to is untouched" bash -c "grep -q '\"status\":\"ok\"' '$S/report.json' && [[ \$(cat '$W/victim') == victim ]]"
  check "links: .env and the kept copy are plain files of mode 600" bash -c "[[ ! -L '$CL/.env' && ! -L '$CL/ops/env.prev' && ! -e '$CL/.env.new' && \$(stat -c %a '$CL/.env' '$CL/ops/env.prev' | tr '\n' ' ') == '600 600 ' ]] && cmp -s '$CL/ops/env.prev' '$W/env.before'"

  # a .env.new left by a helper killed while it wrote holds the token: the next tick removes it, whatever it runs
  lan_world; echo "CLOUDFLARE_TUNNEL_TOKEN=$TOKEN" >"$CL/.env.new"; request restart; tick
  check "a stale .env.new is gone when a tick starts" bash -c "[[ ! -e '$CL/.env.new' ]] && grep -q '\"status\":\"ok\"' '$S/report.json'"

  # to the home network, and .env cannot be written: the tunnel that was stopped for the change runs again
  tunnel_world BIND_ADDRESS=192.0.2.10; mkdir "$CL/.env.new"; touch "$CL/.env.new/x"; tick
  check "lan, the write fails: .env is the same file and the tunnel runs again" bash -c "cmp -s '$CL/.env' '$W/env.before' && [[ -e '$S/tunnel-up' ]] && grep -q '^docker compose up -d --no-build\$' '$S/calls.log'"
  check "lan, the write fails: the summary says what happened" summary "Asetusten kirjoitus ei onnistunut. Asetuksia ei muutettu, ja tunneli on taas käynnissä."

  # the owner changes .env by hand while the helper waits for the app: the stub's sleep writes the line once
  lan_world; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; touch "$S/unhealthy"
  printf '#!/bin/sh\n[ -e "%s/edited" ] || { echo OWNER_EDIT=1 >>"%s/.env"; touch "%s/edited"; }\nexec /bin/sleep 0.01\n' "$S" "$CL" "$S" >"$S/bin/sleep"
  tick
  check "hand edit during the wait: the owner's file is left as it is and nothing is started again" bash -c "grep -qx OWNER_EDIT=1 '$CL/.env' && grep -qx 'COMPOSE_PROFILES=tunnel' '$CL/.env' && [[ \$(grep -c '^docker compose up -d --no-build\$' '$S/calls.log') == 1 ]]"
  check "hand edit during the wait: the summary says so and names the kept copy" summary "Sovellus ei käynnistynyt uusilla asetuksilla. Tiedostoa .env on sen jälkeen muutettu käsin, joten aiempia asetuksia ei palautettu. Ne ovat palvelimella tiedostossa ops/env.prev."
  check "hand edit during the wait: the kept copy is the old .env" cmp -s "$CL/ops/env.prev" "$W/env.before"
}

t_version_and_constructs() {
  check "the helper is version 5" test "$("$SRC/scripts/ops-helper.sh" --version)" = 5
  lan_world; traced; tunnel_json "$HOST" "$TOKEN" "$AUD" "$TEAM" >"$S/access"; tick
  check "the helper polls as version 5" test "$(n_calls 'dist/node.js ops poll --helper 5 ')" = 1
  # Every command of that tick, as bash expanded it. The token may only be in a test, an assignment, the pairs handed
  # to access_env_write and by it to the writer of .env (envfile_stage, a function like it), and the printf builtin that
  # writes its line of .env: any other command had it as an argument.
  check "access: the traced tick applied the change and the trace saw the token" bash -c "grep -q '\"status\":\"ok\"' '$S/report.json' && [[ \$(grep -cF '$TOKEN' '$S/trace') -ge 5 ]]"
  check "access: no other command ever holds the token" test "$(grep -F "$TOKEN" "$S/trace" | grep -cvE "^\\++ (\\[\\[ |[A-Za-z_]+=|access_env_write |envfile_stage |printf .%s\\\\n. CLOUDFLARE_TUNNEL_TOKEN=)")" = 0
  check "access: no eval, source, bash -c or sudo" bash -c "! grep -vE '^[[:space:]]*#' '$SRC/scripts/lib/ops-access.sh' | grep -nE '(^|[;&|(])[[:space:]]*(eval|source)[[:space:]]|bash -c|sudo '"
  # the values of a request may only meet bash builtins: no line of the file hands one to another program
  check "access: a value never goes on a command line" bash -c "! grep -nE '\\b(grep|sed|awk|cut|tr|head|tail|echo|docker|timeout|run_cap|in_app|cp|mv|cat|tee|logger|log|say_log)\\b[^|;]*\\\$\\{?(A_TOKEN|A_AUD|A_TEAM|pairs|out|line|pair|[htad])\\b' '$SRC/scripts/lib/ops-access.sh'"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
