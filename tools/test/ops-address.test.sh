#!/usr/bin/env bash
# Tests for scripts/lib/ops-address.sh: the helper follows the host to a new home network address. The world (clone,
# ticks, stub docker) is tools/test/ops-world.sh; this suite adds a stub `ip` that answers from $S/addrs (this machine's
# addresses, "ADDRESS [INTERFACE]" a line, eth0 when not named), $S/p2p (the interfaces with the POINTOPOINT flag) and
# $S/route (the default route's address), and a docker that remembers the .env the app was started with.
# The clock is the test's (set_clock, later in ops-world.sh): time passes only when a scenario says so, so every limit is
# tried one second under and one second over. `missing_for` writes ops/address-since as the ticks of that many seconds would have.
#
#   tools/test/ops-address.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by ops-world.sh (unprivileged)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged ops-address.test.sh "$@"

OLD=192.168.1.50; NEW=10.0.0.5
# net ADDRESS [ROUTE]: the address eth0 has now, and the one of the default route (the same unless given; it chooses nothing)
net() { printf '%s\n' "$1" >"$S/addrs"; printf '%s\n' "${2-$1}" >"$S/route"; }
# a home network install at OLD, as install.sh writes its .env, on a machine the router has moved to NEW
addr_world() { # addr_world [.env lines that replace or add]
  new_world; set_clock
  setenv '# Written by scripts/install.sh. Re-run the script to change.' "APP_BASE_URL=http://$OLD:8080" TRUST_PROXY=false COMPOSE_PROFILES= \
    COMPOSE_PROJECT_NAME=clone HOST_PORT=8080 DOMAIN= ACME_EMAIL= CLOUDFLARE_TUNNEL_TOKEN= TZ=Europe/Helsinki "BIND_ADDRESS=$OLD"
  local e; for e in "$@"; do sed -i "/^${e%%=*}=/d" "$CL/.env"; printf '%s\n' "$e" >>"$CL/.env"; done
  cp "$CL/.env" "$W/env.before"; cp "$CL/.env" "$S/env.live"
  cat >"$S/bin/ip" <<'EOF'
#!/usr/bin/env bash
S=$OPS_STUB_DIR; all="$*"
case "$all" in
  *"route get"*) r=$(cat "$S/route" 2>/dev/null); [[ -z $r ]] || echo "1.1.1.1 via 10.0.0.1 dev eth0 src $r uid 1000" ;;
  *"link show dev "*)
    d=${all##* dev }; d=${d%% *}; f=BROADCAST,MULTICAST; ! grep -qxF "$d" "$S/p2p" 2>/dev/null || f=POINTOPOINT,NOARP
    echo "2: $d: <$f,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\\    link/ether 02:00:00:00:00:01 brd ff:ff:ff:ff:ff:ff" ;;
  *"addr show"*)
    d=""; [[ $all != *" dev "* ]] || { d=${all##* dev }; d=${d%% *}; }
    [[ -n $d ]] || echo '3: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\       valid_lft forever preferred_lft forever'
    while read -r a i; do
      i=${i:-eth0}; [[ -z $a || (-n $d && $d != "$i") ]] || echo "2: $i    inet $a/24 scope global dynamic $i\\       valid_lft 600sec preferred_lft 600sec"
    done <"$S/addrs" ;;
esac
exit 0
EOF
  mv "$S/bin/docker" "$S/bin/docker.base"
  cat >"$S/bin/docker" <<'EOF'
#!/usr/bin/env bash
S=$OPS_STUB_DIR
if [[ "${1:-} ${2:-} ${3:-}" == "compose up -d" ]]; then
  cp .env "$S/env.live"
  # somebody edits .env while the app starts
  if [[ -e $S/hand-edit ]]; then echo "TZ=Europe/Stockholm" >>.env; rm -f "$S/hand-edit"; fi
fi
# an app started with the bind address in $S/no-start does not answer
if [[ "${1:-} ${2:-}" == "compose exec" && $* == *wget* && -s $S/no-start ]] && grep -qxF "BIND_ADDRESS=$(cat "$S/no-start")" "$S/env.live"; then exit 1; fi
exec "$S/bin/docker.base" "$@"
EOF
  chmod +x "$S/bin/ip" "$S/bin/docker"
  # the first tick of a world sends its snapshot and makes ops/; it finds the address on eth0 and keeps that name
  net "$OLD"; tick; : >"$S/calls.log"
  net "$NEW"
}
# the address has been missing for $1 seconds, and the latest tick that saw so was $2 seconds ago (a minute)
missing_for() { local now; now=$(<"$S/clock"); printf '%s %s %s\n' "$((now - $1))" "$((now - ${2:-60}))" "${3:-$OLD}" >"$CL/ops/address-since"; }
ups() { n_calls 'compose up -d --no-build'; }
env_line() { [[ $(grep -c "^${1%%=*}=" "$CL/.env") == 1 ]] && grep -qxF "$1" "$CL/.env"; } # the key once, with this value
env_same() { cmp -s "$CL/.env" "$W/env.before" && [[ $(stat -c %a "$CL/.env") == 600 && ! -e $CL/.env.new ]]; }
rebound() { env_line "BIND_ADDRESS=$NEW" && env_line "APP_BASE_URL=http://$NEW:8080"; }
told() { grep -c 'Osoite vaihtui: ' "$CL/ops/helper.log" || true; }
untouched() { env_same && [[ $(ups) == 0 && $(told) == 0 && ! -e $CL/ops/env.prev && ! -e $CL/ops/address-at ]]; }
# hold HOW: a process that holds the installer's lock until `release`: as update.sh holds it now (installer_lock), or as a
# release before 0.9.0 did (a flock on scripts/install.sh alone, fd 9). It says on a pipe that it has the lock (HELD is 0),
# so nothing here waits on a clock.
hold() {
  rm -f "$W/held" "$W/go"; mkfifo "$W/held" "$W/go"
  if [[ $1 == now ]]; then (cd "$CL" && . scripts/lib/release.sh && installer_lock; echo $? >"$W/held"; read -r _ <"$W/go") &
  else (cd "$CL" && exec 9<scripts/install.sh && flock -n 9; echo $? >"$W/held"; read -r _ <"$W/go") & fi
  lockpid=$!; read -r HELD <"$W/held"
}
release() { echo >"$W/go"; wait "$lockpid" 2>/dev/null; }

t_rebind_after_10_min() {
  addr_world
  check "while the address is there its interface is kept, and no count" bash -c "[[ \$(cat '$CL/ops/address-if') == 'eth0 $OLD' && ! -e '$CL/ops/address-since' ]]"
  tick
  check "first tick: the missing address is noted, nothing changes" bash -c "[[ -s '$CL/ops/address-since' ]]" && check "first tick: nothing changed" untouched
  missing_for 599; tick
  check "9 min 59 s: nothing changes" untouched
  missing_for 601; tick
  check "10 min: BIND_ADDRESS and APP_BASE_URL hold the new address" rebound
  check "10 min: the app was started once, with the new .env" bash -c "[[ $(ups) == 1 ]] && grep -qx 'BIND_ADDRESS=$NEW' '$S/env.live'"
  check "10 min: told in helper.log, once" bash -c "[[ $(told) == 1 ]] && grep -qE '^[0-9T:Z-]+ Osoite vaihtui: http://$NEW:8080\$' '$CL/ops/helper.log'"
  check "10 min: told in the journal (the tick's stderr)" grep -q "Osoite vaihtui: http://$NEW:8080" "$W/tick.out"
  check "10 min: the earlier .env is ops/env.prev, both mode 600" bash -c "cmp -s '$CL/ops/env.prev' '$W/env.before' && [[ \$(stat -c %a '$CL/.env' '$CL/ops/env.prev' | tr '\n' ' ') == '600 600 ' ]]"
  check "10 min: no request was made up and nothing is left half way" bash -c "[[ $(nreports) == 0 && ! -e '$CL/ops/address-doing' && ! -e '$CL/.env.new' ]] && ! ls '$CL/ops/journal' | grep . >/dev/null"
  : >"$S/calls.log"; tick; tick
  check "after: the next ticks change nothing and forget the count" bash -c "[[ $(ups) == 0 && $(told) == 1 && ! -e '$CL/ops/address-since' ]]"
  # a container that cannot start on the address that went away never reaches the poll: the tick still acts
  addr_world; rm -f "$S/running"; missing_for 700; tick
  check "app down: the address changes and the app is started" bash -c "[[ -e '$S/running' && $(told) == 1 ]]" && check "app down: .env holds the new address" rebound
  addr_world HOST_PORT=abc; missing_for 700; tick
  check "a HOST_PORT that is no port: nothing changes" env_same
}

t_rebind_needs_in_a_row() {
  addr_world; missing_for 599
  net "$OLD" "$NEW"; tick
  check "a tick that finds the address forgets the count" bash -c "[[ ! -e '$CL/ops/address-since' ]]"
  net "$NEW"; tick
  check "missing again: the count starts from this tick" bash -c "read -r a b c <'$CL/ops/address-since'; [[ \$a == \"\$b\" && \$c == $OLD ]]" && check "missing again: nothing changed" untouched
  missing_for 1200 301; tick
  check "a pause of over five minutes between two ticks starts the count again" untouched
  missing_for 1200 60 192.168.1.51; tick
  check "a count kept for another BIND_ADDRESS starts again" untouched
  echo "soon 1 $OLD" >"$CL/ops/address-since"; tick
  check "a count that is no time starts again" untouched
  missing_for 1200 299; tick
  check "ten minutes of ticks at most five minutes apart: the address changes" rebound
}

# The host's clock steps back a second or two (a time sync). Nothing may change on the strength of a clock that went back,
# and the count that was kept goes on once the time is there again.
t_rebind_clock_steps_back() {
  addr_world; missing_for 601; later -2; tick
  check "clock back 2 s from 10 min 1 s: 9 min 59 s are not enough, nothing changes" untouched
  later 2; tick
  check "clock back 2 s: the kept count goes on and the address changes at its 10 minutes" rebound
  addr_world; missing_for 1200 1; later -2; tick
  check "clock back past the latest tick: the count starts again, nothing changes" untouched
}

t_rebind_not_lan_mode() {
  local e
  for e in "COMPOSE_PROFILES=tunnel" "COMPOSE_PROFILES=caddy" "BIND_ADDRESS=127.0.0.1" "BIND_ADDRESS=0.0.0.0" "BIND_ADDRESS=192.0.2.10" "BIND_ADDRESS=" "BIND_ADDRESS=fd00::5"; do
    addr_world "$e"; missing_for 1200 60 "${e#*=}"; tick
    check "$e: nothing changes, and no count is kept" bash -c "[[ ! -e '$CL/ops/address-since' ]]" && check "$e: .env is as it was" untouched
  done
  addr_world COMPOSE_PROFILES=tunnel BIND_ADDRESS=127.0.0.1 "ACCESS_LAN_BIND=$OLD"; missing_for 1200; tick
  check "behind the tunnel the remembered home network address is not followed" untouched
}

# The scenario's name is the brief's, from when the default route chose the address. Now the interface the address was
# on does, and only a private address of RFC 1918 on it will do (with none there, a Docker bridge's is all that is left).
t_rebind_public_route_refused() {
  local r
  for r in 192.0.2.7 198.51.100.20 169.254.10.1 172.32.0.1 172.15.0.1 192.169.0.1 11.0.0.1 010.0.0.5 10.0.0.256 10.0.0 "" fd00::5; do
    addr_world; net "$r"; missing_for 1200; tick
    check "the interface's address is '${r:-nothing}': nothing changes" untouched
  done
  addr_world; net "$NEW" 192.0.2.7; missing_for 1200; tick
  check "a public default route chooses nothing: the interface's private address is followed" rebound
  addr_world; net "$NEW" ""; missing_for 1200; tick
  check "no default route: the interface's private address is followed" rebound
  addr_world; net 172.16.4.9; missing_for 1200; tick
  check "172.16/12 is a home network: the address changes" env_line BIND_ADDRESS=172.16.4.9
  addr_world; net 192.168.200.7; missing_for 1200; tick
  check "192.168/16 is a home network: the address changes" env_line APP_BASE_URL=http://192.168.200.7:8080
}

t_rebind_cgnat_refused() {
  local r
  for r in 100.64.0.5 100.100.20.3 100.127.255.254; do
    addr_world; net "$r"; missing_for 1200; tick
    check "the interface's address is $r (a carrier's shared range): nothing changes" untouched
  done
}

# the change follows only the interface the address was on, whatever the default route says (the review's cases)
t_rebind_same_interface() {
  local r
  # the lease changes on eth0 while a tunnel holds the default route
  addr_world; printf '%s\n' '192.168.1.77 eth0' '10.8.0.2 wg0' >"$S/addrs"; echo 10.8.0.2 >"$S/route"; missing_for 1200; tick
  check "a tunnel holds the default route: the bind goes to the new address of eth0" env_line BIND_ADDRESS=192.168.1.77
  check "tunnel: its address is nowhere in .env or the log" bash -c "! grep -q '10\.8\.0\.2' '$CL/.env' '$CL/ops/helper.log'"
  # the admin picked the address of a second network; that interface loses it, the other network holds the default route
  addr_world; echo "$OLD eth1" >"$S/addrs"; tick
  check "the interface of the address is kept in ops/address-if" bash -c "[[ \$(cat '$CL/ops/address-if') == 'eth1 $OLD' ]]"
  echo "$NEW eth0" >"$S/addrs"; missing_for 1200; tick
  check "the picked interface has no address, another network holds the default route: nothing changes" untouched
  # a machine carried elsewhere: its interface comes up with no private address, another one has one
  addr_world; printf '%s\n' '192.0.2.7 eth0' "$NEW wlan0" >"$S/addrs"; missing_for 1200; tick
  check "the kept interface has no private address, another has one: nothing changes" untouched
  addr_world; printf '%s\n' "$NEW eth0" '10.0.0.6 eth0' >"$S/addrs"; missing_for 1200; tick
  check "two private addresses on the kept interface: nothing changes" untouched
  # no kept interface (the address was gone before this helper ever saw it), or a file that does not name it for this address
  addr_world; rm -f "$CL/ops/address-if"; missing_for 1200; tick
  check "no kept interface: nothing changes" untouched
  for r in "eth0 192.168.1.51" "eth0" "-eth0 $OLD" "eth0 $OLD more" "wg0 $OLD" "tun3 $OLD" "ppp0 $OLD" "tap1 $OLD"; do
    addr_world; echo "$r" >"$CL/ops/address-if"
    case $r in eth0* | -*) ;; *) echo "$NEW ${r%% *}" >"$S/addrs" ;; esac
    missing_for 1200; tick
    check "ops/address-if '$r': nothing changes" untouched
  done
  # a tunnel or a point-to-point link is never kept
  addr_world; echo "$OLD wg0" >"$S/addrs"; tick
  check "an address on wg0: its interface is not kept" bash -c "[[ ! -e '$CL/ops/address-if' ]]"
  addr_world; echo "$OLD ens9" >"$S/addrs"; echo ens9 >"$S/p2p"; tick
  check "an address on a point-to-point link: its interface is not kept" bash -c "[[ ! -e '$CL/ops/address-if' ]]"
  addr_world; echo eth0 >"$S/p2p"; missing_for 1200; tick
  check "the kept interface is a point-to-point link now: nothing changes" untouched
}

