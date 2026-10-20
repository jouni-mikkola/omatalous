# shellcheck shell=bash
# What this machine's own network says about its addresses, for scripts/install.sh and for the maintenance helper's
# follow-up of the home network address (scripts/lib/ops-address.sh). It defines functions and nothing else, reads only
# the `ip` command and needs no function of the script that loads it.

# global addresses of this host, one per line (no loopback, link-local or Docker bridges)
host_addrs() { ip -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth)/ {split($4, a, "/"); print a[1]}'; }
# the source address of the default route (what other devices on the network reach this machine by)
default_route_addr() { ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}' || true; }
# host_has_addr ADDRESS: is it one of host_addrs, compared in lowercase and without brackets and zone
host_has_addr() {
  local want=${1,,} a addrs
  want=${want#\[}; want=${want%\]}; want=${want%%\%*}
  # no pipe into grep -q: it exits at the first match and the writer gets SIGPIPE, which fails under pipefail
  addrs=$(host_addrs)
  while IFS= read -r a; do
    [[ -n $a && ${a,,} == "$want" ]] && return 0
  done <<<"$addrs"
  return 1
}
# host_addr_if ADDRESS: the name of the interface, of those host_addrs lists, that holds this IPv4 address (nothing when none does)
host_addr_if() { ip -o -4 addr show scope global 2>/dev/null | awk -v w="$1" '$2 !~ /^(docker|br-|veth)/ && !n {split($4, a, "/"); if (a[1] == w) {print $2; n = 1}}'; }
# host_if_addrs INTERFACE: the IPv4 addresses of that one interface, one per line
host_if_addrs() { ip -o -4 addr show dev "$1" scope global 2>/dev/null | awk '{split($4, a, "/"); print a[1]}'; }
# host_if_tunnel INTERFACE: is it a tunnel or a point-to-point link, by its name or by its flags. A name that is no plain
# interface name, a Docker bridge and an interface that cannot be read count as one.
host_if_tunnel() {
  local link
  [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9_.:-]{0,31}$ && ! $1 =~ ^(wg|tun|tap|ppp|tailscale|zt|vpn|ipsec|vti|gre|sit|ipip|docker|br-|veth) ]] || return 0
  link=$(ip -o link show dev "$1" 2>/dev/null) || return 0
  [[ -n $link && $link != *POINTOPOINT* ]] || return 0
  return 1
}
