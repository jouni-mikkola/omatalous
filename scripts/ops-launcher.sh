#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous launcher of the maintenance helper. The timer or the cron line of an instance runs this file, once a
# minute. It lives outside the clone, in ~/.local/share/omatalous/<instance>/launcher.sh, where
# ./scripts/install.sh --ops-helper puts it, so an update of the clone never touches the file the timer runs.
#
#   launcher.sh CLONE     one tick: the clone's scripts/ops-helper.sh, or the last good copy of it
#
# The clone's helper runs when it and every file under scripts/lib parse (bash -n). After a tick that ended well
# (exit 0) the helper and scripts/lib are copied to last-good/ beside this file, when they differ from the copy and
# the helper passes its own test (ops-helper.sh --self-test): the copy is a helper that was seen to work. When
# the clone's helper is missing or does not parse, for instance after an update that went wrong, the copy runs for
# the clone instead (ops-helper.sh --root CLONE) and one line in the clone's ops/helper.log says so. Päivitä and
# Palauta edellinen then still work from the browser. With no copy yet nothing runs and one line says why.
#
# Trust: this file runs as the helper's user, who is in the docker group, which is root on the host. It refuses to run
# as root. It takes one argument, the clone, and nothing from a request or the database. It runs no file, of the clone
# or of the copy, that someone else owns or that group or others can write to (a symbolic link never passes), and its
# own commands come from a fixed PATH. The helper makes its own, wider check after that.
#
# A change here needs a higher LAUNCHER_VERSION: the installer replaces an installed launcher only by a higher one.
# ──────────────────────────────────────────────────────────────────────────────
# shellcheck disable=SC2034 # read by the installer (ops_launcher_version, scripts/lib/ops-schedule.sh)
LAUNCHER_VERSION=2
set -u -o pipefail
set +x
umask 077
# the caller's PATH goes on to the helper, which builds its own environment; the launcher's commands use this one
OPATH=${PATH:-}
PATH=/usr/local/bin:/usr/bin:/bin
HERE=""
WHY=""

# owned by this user, and not writable by group or others
safe() {
  local o m
  read -r o m < <(stat -c '%u %a' "$1" 2>/dev/null) || return 1
  [[ $o == "$EUID" ]] && (((8#$m & 8#022) == 0))
}

# One line for whoever looks: on stderr (the journal of a systemd timer) and in the clone's ops/helper.log, among the
# helper's own lines. When the clone's ops folder is missing or not this user's alone, it goes to launcher.log beside
# this file instead. The same text goes to the log once in ten minutes, so that a helper broken for days leaves the
# log its lines that say why: the file .note beside this one holds the newest text (doctor.sh reads it), and a tick
# that runs the clone's helper removes it.
note() { # note CLONE TEXT
  local line f=$HERE/launcher.log s=$HERE/.note
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $2"
  printf '%s\n' "$line" >&2
  [[ $2 != "$(cat "$s" 2>/dev/null)" ]] || (($(date +%s) - $(stat -c %Y "$s" 2>/dev/null || echo 0) >= 600)) || return 0
  printf '%s\n' "$2" >"$s" 2>/dev/null || true
  if safe "$1" && safe "$1/ops" && [[ ! -L $1/ops/helper.log ]]; then f=$1/ops/helper.log; fi
  if [[ -f $f && $(stat -c %s "$f" 2>/dev/null || echo 0) -gt 262144 ]]; then mv -f "$f" "$f.1"; fi
  printf '%s\n' "$line" >>"$f" 2>/dev/null || true
}

# usable DIR: the helper under DIR and every file of DIR/scripts/lib can be run: it is there, this user's alone, and
# it parses. Sets WHY to the reason when not. Nothing of DIR is run here (bash -n only reads).
usable() {
  local d=$1 f
  WHY=""
  [[ -f $d/scripts/ops-helper.sh ]] || { WHY="scripts/ops-helper.sh is missing"; return 1; }
  [[ -d $d/scripts/lib ]] || { WHY="scripts/lib is missing"; return 1; }
  for f in "$d" "$d/scripts" "$d/scripts/lib" "$d/scripts/ops-helper.sh" "$d"/scripts/lib/*.sh; do
    [[ -e $f || -L $f ]] || { WHY="scripts/lib is empty"; return 1; }
    [[ $f == "$d" || ${f##*/} =~ ^[A-Za-z0-9_.-]+$ ]] || { WHY="a file in scripts/lib has an odd name"; return 1; }
    safe "$f" || { WHY="${f#"$d"/} is owned by someone else or writable by others"; return 1; }
    [[ -d $f ]] || bash -n "$f" 2>/dev/null || { WHY="${f#"$d"/} does not parse"; return 1; }
  done
  return 0
}

