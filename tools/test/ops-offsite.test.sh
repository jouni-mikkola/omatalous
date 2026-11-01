#!/usr/bin/env bash
# Tests for the `offsite` action of scripts/ops-helper.sh (scripts/lib/ops-offsite.sh): the helper takes the target the
# app prepared, checks every value, and hands it to scripts/offsite.sh. A stub docker stands for the app and a stub
# offsite.sh for the copy, so nothing here touches the network or a real container. Every host and key below is made up.
#
#   tools/test/ops-offsite.test.sh [name-filter]
#
# The stub's state is files in S: `offsite` is the line `ops offsite` prints, `exit` the status the stub copy ends with,
# `env.seen` what the stub copy saw (its environment and the key file's mode), `key.seen` the key it read.
set -u
umask 022
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
# shellcheck source=fake-host.sh
. "$HERE/fake-host.sh"
unprivileged ops-offsite.test.sh "$FILTER"
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

TMPBASE=$(mktemp -d)
trap 'rm -rf "$TMPBASE"' EXIT
ID=op_0123456789abcdef
RECIPIENT=age1$(printf 'q%.0s' {1..58})
PEM="-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKE
-----END PRIVATE KEY-----"
KEYB64=$(printf '%s\n' "$PEM" | base64 -w0)

write_stubs() {
  cat >"$S/bin/docker" <<'EOS'
#!/usr/bin/env bash
S=$OPS_STUB_DIR
printf 'docker %s\n' "$*" >>"$S/calls.log"
[[ ${1:-} == compose ]] || exit 0
shift
case " $* " in
  *" exec "*)
    case $* in
      *wget*) exit 0 ;;
      *"ops poll"*) if [[ -f $S/poll ]]; then cat "$S/poll"; rm -f "$S/poll"; else echo '{"request":null}'; fi ;;
      *"ops offsite"*) if [[ -f $S/offsite ]]; then cat "$S/offsite"; else echo '{"host":null}'; fi ;;
      *"ops report"*) cat >"$S/report.json"; echo '{"ok":true}' ;;
      *"ops state"*) cat >/dev/null; echo '{"ok":true}' ;;
      *"dist/node.js version"*) echo "0.8.7 (test)" ;;
    esac ;;
  *" ps "*) echo cid1 ;;