t_rebind_not_during_request() {
  local lockpid
  # a request the helper was killed in: this tick finishes it as failed, and the address waits for the next one
  addr_world; missing_for 1200
  printf '{"id":"%s","action":"restart","started":"2026-01-01T00:00:00Z","reported":false}\n' "$ID" >"$CL/ops/journal/$ID.json"; tick
  check "a tick that settles a cut request changes no address" bash -c "[[ -f '$CL/ops/journal/$ID.result' ]]" && check "cut request: .env is as it was" untouched
  tick
  check "the tick after it does" rebound
  # an install, update, restore or reset run by hand holds the installer's lock
  addr_world; missing_for 1200
  ( exec 9<"$CL/scripts/install.sh"; flock 9 && exec sleep 60 ) & lockpid=$! # waits: the poll below takes the lock for a moment, and a holder that does not wait could lose it for good
  for _ in $(seq 50); do flock -n "$CL/scripts/install.sh" true || break; sleep 0.1; done
  tick
  check "the installer's lock is held: nothing changes, and it does not count as a try" untouched
  kill "$lockpid"; wait "$lockpid" 2>/dev/null; tick
  check "once the lock is free the address changes" rebound
  # the same once the merge of an update has put a new file under the name scripts/install.sh, while the lock is held the
  # way update.sh holds it now and the way a release before 0.9.0 did
  local how
  for how in now before-0.9.0; do
    addr_world; missing_for 1200; hold "$how"
    cp -p "$CL/scripts/install.sh" "$CL/scripts/install.sh.new"; echo "# a newer release" >>"$CL/scripts/install.sh.new"; mv -f "$CL/scripts/install.sh.new" "$CL/scripts/install.sh"
    tick
    check "lock held ($how), install.sh replaced by an update: the holder has it, nothing is changed and nothing restarted" test "$HELD" = 0 && check "lock held ($how): .env is as it was" untouched
    release; tick
    check "lock held ($how): once it is free the address changes" rebound
  done
  # a request that waits is run after the change, in the same tick
  addr_world; missing_for 1200; poll restart; tick
  check "a waiting request runs after the change" reported ok
  check "waiting request: the address changed first" bash -c "[[ $(told) == 1 ]]" && check "waiting request: .env holds the new address" rebound
}