# one hash over the helper and the libs under DIR, names and contents (empty when DIR cannot be read)
hash_of() { (cd "$1" 2>/dev/null && sha256sum scripts/ops-helper.sh scripts/lib/*.sh 2>/dev/null | sha256sum | cut -d' ' -f1) || true; }

# the hash of the last good copy; empty when its files no longer match the hash kept with them (a file cut to nothing
# by a power cut parses, and would run as nothing)
copy_hash() {
  local h
  h=$(hash_of "$HERE/last-good")
  [[ -n $h && $h == "$(cat "$HERE/last-good/.hash" 2>/dev/null)" ]] && printf '%s' "$h"
}

# passes CLONE HASH: the clone's helper answers its own test with "self-test ok" (ops-helper.sh --self-test: its files,
# Docker, the app's answers). A tick that ends 0 is no proof: it ends 0 when Docker does not respond, and a helper from
# before the launcher does not know --root. The test takes a while and writes a line to the helper's log, so a helper
# that failed it is asked again on every tenth tick only: .failed beside this file holds its hash and the ticks since.
passes() {
  local out was="" n=0 f=$HERE/.failed
  { read -r was n <"$f"; } 2>/dev/null || true # the braces: a missing file fails at the "<", before a 2> on read itself applies
  if [[ $was == "$2" && $n =~ ^[1-9]$ ]]; then printf '%s %s\n' "$2" "$((n + 1))" >"$f"; return 1; fi
  if out=$(PATH=$OPATH timeout -k 10 300 /bin/bash "$1/scripts/ops-helper.sh" --self-test 2>/dev/null) && [[ $out == "self-test ok" ]]; then
    rm -f "$f"; return 0
  fi
  printf '%s 1\n' "$2" >"$f"
  return 1
}

# keep CLONE HASH: the helper that just ran well becomes the last good copy, when it differs from the copy and passes
# its own test. One that fails the test leaves the earlier copy in place. HASH is what the files were before the tick:
# when the tick changed them (an update), the new ones have not run yet and the next tick decides. The copy is checked
# the way a clone is before it takes the place of the old one.
keep() {
  local root=$1 h new=$HERE/last-good.new
  h=$(hash_of "$root")
  [[ -n $h && $h == "$2" && $h != "$(copy_hash)" ]] || return 0
  exec 7>"$HERE/.lock"
  flock -n 7 || return 0
  rm -rf "$new"
  if passes "$root" "$h" && [[ $(hash_of "$root") == "$h" ]] && mkdir -p "$new/scripts/lib" && cp "$root/scripts/ops-helper.sh" "$new/scripts/" && cp "$root"/scripts/lib/*.sh "$new/scripts/lib/" \
    && chmod -R u+rwX,go-rwx "$new" && [[ $(hash_of "$new") == "$h" ]] && usable "$new" && printf '%s\n' "$h" >"$new/.hash"; then
    rm -rf "$HERE/last-good.old"
    [[ ! -d $HERE/last-good ]] || mv "$HERE/last-good" "$HERE/last-good.old"
    mv "$new" "$HERE/last-good" && rm -rf "$HERE/last-good.old"
  else
    rm -rf "$new"
  fi
  exec 7>&-
}

main() {
  local root="" rc before busy=false why lost=""
  [[ $EUID -ne 0 ]] || { echo "The launcher of the maintenance helper does not run as root." >&2; exit 1; }
  # the folder itself, not a symbolic link to it (~/omatalous -> /mnt/disk/omatalous): the checks below read the owner
  # and mode of what they are given, and a link is never this user's alone
  if (($# == 1)) && [[ $1 == /* ]]; then root=$(readlink -f -- "$1" 2>/dev/null || printf '%s' "$1"); fi
  [[ $root =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "Usage: launcher.sh CLONE   (the absolute path of the Omatalous folder)" >&2; exit 2; }
  HERE=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
  # only the installed file runs: beside a clone's scripts it would keep its copy inside the clone
  if [[ ${BASH_SOURCE[0]##*/} != launcher.sh ]] || ! safe "$HERE" || ! safe "$HERE/launcher.sh"; then
    echo "The launcher runs from its own folder, which only this user may write to. Run: ./scripts/install.sh --ops-helper" >&2; exit 1
  fi
  # a swap of the copy that was cut short
  [[ -d $HERE/last-good || ! -d $HERE/last-good.old ]] || mv "$HERE/last-good.old" "$HERE/last-good"
  if [[ ! -d $root ]]; then
    note "$root" "launcher: the folder $root is missing, so the maintenance helper has nothing to run on. The last good copy is kept."
    exit 1
  fi
  if usable "$root"; then
    [[ ! -e $HERE/.note ]] || rm -f "$HERE/.note"
    # a tick that is still running holds the helper's lock and this one ends at once: that is no proof of a good helper
    if [[ -f $root/ops/.lock && ! -L $root/ops/.lock ]] && safe "$root/ops" && ! flock -n -s "$root/ops/.lock" true; then busy=true; fi
    before=$(hash_of "$root")
    PATH=$OPATH /bin/bash "$root/scripts/ops-helper.sh"; rc=$?
    if ((rc == 0)) && ! $busy; then keep "$root" "$before" || true; fi
    exit "$rc"
  fi
  why=$WHY
  if [[ ! -d $HERE/last-good ]]; then lost="there is no last good copy of it yet"
  elif ! usable "$HERE/last-good"; then lost="the last good copy of it cannot be run either ($WHY)"
  elif [[ -z $(copy_hash) ]]; then lost="the last good copy of it is damaged (its files do not match the hash kept with them)"; fi
  if [[ -n $lost ]]; then
    note "$root" "launcher: the helper of this folder cannot be run ($why) and $lost. Nothing runs. Run: ./scripts/update.sh"
    exit 1
  fi
  note "$root" "launcher: the helper of this folder cannot be run ($why). The last good copy of it runs instead; update or go back to the previous version to get a working one."
  PATH=$OPATH exec /bin/bash "$HERE/last-good/scripts/ops-helper.sh" --root "$root"
}
main "$@"
