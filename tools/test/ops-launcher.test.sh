#!/usr/bin/env bash
# Tests for scripts/ops-launcher.sh (the file the helper's timer runs, outside the clone, with its last good copy of
# the helper) and for the helper's --root argument, in the world of tools/test/ops-world.sh. Nothing touches the
# network, a real container or the real home folder.
#
#   tools/test/ops-launcher.test.sh [scenario filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
# The launcher refuses root. A root run of the suite sees that for real here, before it goes on as nobody, and hands
# the answer to t_launcher_refuses_root.
if [[ $EUID -eq 0 && -z ${OPS_TEST_CHILD:-} ]]; then
  d=$(mktemp -d); cp "$SRC/scripts/ops-launcher.sh" "$d/launcher.sh"; chmod 700 "$d" "$d/launcher.sh"
  out=$(bash "$d/launcher.sh" "$SRC" 2>&1); export LAUNCHER_AS_ROOT="$?:$out"; rm -rf "$d"
fi
unprivileged ops-launcher.test.sh "$@"

# ── the launcher in the world ───────────────────────────────────────────────
# put in place the way install.sh --ops-helper does it (ops_launcher_install), for the world's clone
install_launcher() {
  L=$W/home/.local/share/omatalous/banking-app
  (export HOME="$W/home"; unset XDG_DATA_HOME; . "$CL/scripts/lib/ops-schedule.sh"; ops_launcher_install banking-app "$CL") || fail "the launcher could not be put in place"
}
# one tick through the launcher, as the timer runs it (not from inside the clone)
ltick() { # ltick [FOLDER]
  (cd / && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" "$L/launcher.sh" "${1:-$CL}" >"$W/tick.out" 2>&1)
  TICK_RC=$?
}
# a helper file run directly with ARGS: its status in RC
helper() { local h=$1; shift; (cd / && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" bash "$h" "$@" >"$W/helper.out" 2>&1); RC=$?; }
# the clone's helper says which one it is, every tick: "tick NAME" in calls.log (the later definition wins)
mark() { printf 'address_tick() { echo "tick %s" >>"$OPS_STUB_DIR/calls.log"; }\n' "$1" >>"$CL/scripts/lib/ops-address.sh"; }
lines() { grep -c ' launcher: ' "${1:-$CL/ops/helper.log}" 2>/dev/null || true; }
copy_hash() { cat "$L/last-good/.hash" 2>/dev/null; }
# a world with the launcher and a last good copy of the helper marked A
with_copy() { new_world; install_launcher; mark A; ltick; : >"$S/calls.log"; }
broken() { printf 'if then (\n' >>"$CL/$1"; }
served() { [[ $(n_calls 'backup.sh ran') == 1 ]] && reported ok; }

# ── scenarios ───────────────────────────────────────────────────────────────
t_launcher_runs_clone() {
  new_world; install_launcher; mark A
  ltick
  check "runs clone: the clone's helper ran one tick" test "$TICK_RC" = 0 -a "$(n_calls '^tick A$')" = 1 -a -f "$CL/ops/helper-seen"
  check "runs clone: the launcher wrote no line" test "$(lines)" = 0 -a ! -e "$L/launcher.log"
  check "runs clone: its folder and file are this user's alone" test "$(stat -c %a "$L")" = 700 -a "$(stat -c %a "$L/launcher.sh")" = 700
  poll backup; ltick
  check "runs clone: a request is served" served
  (cd / && "$L/launcher.sh" >"$W/tick.out" 2>&1); check "arguments: none is refused" test $? = 2
  (cd "$W" && "$L/launcher.sh" clone >"$W/tick.out" 2>&1); check "arguments: a relative folder is refused" test $? = 2
  (cd / && "$L/launcher.sh" "$CL" "$CL" >"$W/tick.out" 2>&1); check "arguments: two are refused" test $? = 2
  (cd / && "$L/launcher.sh" "$CL/\$(id)" >"$W/tick.out" 2>&1); check "arguments: shell characters are refused" test $? = 2
  (cd / && bash "$CL/scripts/ops-launcher.sh" "$CL" >"$W/tick.out" 2>&1)
  check "the file in the clone does not run as a launcher" bash -c "[[ $? = 1 && ! -e '$CL/scripts/last-good' ]]"
}

t_launcher_updates_last_good() {
  new_world; install_launcher; mark A; ltick
  check "copy: taken after the first good tick, in the same layout" bash -c "cmp -s '$CL/scripts/ops-helper.sh' '$L/last-good/scripts/ops-helper.sh' && diff -r '$CL/scripts/lib' '$L/last-good/scripts/lib' >/dev/null"
  check "copy: no one else can read or write it" test -z "$(find "$L" -perm /077)"
  local h1 ino; h1=$(copy_hash); ino=$(stat -c %i "$L/last-good")
  ltick
  check "copy: left alone while the helper is the same" test "$(copy_hash)" = "$h1" -a "$(stat -c %i "$L/last-good")" = "$ino"
  mark B; ltick
  check "copy: renewed after a good tick of a changed helper" bash -c "[[ '$(copy_hash)' != '$h1' ]] && grep -q 'tick B' '$L/last-good/scripts/lib/ops-address.sh' && [[ ! -e '$L/last-good.new' && ! -e '$L/last-good.old' ]]"
  h1=$(copy_hash)
  mark C; setenv 'NOT A LINE'; ltick
  check "copy: a tick that failed does not renew it" test "$TICK_RC" = 1 -a "$(copy_hash)" = "$h1"
  # a tick is running (it holds the helper's lock): this one ends at once with 0, which proves nothing
  : >"$CL/.env"; exec 9>"$CL/ops/.lock"; flock -x 9; : >"$S/calls.log"
  ltick
  exec 9>&-
  check "copy: a tick that found another one running does not renew it" test "$TICK_RC" = 0 -a "$(n_calls '^tick')" = 0 -a "$(copy_hash)" = "$h1"
  ltick
  check "copy: the next good tick does" bash -c "[[ '$(copy_hash)' != '$h1' ]] && grep -q 'tick C' '$L/last-good/scripts/lib/ops-address.sh'"
  # the tick itself changed the files, as an update does: what is on disk now has not run yet
  h1=$(copy_hash)
  printf 'address_tick() { echo "# during the tick" >>scripts/lib/ops-address.sh; }\n' >>"$CL/scripts/lib/ops-address.sh"; ltick
  check "copy: files that changed during the tick wait for the next one" test "$TICK_RC" = 0 -a "$(copy_hash)" = "$h1"
  # a swap that was cut short is put back
  mv "$L/last-good" "$L/last-good.old"; ltick
  check "copy: a swap cut short is mended" test -f "$L/last-good/scripts/ops-helper.sh" -a ! -e "$L/last-good.old"
}

# a helper whose tick ends well and whose own test fails; each time the test is asked leaves a line in calls.log
fails_test() { printf 'self_test() { echo "selftest %s" >>"$OPS_STUB_DIR/calls.log"; echo "self-test failed: made up"; return 1; }\n' "$1" >>"$CL/scripts/lib/ops-selftest.sh"; }
t_launcher_keeps_only_a_tested_helper() {
  with_copy; local h1; h1=$(copy_hash)
  mark B; fails_test B; ltick
  check "self-test: the tick of the changed helper ran well" test "$TICK_RC" = 0 -a "$(n_calls '^tick B$')" = 1
  check "self-test: a helper that fails its own test is not copied, and the earlier copy stays" bash -c "[[ '$(copy_hash)' = '$h1' && ! -e '$L/last-good.new' ]] && grep -q 'tick A' '$L/last-good/scripts/lib/ops-address.sh'"
  check "self-test: it was asked once" test "$(n_calls '^selftest B$')" = 1
  for _ in 2 3 4 5 6 7 8 9 10; do ltick; done
  check "self-test: the next nine ticks do not ask again" test "$(n_calls '^selftest B$')" = 1 -a "$(copy_hash)" = "$h1"
  ltick
  check "self-test: the tenth tick after it does, and the copy still stays" test "$(n_calls '^selftest B$')" = 2 -a "$(copy_hash)" = "$h1"
  git -C "$CL" checkout -q scripts/lib/ops-selftest.sh; ltick
  check "self-test: a helper that passes becomes the copy at once" bash -c "[[ '$(copy_hash)' != '$h1' && ! -e '$L/.failed' ]] && grep -q 'tick B' '$L/last-good/scripts/lib/ops-address.sh'"
}

t_launcher_syntax_error_uses_last_good() {
  with_copy; local h1; h1=$(copy_hash)
  mark B; broken scripts/ops-helper.sh; rm -f "$CL/ops/helper-seen"
  ltick
  check "syntax error: the last good copy ran the tick for the clone" test "$TICK_RC" = 0 -a "$(n_calls '^tick A$')" = 1 -a "$(n_calls '^tick B$')" = 0 -a -f "$CL/ops/helper-seen"
  check "syntax error: one line in the clone's log says so, with the reason" bash -c "[[ $(lines) = 1 ]] && grep -q ' launcher: .*scripts/ops-helper.sh does not parse.*last good copy' '$CL/ops/helper.log'"
  poll backup; ltick
  check "syntax error: a request is still served" served
  check "syntax error: the line is not written again the next minute, and the copy is kept as it was" test "$(lines)" = 1 -a "$(copy_hash)" = "$h1"
  git -C "$CL" checkout -q scripts/ops-helper.sh; : >"$S/calls.log"; ltick
  check "syntax error: a mended clone runs its own helper again" test "$TICK_RC" = 0 -a "$(n_calls '^tick B$')" = 1 -a "$(lines)" = 1
}

# a helper broken for days must not push the lines that say why out of the log
t_launcher_line_once_in_ten_minutes() {
  with_copy; broken scripts/ops-helper.sh
  ltick; ltick; ltick
  check "ten minutes: three ticks of a broken helper leave one line in the log" test "$TICK_RC" = 0 -a "$(lines)" = 1
  check "ten minutes: every tick still says it on stderr" grep -q ' launcher: .*does not parse' "$W/tick.out"
  touch -d '11 minutes ago' "$L/.note"; ltick; ltick
  check "ten minutes: the next line comes when the newest is ten minutes old" test "$(lines)" = 2
  rm "$CL/scripts/ops-helper.sh"; ltick
  check "ten minutes: another reason is written at once" bash -c "[[ $(lines) = 3 ]] && grep ' launcher: .*is missing' '$CL/ops/helper.log' >/dev/null"
  git -C "$CL" checkout -q scripts/ops-helper.sh; ltick
  check "ten minutes: a tick of the clone's own helper clears the mark" test "$TICK_RC" = 0 -a ! -e "$L/.note" -a "$(lines)" = 3
  broken scripts/ops-helper.sh; ltick
  check "ten minutes: a helper broken again is said at once" test "$(lines)" = 4
}

# A clone behind a symbolic link: ~/omatalous -> /mnt/disk/omatalous. install.sh hands the path as typed to the schedule line.
t_launcher_clone_behind_link() {
  new_world; install_launcher; mark A; ln -s "$CL" "$W/link"
  ltick "$W/link"
  check "link: a clone behind a symbolic link runs, and its copy is taken" test "$TICK_RC" = 0 -a "$(n_calls '^tick A$')" = 1 -a "$(lines)" = 0 -a -f "$L/last-good/.hash"
  mark B; broken scripts/ops-helper.sh; : >"$S/calls.log"; ltick "$W/link"
  check "link: when its helper breaks the copy runs for the folder itself" test "$TICK_RC" = 0 -a "$(n_calls '^tick A$')" = 1 -a "$(lines)" = 1
  git -C "$CL" checkout -q scripts/ops-helper.sh; : >"$S/calls.log"; chmod o+w "$CL"; ltick "$W/link"
  check "link: one to a folder others can write is refused" test "$TICK_RC" != 0 -a "$(n_calls '^tick')" = 0
  check "link: the line names the folder, in the launcher's own log" bash -c "grep ' launcher: .*$CL is owned by someone else or writable by others' '$L/launcher.log' >/dev/null && [[ $(lines) = 1 ]]"
  chmod o-w "$CL"; ltick "$W/link"
  check "link: safe again, it runs" test "$TICK_RC" = 0 -a "$(n_calls '^tick B$')" = 1
  mkdir "$W/a b"; ln -s "$W/a b" "$W/odd"; ltick "$W/odd"
  check "link: one to a folder with an odd name is refused" test "$TICK_RC" = 2
}

# A file of the copy cut to nothing by a power cut parses, and would run as nothing
t_launcher_damaged_copy_not_run() {
  with_copy; broken scripts/ops-helper.sh
  : >"$L/last-good/scripts/ops-helper.sh"; ltick
  check "damaged copy: a copy whose helper was cut to nothing is not run" test "$TICK_RC" = 1 -a "$(calls | wc -l)" = 0
  check "damaged copy: the line says why" grep -q ' launcher: .*does not parse.*last good copy of it is damaged.*Nothing runs' "$CL/ops/helper.log"
  cp "$CL/scripts/lib/dbcopy.sh" "$L/last-good/scripts/ops-helper.sh"; ltick
  check "damaged copy: nor one whose file is something else" test "$TICK_RC" = 1 -a "$(calls | wc -l)" = 0
  git -C "$CL" checkout -q scripts/ops-helper.sh; ltick
  check "damaged copy: the next good tick of the clone's helper takes a new copy" bash -c "[[ $TICK_RC = 0 ]] && cmp -s '$CL/scripts/ops-helper.sh' '$L/last-good/scripts/ops-helper.sh'"
  broken scripts/ops-helper.sh; : >"$L/last-good/.hash"; : >"$S/calls.log"; ltick
  check "damaged copy: a copy with no hash is not run" test "$TICK_RC" = 1 -a "$(calls | wc -l)" = 0
}

t_launcher_broken_lib_uses_last_good() {
  with_copy
  broken scripts/lib/ops-release.sh
  ltick
  check "broken lib: the copy ran with its own libs" test "$TICK_RC" = 0 -a "$(n_calls '^tick A$')" = 1
  check "broken lib: the line names the file" bash -c "[[ $(lines) = 1 ]] && grep -q ' launcher: .*scripts/lib/ops-release.sh does not parse' '$CL/ops/helper.log'"
  # a lib the helper does not load at the start counts too: every file under scripts/lib is checked
  git -C "$CL" checkout -q scripts/lib/ops-release.sh; broken scripts/lib/cloudflare.sh; : >"$S/calls.log"; ltick
  check "broken lib: any file under scripts/lib counts" test "$TICK_RC" = 0 -a "$(n_calls '^tick A$')" = 1 -a "$(lines)" = 2
}

t_launcher_missing_helper_runs_copy() {
  with_copy
  rm "$CL/scripts/ops-helper.sh"; ltick
  check "missing helper: the copy ran the tick" test "$TICK_RC" = 0 -a "$(n_calls '^tick A$')" = 1
  check "missing helper: one line says so" bash -c "[[ $(lines) = 1 ]] && grep -q ' launcher: .*scripts/ops-helper.sh is missing' '$CL/ops/helper.log'"
}

t_launcher_no_copy() {
  new_world; install_launcher; mark A; broken scripts/ops-helper.sh
  ltick
  check "no copy: exit 1 and nothing ran" test "$TICK_RC" = 1 -a "$(calls | wc -l)" = 0 -a ! -e "$L/last-good"
  check "no copy: one line" bash -c "[[ $(lines) = 1 && \$(wc -l <'$W/tick.out') = 1 ]] && grep -q ' launcher: .*does not parse.*no last good copy' '$CL/ops/helper.log'"
}

t_launcher_gone_clone() {
  with_copy; local h1; h1=$(copy_hash)
  mv "$CL" "$CL.gone"; ltick
  check "clone gone: exit 1, nothing ran, the copy is kept" test "$TICK_RC" = 1 -a "$(calls | wc -l)" = 0 -a "$(copy_hash)" = "$h1" -a -f "$L/last-good/scripts/ops-helper.sh"
  check "clone gone: one line in the launcher's own log" bash -c "[[ $(lines "$L/launcher.log") = 1 ]] && grep -q 'is missing' '$L/launcher.log'"
  mv "$CL.gone" "$CL"; ltick
  check "clone gone: back again, its helper runs" test "$TICK_RC" = 0 -a "$(n_calls '^tick A$')" = 1
}

# nothing of the clone or of the copy runs when someone else could have written it
t_launcher_unsafe_file_never_run() {
  with_copy
  printf '#!/bin/bash\ntouch "%s/planted"\n' "$W" >"$CL/scripts/ops-helper.sh"; chmod 775 "$CL/scripts/ops-helper.sh"; ltick
  check "unsafe: a helper others can write is not run, by the launcher or by the copy" test "$TICK_RC" != 0 -a ! -e "$W/planted" -a "$(n_calls '^tick')" = 0
  check "unsafe: the log names it" grep -q ' launcher: .*scripts/ops-helper.sh is owned by someone else or writable by others' "$CL/ops/helper.log"
  git -C "$CL" checkout -q scripts/ops-helper.sh; chmod 755 "$CL/scripts/ops-helper.sh"
  printf 'touch "%s/planted"\n' "$W" >>"$CL/scripts/lib/ops-release.sh"; chmod o+w "$CL/scripts/lib/ops-release.sh"; ltick
  check "unsafe: a lib others can write is not read" test "$TICK_RC" != 0 -a ! -e "$W/planted" -a "$(n_calls '^tick')" = 0
  git -C "$CL" checkout -q scripts/lib/ops-release.sh; chmod 644 "$CL/scripts/lib/ops-release.sh"
  printf '#!/bin/bash\ntouch "%s/planted"\n' "$W" >"$W/elsewhere.sh"; chmod 755 "$W/elsewhere.sh"; ln -sf "$W/elsewhere.sh" "$CL/scripts/ops-helper.sh"; ltick
  check "unsafe: a helper that is a symbolic link is not run" test "$TICK_RC" != 0 -a ! -e "$W/planted" -a "$(n_calls '^tick')" = 0
  rm "$CL/scripts/ops-helper.sh"; git -C "$CL" checkout -q scripts/ops-helper.sh; ltick
  check "unsafe: the clone as it was runs again" test "$TICK_RC" = 0 -a "$(n_calls '^tick A$')" = 1
  # the copy
  broken scripts/ops-helper.sh; : >"$S/calls.log"
  printf 'touch "%s/planted"\n' "$W" >>"$L/last-good/scripts/lib/ops-release.sh"; chmod g+w "$L/last-good/scripts/lib/ops-release.sh"; ltick
  check "unsafe: a copy others can write is not run" test "$TICK_RC" = 1 -a ! -e "$W/planted" -a "$(calls | wc -l)" = 0
  chmod g-w "$L/last-good/scripts/lib/ops-release.sh"; chmod g+w "$L"; ltick
  check "unsafe: a launcher folder others can write runs nothing" test "$TICK_RC" = 1 -a ! -e "$W/planted" -a "$(calls | wc -l)" = 0
}

t_launcher_refuses_root() {
  local as=${LAUNCHER_AS_ROOT:-} how="as root"
  if [[ -z $as ]]; then # the suite did not start as root: a user namespace where this user is root, when the host allows one
    new_world; install_launcher; how="in a user namespace"
    as="$(unshare -r bash "$L/launcher.sh" "$CL" 2>&1; echo ":$?")"; as="${as##*:}:${as%:*}"
    [[ $as == *"does not run as root"* || $(calls | wc -l) != 0 ]] || { as=""; how="not run here: no root and no user namespace"; }
  fi
  if [[ -n $as ]]; then check "root: the launcher refuses ($how)" bash -c '[[ $1 == 1:*"does not run as root"* ]]' x "$as"
  else echo "     ($how)"; fi
  check "root: the refusal is the launcher's first step" bash -c "sed -n '/^main() {/,/^}/p' '$SRC/scripts/ops-launcher.sh' | sed -n 3p | grep -F '[[ \$EUID -ne 0 ]] || {' >/dev/null"
}

# ── the helper's --root ─────────────────────────────────────────────────────
t_root_only_from_launcher() {
  with_copy
  helper "$CL/scripts/ops-helper.sh" --root "$CL"
  check "--root: a clone's helper does not take it" test "$RC" = 2 -a "$(calls | wc -l)" = 0
  mkdir -p "$W/x/last-good" "$W/y/omatalous/banking-app/last-good"
  cp -r "$L/last-good/scripts" "$W/x/last-good/"; cp "$L/launcher.sh" "$W/x/"; cp -r "$L/last-good/scripts" "$W/y/omatalous/banking-app/last-good/"
  helper "$W/x/last-good/scripts/ops-helper.sh" --root "$CL"
  check "--root: a copy in some other folder does not take it" test "$RC" = 2 -a "$(calls | wc -l)" = 0
  helper "$W/y/omatalous/banking-app/last-good/scripts/ops-helper.sh" --root "$CL"
  check "--root: a copy with no launcher beside it does not take it" test "$RC" = 2 -a "$(calls | wc -l)" = 0
  helper "$L/last-good/scripts/ops-helper.sh" --root "$CL" more
  check "--root: one folder and nothing more" test "$RC" = 2 -a "$(calls | wc -l)" = 0
  rm -f "$CL/ops/helper-seen"; mark B
  helper "$L/last-good/scripts/ops-helper.sh" --root "$CL"
  check "--root: the launcher's copy runs a tick for the clone, with its own libs" test "$RC" = 0 -a "$(n_calls '^tick A$')" = 1 -a "$(n_calls '^tick B$')" = 0 -a -f "$CL/ops/helper-seen" -a ! -e "$L/last-good/ops"
  # check_permissions covers the copy and the launcher's folder
  : >"$S/calls.log"; chmod g+w "$L/last-good/scripts/lib/dbcopy.sh"
  helper "$L/last-good/scripts/ops-helper.sh" --root "$CL"
  check "--root: a copy others can write is refused" bash -c "[[ $RC = 1 && $(calls | wc -l) = 0 ]] && grep -q 'File permissions: .*last-good/scripts/lib/dbcopy.sh is not safe' '$CL/ops/helper.log'"
  chmod g-w "$L/last-good/scripts/lib/dbcopy.sh"; chmod g+w "$L"
  helper "$L/last-good/scripts/ops-helper.sh" --root "$CL"
  check "--root: a launcher folder others can write is refused" bash -c "[[ $RC = 1 && $(calls | wc -l) = 0 ]] && grep -q 'File permissions: $L is not safe' '$CL/ops/helper.log'"
}

t_root_bad_dir_refused() {
  with_copy; local d n=0
  cp -r "$CL" "$W/with space"; rm -rf "$W/with space/ops"; mkdir -p "$W/empty" "$W/half/scripts"; ln -s "$CL" "$W/link"
  helper "$L/last-good/scripts/ops-helper.sh" --root; [[ $RC == 2 ]] || n=1
  for d in clone "../clone" "$W/with space" "$CL/\$(id)" "$W/empty" "$W/half" "$W/nowhere" "$CL;id"; do
    helper "$L/last-good/scripts/ops-helper.sh" --root "$d"
    [[ $RC == 2 ]] || { n=$((n + 1)); echo "       taken: --root $d"; }
  done
  check "--root: a missing, relative, odd or foreign folder is refused" test "$n" = 0
  check "--root: and nothing ran or was written there" test "$(calls | wc -l)" = 0 -a ! -e "$W/empty/ops" -a ! -e "$W/half/ops" -a ! -e "$W/with space/ops"
  helper "$L/last-good/scripts/ops-helper.sh" --root "$W/link"
  check "--root: a link to the clone is followed to the clone itself" test "$RC" = 0 -a -f "$CL/ops/helper-seen"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