t_rebind_once_an_hour() {
  local now
  addr_world; missing_for 1200; tick
  check "the first change is made" rebound
  # the next tick keeps the interface of the new address; then the router moves the machine again
  tick; cp "$CL/.env" "$W/env.before"; net 10.0.0.9; : >"$S/calls.log"; tick; missing_for 1200 60 "$NEW"; tick
  check "a second change within the hour waits" bash -c "cmp -s '$CL/.env' '$W/env.before' && [[ $(ups) == 0 && $(told) == 1 ]]"
  now=$(<"$S/clock"); echo $((now - 3599)) >"$CL/ops/address-at"; tick
  check "59 min 59 s: it still waits" cmp -s "$CL/.env" "$W/env.before"
  echo $((now - 3601)) >"$CL/ops/address-at"; tick
  check "over an hour: the address changes again" bash -c "grep -qx 'BIND_ADDRESS=10.0.0.9' '$CL/.env' && [[ $(told) == 2 ]]"
  addr_world; missing_for 1200; echo $(($(<"$S/clock") + 9000)) >"$CL/ops/address-at"; tick
  check "a time of the last change in the future holds nothing back" rebound
}

t_rebind_failure_puts_env_back() {
  addr_world; echo "$NEW" >"$S/no-start"; missing_for 1200; tick
  check "the app does not answer at the new address: .env is the earlier one again" env_same
  check "failure: the app was started twice, last with the earlier .env" bash -c "[[ $(ups) == 2 ]] && cmp -s '$S/env.live' '$W/env.before'"
  check "failure: the log says so and tells of no new address" bash -c "[[ $(told) == 0 ]] && grep -q 'address: the app did not start at http://$NEW:8080. The earlier settings were put back, and the app answers with them.' '$CL/ops/helper.log'"
  check "failure: nothing is left half way" bash -c "[[ ! -e '$CL/ops/address-doing' && -s '$CL/ops/address-at' ]]"
  : >"$S/calls.log"; tick; tick
  check "failure: the next ticks do not try again within the hour" bash -c "[[ $(ups) == 0 ]]" && check "failure: .env stays" env_same
  # `up` itself fails (the image is gone, Docker cannot bind)
  addr_world; touch "$S/failup"; rm -f "$S/running"; missing_for 1200; tick
  check "the start fails: .env is the earlier one again" env_same
  check "the start fails: the log says the app does not answer" grep -q 'The earlier settings were put back, but the app does not answer.' "$CL/ops/helper.log"
  # .env is changed by hand while the app starts: that file is theirs
  addr_world; echo "$NEW" >"$S/no-start"; touch "$S/hand-edit"; missing_for 1200; tick
  check "a .env changed by hand meanwhile is not replaced" bash -c "grep -qx 'TZ=Europe/Stockholm' '$CL/.env' && grep -qx 'BIND_ADDRESS=$NEW' '$CL/.env' && cmp -s '$CL/ops/env.prev' '$W/env.before'"
  check "by hand: the log names ops/env.prev" grep -q 'changed by hand since, so the earlier settings were not put back. They are in ops/env.prev.' "$CL/ops/helper.log"
}

