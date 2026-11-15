# shellcheck shell=bash
# How the helper rewrites `.env` when the host's home network address changes (scripts/lib/ops-address.sh). Only the
# helper loads this file, once: in load_libs, from the helper's own folder, after check_permissions has passed on
# scripts/lib. It uses the helper's functions: env_get and the writer of .env (envfile_stage, envfile_commit and
# envfile_restore of envfile.sh), and host_addrs of host-addr.sh, which ops-address.sh loads.
#
# A tick runs without this file too: when it is missing or does not load whole, address_tick finds its functions
# missing and does nothing.
#
# `.env` is rewritten once, beside itself with mode 600 and a rename, each key once. The old file is kept as
# ops/env.prev (one generation, mode 600) and put back when the app does not answer with the new one. ops/env.written
# names the request that wrote `.env` and the checksum of what it wrote: the kept file only ever replaces that one, so
# a `.env` someone has changed by hand since stays theirs.

# an IPv4 address or an IPv6 address without a zone, at most 45 characters: what Compose takes as a port's host address
LAN_RE_BIND='^([0-9]{1,3}(\.[0-9]{1,3}){3}|[0-9A-Fa-f]*:[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*)$'

lan_is_addr() { local LC_ALL=C; ((${#1} <= 45)) && [[ $1 =~ $LAN_RE_BIND ]]; }

# The home network address by the installer's rule (install.sh): the bind address and the port `.env` holds, and this
# machine's first address when the app listens on all of them. Fails only when the port is not a number.
lan_url() {
  local port addr
  port=$(env_get HOST_PORT); port=${port:-8080}
  [[ $port =~ ^[0-9]{2,5}$ ]] || return 1
  addr=$(env_get BIND_ADDRESS)
  lan_is_addr "$addr" || addr=127.0.0.1
  case $addr in
    127.0.0.1 | ::1) addr=localhost ;;
    0.0.0.0 | ::) addr=$(host_addrs | head -1) ;;
  esac
  # an address that cannot be told is this machine itself
  [[ $addr == localhost ]] || lan_is_addr "$addr" || addr=localhost
  [[ $addr != *:* ]] || addr="[$addr]"
  printf 'http://%s:%s' "$addr" "$port"
}

# The two keys a change of the address owns in .env: every line of them leaves its place in a rewrite (lan_env_write).
LAN_ENV_KEYS="APP_BASE_URL BIND_ADDRESS"

# .env as it is now, kept as ops/env.prev (one generation, mode 600) before a rewrite
lan_env_keep() { rm -f "$OPS/env.prev" && cp .env "$OPS/env.prev" && chmod 600 "$OPS/env.prev"; }

# Rewrites .env once, through the one writer (scripts/lib/envfile.sh): every
# line of the keys goes, and the items given follow the other lines in the order given, each once. KEY=value sets a key
# and +KEY keeps it as .env has it. The other lines stay as they are (env_check passed them at the start of this tick).
# The request and the checksum of the new file go to ops/env.written before the rename (lan_env_state reads them).
lan_env_write() { # lan_env_write ID ITEM...
  local id=$1 k sum named=" " go=(); shift
  rm -f .env.new "$OPS/env.written" 2>/dev/null || return 1
  for k in "$@"; do k=${k#+}; named+="${k%%=*} "; done
  for k in $LAN_ENV_KEYS; do [[ $named == *" $k "* ]] || go+=("$k"); done
  envfile_stage .env end "$@" ${go[@]+"${go[@]}"} || return 1
  sum=$(sha256sum <.env.new) && [[ $sum =~ ^[0-9a-f]{64} ]] && printf '%s %s\n' "$id" "${sum%% *}" >"$OPS/env.written" || { rm -f .env.new; return 1; }
  envfile_commit .env 600
}

# What .env is after request ID: `new` when it is the file that request wrote, `old` when it is the one from before
# the request (nothing was written, or the kept file was put back), `hand` when someone has changed it since.
lan_env_state() { # lan_env_state ID
  local mark="" sum prev
  [[ ! -f $OPS/env.written ]] || mark=$(<"$OPS/env.written")
  [[ $mark == "$1 "* ]] || { echo old; return; }
  sum=$(sha256sum 2>/dev/null <.env); prev=$(sha256sum 2>/dev/null <"$OPS/env.prev")
  if [[ -n $sum && $mark == "$1 ${sum%% *}" ]]; then echo new; elif [[ -n $sum && $sum == "$prev" ]]; then echo old; else echo hand; fi
}