esac
exit 0
EOS
  printf '#!/bin/sh\nexec /bin/sleep 0.01\n' >"$S/bin/sleep"
  chmod +x "$S/bin"/*
}

new_world() {
  W=$(mktemp -d "$TMPBASE/w.XXXXXX"); S=$W/stub; CL=$W/clone
  mkdir -p "$S/bin" "$W/home" "$CL/scripts/lib" "$CL/ops" "$CL/backups"; chmod 700 "$CL/ops"
  cp "$SRC"/scripts/*.sh "$CL/scripts/"; cp "$SRC"/scripts/lib/*.sh "$CL/scripts/lib/"
  # the copy itself is not under test: it records what it was given
  cat >"$CL/scripts/offsite.sh" <<'EOS'
#!/usr/bin/env bash
{ env | grep '^OFFSITE_' | grep -v '^OFFSITE_KEY='; echo "keymode=$(stat -c %a "$OFFSITE_KEY")"; } >"$OPS_STUB_DIR/env.seen"
cp "$OFFSITE_KEY" "$OPS_STUB_DIR/key.seen"
exit "$(cat "$OPS_STUB_DIR/exit" 2>/dev/null || echo 0)"
EOS
  chmod 755 "$CL/scripts/offsite.sh"
  write_stubs
  printf '%s\n' HOST_PORT=8081 >"$CL/.env"; chmod 600 "$CL/.env"
  : >"$S/calls.log"
  printf '{"request":{"id":"%s","action":"offsite","params":{},"secret":null}}\n' "$ID" >"$S/poll"
}
line() { # line HOST PORT USER DIR RECIPIENT KEYB64
  printf '{"host":"%s","port":%s,"user":"%s","dir":"%s","recipient":"%s","key":"%s"}\n' "$1" "$2" "$3" "$4" "$5" "$6"
}
tick() { (cd "$CL" && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" ./scripts/ops-helper.sh >"$W/tick.out" 2>&1); }
reported() { grep -q "\"status\":\"$1\"" "$S/report.json" 2>/dev/null; }
summary() { grep -qF "\"summary\":\"$1\"" "$S/report.json" 2>/dev/null; }
key_anywhere() { grep -rlF "MC4CAQAwBQYDK2VwBCIEIFAKE" "$CL/ops" "$W/tick.out" "$S/calls.log" "$S/report.json" 2>/dev/null | tr '\n' ' '; }

t_good_target_runs_the_copy() {
  new_world; line nas.example.fi 2222 omatalous backups/omatalous "$RECIPIENT" "$KEYB64" >"$S/offsite"
  tick
  check "good target: reported ok" reported ok
  check "good target: the summary names the machine" summary "Salattu kopio vietiin koneelle nas.example.fi."
  check "good target: the copy got every value in its environment" bash -c "grep -qxF OFFSITE_HOST=nas.example.fi '$S/env.seen' && grep -qxF OFFSITE_PORT=2222 '$S/env.seen' && grep -qxF OFFSITE_USER=omatalous '$S/env.seen' && grep -qxF OFFSITE_DIR=backups/omatalous '$S/env.seen' && grep -qxF OFFSITE_RECIPIENT=$RECIPIENT '$S/env.seen'"
  check "good target: the key file was mode 600 and held the key" bash -c "grep -qxF keymode=600 '$S/env.seen' && cmp -s '$S/key.seen' <(printf '%s\n' '$PEM')"
  check "good target: the key file is gone after the run" bash -c "[[ ! -e '$CL/ops/offsite.key' ]]"
  check "good target: the key is in no log, journal, output, report or command line" test -z "$(key_anywhere)"
  check "good target: the app was asked as version 6" bash -c "grep -q 'dist/node.js ops offsite --helper 6\$' '$S/calls.log'"
}

t_bad_values_send_nothing() {
  local name bad
  while IFS='|' read -r name bad; do
    new_world; printf '%s\n' "$bad" >"$S/offsite"
    tick
    check "bad value, $name: reported failed" reported failed
    check "bad value, $name: the copy did not run and no key file was made" bash -c "! [[ -e '$S/env.seen' || -e '$CL/ops/offsite.key' ]]"
  done <<ROWS
host with a space|$(line "nas example" 22 u dir "$RECIPIENT" "$KEYB64")
host with a dash first|$(line "-oProxyCommand=x" 22 u dir "$RECIPIENT" "$KEYB64")
host with a dollar|$(line 'a$(id).fi' 22 u dir "$RECIPIENT" "$KEYB64")
port zero|$(line nas.example.fi 0 u dir "$RECIPIENT" "$KEYB64")
port too big|$(line nas.example.fi 70000 u dir "$RECIPIENT" "$KEYB64")
user with a dash first|$(line nas.example.fi 22 -oX dir "$RECIPIENT" "$KEYB64")
user with a space|$(line nas.example.fi 22 "a b" dir "$RECIPIENT" "$KEYB64")
dir with a dash first|$(line nas.example.fi 22 u -rf "$RECIPIENT" "$KEYB64")
dir with a dot dot|$(line nas.example.fi 22 u a/../b "$RECIPIENT" "$KEYB64")
dir with a space|$(line nas.example.fi 22 u "a b" "$RECIPIENT" "$KEYB64")
dir with a double slash|$(line nas.example.fi 22 u a//b "$RECIPIENT" "$KEYB64")
recipient too short|$(line nas.example.fi 22 u dir age1qqq "$KEYB64")
recipient is the secret half|$(line nas.example.fi 22 u dir "AGE-SECRET-KEY-1$(printf 'Q%.0s' {1..58})" "$KEYB64")
key is not a private key|$(line nas.example.fi 22 u dir "$RECIPIENT" "$(printf 'hello' | base64 -w0)")
an extra field|{"host":"nas.example.fi","port":22,"user":"u","dir":"d","recipient":"$RECIPIENT","key":"$KEYB64","cmd":"id"}
no target prepared|{"host":null}
not json|rm -rf /
ROWS
}

t_exit_codes_have_words() {
  local code word
  for code in 10:"age puuttuu" 11:"sftp puuttuu" 12:"yhteys koneeseen" 13:"koko toisella koneella" 14:"tunniste on muuttunut"; do
    new_world; line nas.example.fi 22 u dir "$RECIPIENT" "$KEYB64" >"$S/offsite"; echo "${code%%:*}" >"$S/exit"
    tick
    word=${code#*:}
    check "exit ${code%%:*}: reported failed with the reason" bash -c "grep -q '\"status\":\"failed\"' '$S/report.json' && grep -q '$word' '$S/report.json'"
    check "exit ${code%%:*}: the key file is gone" bash -c "[[ ! -e '$CL/ops/offsite.key' ]]"
  done
}

t_no_free_text_reaches_a_command() {
  check "no eval, source or bash -c in the action" bash -c "! grep -vE '^[[:space:]]*#' '$SRC/scripts/lib/ops-offsite.sh' | grep -nE '(^|[;&|(])[[:space:]]*(eval|source)[[:space:]]|bash -c'"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