# the helper is killed between writing .env and starting the app (a power cut): the next tick settles the change
t_rebind_cut_short_is_settled() {
  addr_world; missing_for 1200; tick
  : >"$CL/ops/address-doing"; rm -f "$S/running"; : >"$CL/ops/helper.log"; : >"$S/calls.log"; tick
  check "cut after .env was written: the app is started and the new address told" bash -c "[[ $(ups) == 1 && $(told) == 1 && -e '$S/running' && ! -e '$CL/ops/address-doing' ]]" && check "cut: .env holds the new address" rebound
  addr_world; missing_for 1200; tick
  : >"$CL/ops/address-doing"; echo "$NEW" >"$S/no-start"; : >"$CL/ops/helper.log"; : >"$S/calls.log"; tick
  check "cut, and the app does not answer at the new address: the earlier .env goes back" bash -c "[[ $(ups) == 2 && $(told) == 0 && ! -e '$CL/ops/address-doing' ]]" && check "cut: .env is the earlier one" env_same
  addr_world; : >"$CL/ops/address-doing"; rm -f "$S/running"; missing_for 1200; tick
  check "cut before .env was written: the app is started with .env as it is, and nothing is told" bash -c "[[ $(ups) == 1 && $(told) == 0 && -e '$S/running' && ! -e '$CL/ops/address-doing' ]]" && check "cut before: .env is as it was" env_same
  # one change made, then the helper is killed as a second one starts to write .env: the mark of the first must not tell of it
  addr_world; missing_for 1200; tick; tick
  cat >"$S/bin/rm" <<'EOF'
#!/usr/bin/env bash
if [[ $* == *.env.new*env.written && -e $OPS_STUB_DIR/kill-at-write ]]; then /bin/rm -f "$OPS_STUB_DIR/kill-at-write"; kill -9 "$PPID"; exit 1; fi
exec /bin/rm "$@"
EOF
  chmod +x "$S/bin/rm"; touch "$S/kill-at-write"
  cp "$CL/.env" "$W/env.before"; net 10.0.0.9; echo 0 >"$CL/ops/address-at"; missing_for 1200 60 "$NEW"; : >"$S/calls.log"; tick
  check "killed as the second change starts: .env is not written and the change is left open" bash -c "cmp -s '$CL/.env' '$W/env.before' && [[ -e '$CL/ops/address-doing' && ! -e '$S/kill-at-write' ]]"
  tick
  check "the next tick settles it and tells of no change that was not made" bash -c "[[ $(told) == 1 && ! -e '$CL/ops/address-doing' ]] && cmp -s '$CL/.env' '$W/env.before'"
}

