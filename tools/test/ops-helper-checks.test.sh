#!/usr/bin/env bash
# The permission check and kv_get of scripts/ops-helper.sh against the code they replaced: the old bodies are kept
# here as the reference, the new ones are cut out of the helper, and both run on the same made-up trees and files.
#
#   tools/test/ops-helper-checks.test.sh [name-filter]
#
# The world file (tools/test/ops-world.sh) gives the check function and the unprivileged re-run; no world is built here.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged ops-helper-checks.test.sh "$@"

# The old bodies, kept as the reference (one stat and one id per path, grep | tail | cut per key). The new ones are cut out
# of the helper itself, so what is compared is what runs.
old_unsafe_path() {
  local o m
  read -r o m < <(stat -c '%u %a' "$1" 2>/dev/null) || return 0
  [[ $o == "$(id -u)" ]] || return 0
  (((8#$m & 8#022) != 0))
}
old_check_permissions() {
  local p
  for p in . .git .git/config scripts "$SELF" scripts/*.sh scripts/lib scripts/lib/*.sh "$OPS" .env "$OPS/policy" "$OPS/journal" "$OPS/run" backups/.last-update; do
    [[ -e $p ]] || continue
    if old_unsafe_path "$p"; then log "File permissions: $p is not safe (owner or write access). The helper does not run."; return 1; fi
  done
  for p in ${COPY[@]+"${COPY[@]}"}; do if [[ -e $p ]] && old_unsafe_path "$p"; then log "File permissions: $p is not safe (owner or write access). The helper does not run."; return 1; fi; done
  return 0
}
old_kv_get() { [[ -f $1 ]] && grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- || true; }
eval "$(sed -n '/^check_permissions() {/,/^}/p; /^kv_get() {/,/^}/p' "$SRC/scripts/ops-helper.sh")"

perm_run() { # perm_run FUNCTION DIR [COPY...]: what the function logs and returns with DIR as the clone, as "RC|OUTPUT"
  local f=$1 d=$2; shift 2
  (
    cd "$d" || exit 9
    PATH=${PERM_PATH:-$PATH}; COPY=("$@"); SELF=$d/scripts/ops-helper.sh; OPS=ops
    log() { printf '%s\n' "$*"; }
    out=$("$f"); echo "$?|$out"
  )
}
perm_tree() { # a clone the check accepts, in a new folder ($PT)
  local f
  PT=$(mktemp -d "$TMPBASE/p.XXXXXX"); chmod 700 "$PT"
  mkdir -p "$PT"/{.git,scripts/lib,ops/journal,ops/run,backups}
  for f in .git/config scripts/ops-helper.sh scripts/a.sh scripts/b.sh "scripts/c d.sh" $'scripts/e\nf.sh' scripts/lib/x.sh ops/policy .env backups/.last-update; do
    : >"$PT/$f"; chmod 600 "$PT/$f"
  done
  chmod 700 "$PT"/{.git,scripts,scripts/lib,ops,ops/journal,ops/run,backups}
}
perm_same() { # perm_same NAME EXPECTED DIR [COPY...]: old and new say the same, and EXPECTED is "ok" or the path they name
  local name=$1 want=$2 o n e; shift 2
  o=$(perm_run old_check_permissions "$@"); n=$(perm_run check_permissions "$@")
  e="0|"; [[ $want == ok ]] || e="1|File permissions: $want is not safe (owner or write access). The helper does not run."
  check "perms, old and new: $name: the same answer" test "$o" = "$n"
  check "perms, old and new: $name: the answer is ${want/#ok/accepted}" test "$n" = "$e"
}
t_permissions_as_before() {
  local PT me; me=$(id -u)
  mkdir -p "$TMPBASE/pid" "$TMPBASE/pstat"
  printf '#!/bin/sh\necho 4242\n' >"$TMPBASE/pid/id"
  printf '#!/bin/bash\na=(); for x in "$@"; do [[ $x == "$PERM_DROP" ]] || a+=("$x"); done\nexec /usr/bin/stat "${a[@]}"\n' >"$TMPBASE/pstat/stat"
  chmod +x "$TMPBASE/pid/id" "$TMPBASE/pstat/stat"
  perm_tree; perm_same "all safe" ok "$PT"
  perm_tree; chmod 660 "$PT/scripts/b.sh"; perm_same "group-writable file" scripts/b.sh "$PT"
  perm_tree; chmod 602 "$PT/ops/policy"; perm_same "other-writable file" ops/policy "$PT"
  perm_tree; chmod 770 "$PT/scripts/lib"; perm_same "group-writable folder" scripts/lib "$PT"
  perm_tree; chmod 777 "$PT"; perm_same "the clone folder itself" . "$PT"
  perm_tree; chmod 660 "$PT/.env" "$PT/scripts/b.sh"; perm_same "two unsafe, the first in list order is named" scripts/b.sh "$PT"
  perm_tree; chmod 660 "$PT/.env" "$PT/scripts/lib/x.sh"; perm_same "two unsafe, folder files before .env" scripts/lib/x.sh "$PT"
  perm_tree; PERM_PATH=$TMPBASE/pid:$PATH perm_same "every path owned by another user (id says 4242)" . "$PT"
  perm_tree; perm_same "a path another user owns, in the extra list" / "$PT" /
  perm_tree; rm -rf "$PT/ops" "$PT/.env" "$PT/backups"; perm_same "ops, .env and backups missing" ok "$PT"
  perm_tree; rm "$PT/.env"; ln -s nowhere "$PT/.env"; perm_same "a dangling link is skipped like a missing path" ok "$PT"
  perm_tree; rm "$PT/scripts/lib/x.sh"; perm_same "no file in scripts/lib: the glob stays text and is skipped" ok "$PT"
  perm_tree; rm -f "$PT"/scripts/*.sh; perm_same "no script at all, not even the helper" ok "$PT"
  perm_tree; ln -s ../.env "$PT/scripts/lnk.sh"; perm_same "a link (its own mode 777) is not safe" scripts/lnk.sh "$PT"
  perm_tree; chmod 666 "$PT/scripts/c d.sh"; perm_same "a name with a space" "scripts/c d.sh" "$PT"
  perm_tree; chmod 666 "$PT/scripts/e"$'\n'"f.sh"; perm_same "a name with a newline" $'scripts/e\nf.sh' "$PT"
  perm_tree; chmod 777 "$PT/scripts/e"$'\n'"f.sh"; chmod 660 "$PT/.env"; perm_same "a newline name before .env" $'scripts/e\nf.sh' "$PT"
  perm_tree; : >"$PT/vanish1"; : >"$PT/forge"$'\n'"$me 600 vanish1"; chmod 600 "$PT/vanish1" "$PT/forge"*; PERM_DROP=vanish1 PERM_PATH=$TMPBASE/pstat:$PATH perm_same "a name that looks like another path's record cannot stand in for it" vanish1 "$PT" "$PT/forge"$'\n'"$me 600 vanish1" vanish1
  perm_tree; PERM_DROP=scripts/b.sh PERM_PATH=$TMPBASE/pstat:$PATH perm_same "a file that vanishes: stat prints nothing for it" scripts/b.sh "$PT"
  perm_tree; chmod 660 "$PT/scripts/a.sh"; PERM_DROP=scripts/b.sh PERM_PATH=$TMPBASE/pstat:$PATH perm_same "an unsafe file before the one that vanishes is named" scripts/a.sh "$PT"
  perm_tree; chmod 660 "$PT/ops/policy"; PERM_DROP=scripts/b.sh PERM_PATH=$TMPBASE/pstat:$PATH perm_same "the one that vanishes before an unsafe file is named" scripts/b.sh "$PT"
  perm_tree; PERM_DROP=ops/policy PERM_PATH=$TMPBASE/pstat:$PATH perm_same "the last of the list vanishes" ops/policy "$PT"
  perm_tree; : >"$PT/extra"; chmod 600 "$PT/extra"; perm_same "extra list: a safe path" ok "$PT" "$PT/extra"
  perm_tree; : >"$PT/extra"; chmod 666 "$PT/extra"; perm_same "extra list: a writable path" "$PT/extra" "$PT" "$PT/extra"
  perm_tree; perm_same "extra list: a missing path is skipped" ok "$PT" "$PT/none"
  perm_tree; : >"$PT/-dash"; chmod 600 "$PT/-dash"; perm_same "extra list: a name with a leading dash is refused, as stat did" -dash "$PT" -dash
  perm_tree; chmod 660 "$PT/.env"; : >"$PT/extra"; chmod 666 "$PT/extra"; perm_same "the main list is read before the extra list" .env "$PT" "$PT/extra"
  perm_tree; : >"$PT/extra"; chmod 666 "$PT/extra"; PERM_DROP=ops/policy PERM_PATH=$TMPBASE/pstat:$PATH perm_same "a vanished path of the main list before an extra one" ops/policy "$PT" "$PT/extra"
  perm_tree; : >"$PT/e1"; : >"$PT/e2"; chmod 600 "$PT/e1" "$PT/e2"; chmod 666 "$PT/e2"; perm_same "extra list: the first unsafe of several" "$PT/e2" "$PT" "$PT/e1" "$PT/e2" "$PT/e1"
}
kv_same() { # kv_same NAME FILE-CONTENT KEY EXPECTED: old and new print the same bytes and succeed; both are printf %b strings
  local name=$1 f=$TMPBASE/kv.env orc nrc
  printf '%b' "$2" >"$f"
  old_kv_get "$f" "$3" >"$f.old" 2>/dev/null; orc=$?
  kv_get "$f" "$3" >"$f.new"; nrc=$?
  printf '%b' "$4" >"$f.want"
  check "kv_get, old and new: $name: the same bytes, and both succeed" bash -c "cmp -s '$f.old' '$f.new' && [[ $orc = 0 && $nrc = 0 ]]"
  check "kv_get, old and new: $name: the value is right" cmp -s "$f.new" "$f.want"
}
t_kv_get_as_before() {
  kv_same "a key" 'A=1\nPORT=8080\nB=2\n' PORT '8080\n'
  kv_same "the last of two lines wins" 'PORT=1\nPORT=2\nA=3\n' PORT '2\n'
  kv_same "a last line without a newline" 'A=1\nPORT=9' PORT '9\n'
  kv_same "a value with = in it" 'URL=http://x/?a=b=c\n' URL 'http://x/?a=b=c\n'
  kv_same "an empty value" 'A=1\nPORT=\n' PORT '\n'
  kv_same "an empty value on a last line without a newline" 'A=1\nPORT=' PORT '\n'
  kv_same "a key that is the start of another comes first" 'PORT_HTTPS=443\nPORT=80\n' PORT '80\n'
  kv_same "a key that is the start of another comes last" 'PORT=80\nPORT_HTTPS=443\n' PORT_HTTPS '443\n'
  kv_same "only the longer key is there" 'PORT_HTTPS=443\n' PORT ''
  kv_same "a carriage return stays" 'PORT=80\r\nA=1\r\n' PORT '80\r\n'
  kv_same "a missing key" 'A=1\nB=2\n' PORT ''
  kv_same "a comment, an indented line and a space before =" '#PORT=1\n PORT=2\nPORT =3\n' PORT ''
  kv_same "a line that is the key alone" 'PORT\n' PORT ''
  kv_same "an empty file" '' PORT ''
  kv_same "blank lines after the key" 'PORT=1\n\n\n' PORT '1\n'
  kv_same "spaces and quotes in the value are kept" 'MSG=  a b "c" \n' MSG '  a b "c" \n'
  kv_same "backslashes in the value are kept" 'P=a\\\\b\n' P 'a\\\\b\n'
  kv_same "a lower case key is another key" 'port=1\n' PORT ''
  kv_same "a NUL byte in the file: nothing is read, as grep did" 'A=1\nPORT=2\0\nPORT=3\n' PORT ''
  kv_same "a NUL byte after the key: nothing is read either" 'PORT=2\nA=1\0\n' PORT ''
  local f=$TMPBASE/kv.none
  check "kv_get: a missing file prints nothing" test -z "$(kv_get "$f" PORT)"
  kv_get "$f" PORT >/dev/null; check "kv_get: a missing file is not a failure" test $? = 0
  kv_get "$TMPBASE" PORT >/dev/null; check "kv_get: a folder is not a failure either" test $? = 0
  : >"$f.noread"; chmod 000 "$f.noread"; v=$(kv_get "$f.noread" PORT; echo "rc=$?")
  check "kv_get: a file that cannot be read gives an empty value and succeeds" test "$v" = rc=0
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