# every key access_env_write drops is written back: the list is read from scripts/lib/ops-access.sh, so a key added there
# and forgotten here fails this
t_env_keys_all_kept() {
  local keys k n=0 lines=()
  keys=$(sed -n 's/^ACCESS_KEYS="\(.*\)"$/\1/p' "$SRC/scripts/lib/ops-access.sh")
  for k in $keys; do n=$((n + 1)); case $k in BIND_ADDRESS | APP_BASE_URL | COMPOSE_PROFILES) ;; *) lines+=("$k=value-$n") ;; esac; done
  check "the list of keys was found in ops-access.sh (BIND_ADDRESS and seven more)" bash -c "[[ $n -ge 8 && ' $keys ' == *' BIND_ADDRESS '* && ' $keys ' == *' APP_BASE_URL '* ]]"
  addr_world "${lines[@]}" "CADDY_ADDRESS=$OLD" OTHER_KEY=stays; missing_for 1200; tick
  check "the address changed" rebound
  for k in "${lines[@]}" COMPOSE_PROFILES= HOST_PORT=8080 COMPOSE_PROJECT_NAME=clone DOMAIN= ACME_EMAIL= TZ=Europe/Helsinki "CADDY_ADDRESS=$OLD" OTHER_KEY=stays; do
    check "kept as it was, once: $k" env_line "$k"
  done
  check "the comment line stays" grep -qx '# Written by scripts/install.sh. Re-run the script to change.' "$CL/.env"
  check "only BIND_ADDRESS and APP_BASE_URL differ from the earlier .env" bash -c "[[ \$(sort '$CL/.env' '$W/env.before' | uniq -u | cut -d= -f1 | sort -u | tr '\n' ' ') == 'APP_BASE_URL BIND_ADDRESS ' ]]"
  # an address someone typed in is not the installer's: it stays, and the bind address still follows
  addr_world APP_BASE_URL=http://koti.example.fi:8080; missing_for 1200; tick
  check "an APP_BASE_URL with a name stays, the bind address changes" bash -c "grep -qx 'BIND_ADDRESS=$NEW' '$CL/.env' && grep -qx 'APP_BASE_URL=http://koti.example.fi:8080' '$CL/.env' && [[ \$(grep -c '^APP_BASE_URL=' '$CL/.env') == 1 ]]"
  check "the log tells where the app answers now" grep -q "Osoite vaihtui: http://$NEW:8080" "$CL/ops/helper.log"
  addr_world; sed -i '/^APP_BASE_URL=/d' "$CL/.env"; missing_for 1200; tick
  check "a .env without APP_BASE_URL gets none" bash -c "grep -qx 'BIND_ADDRESS=$NEW' '$CL/.env' && ! grep -q '^APP_BASE_URL=' '$CL/.env'"
}

# with the launcher's --root the libs come from the copy's folder, and after a rollback inside a tick the files on disk are
# an older release's: the two files it needs are loaded from the helper's own folder when the helper loads its parts
# (host-addr.sh by the lib, ops-access.sh by load_libs, and by no other line), and the lib is quiet without them
own_folder() {
  [[ $(grep -cE '^\. "\$ADDR_LIB/host-addr\.sh"' "$SRC/scripts/lib/ops-address.sh") == 1 ]] || return 1
  [[ $(cat "$SRC/scripts/ops-helper.sh" "$SRC"/scripts/lib/ops-*.sh | grep -cE '^[^#]*\. [^ ]*ops-access\.sh') == 1 ]] || return 1
  grep -qE '^[^#]*\. "\$LIB/ops-access\.sh"' "$SRC/scripts/ops-helper.sh"
}
t_rebind_own_files() {
  addr_world; rm -f "$CL/scripts/lib/host-addr.sh"; missing_for 1200; tick
  check "without host-addr.sh the tick runs and changes nothing" bash -c "[[ $TICK_RC == 0 ]] && ! grep -q 'does not load' '$CL/ops/helper.log'" && check "no host-addr.sh: .env is as it was" env_same
  check "the two files are read from the folder of the helper's parts, when they load" own_folder
  addr_world; sed -i '/^host_addr_if() /d' "$CL/scripts/lib/host-addr.sh"; missing_for 1200; tick
  check "a host-addr.sh of an older release (one function short): the tick runs" bash -c "[[ $TICK_RC == 0 ]] && ! grep -q 'does not load' '$CL/ops/helper.log'" && check "older host-addr.sh: .env is as it was" env_same
  addr_world; printf 'watchdog_tick() { rm -f scripts/lib/host-addr.sh scripts/lib/ops-access.sh; }\n' >>"$CL/scripts/lib/ops-watchdog.sh"; missing_for 1200; tick
  check "files that leave the disk earlier in the tick (a rollback to an older release) do not stop the change" rebound
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
