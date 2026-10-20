#!/usr/bin/env bash
# Tests for install.sh, update.sh and reset.sh themselves, started while the installer's lock is held (installer_lock in
# scripts/lib/release.sh), on a fake host (tools/test/fake-host.sh): each refuses with its own words, before it touches
# Docker, the folder or anything else, and none of them runs a newer install.sh that an update has put in the clone. The lock is
# held the way the current scripts take it (the folder) and the way releases before 0.9.0 took it (the file scripts/install.sh,
# which the merge of an update replaces: the holder then has a deleted file open). The same runs with the lock free are the near
# miss: they get past the lock.
#
# The process that holds the lock waits for it (flock, not flock -n) and tells the scenario when it has it, through a pipe, so
# nothing here waits on the clock and no other process can take the lock from it first.
#
#   tools/test/lock-held.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by fake-host.sh
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
# shellcheck source=fake-host.sh
. "$HERE/fake-host.sh"
unprivileged lock-held.test.sh "$FILTER"
host_init
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
command -v flock >/dev/null || { echo "flock is missing (util-linux): the scripts take no lock without it, so there is nothing to test"; exit 0; }
HOLDER=''
trap '[[ -z $HOLDER ]] || kill "$HOLDER" 2>/dev/null; rm -rf "$TMPBASE"' EXIT

# the words each script refuses with
SAY_INSTALL='Another install or update is already running in this folder. Wait until it finishes, then run this again.'
SAY_UPDATE='Another update or install is already running in this folder. Wait for it to finish.'
SAY_RESET='An install or update is running in this folder. Wait until it finishes.'

# A Docker that logs each call (S/docker.log) and answers only `compose version`, which reset.sh asks before it takes the lock.
# A script that gets past the lock reaches the next call and fails there.
docker_log() {
  cat >"$S/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$S/docker.log"
[[ $* == "compose version" ]]
EOF
  chmod +x "$S/bin/docker"
  : >"$S/docker.log"
}
# a world for one scenario: a clone, the logging Docker, and the place for what a run prints
lock_world() { new_host; docker_log; }

# Starts a process that holds the lock and returns once it does. HOW is folder (how install.sh, update.sh and reset.sh take it)
# or file (how releases before 0.9.0 took it: scripts/install.sh itself, on the fd 9 their update.sh kept).
hold() { # hold HOW
  local pipe=$W/held fd
  mkfifo "$pipe"
  exec {fd}<>"$pipe" # read and write: opening it never waits for the other end
  (
    cd "$CL" || exit 1
    if [[ $1 == folder ]]; then exec 9<.; else exec 9<scripts/install.sh; fi
    flock 9 && echo held >"$pipe" && exec sleep 300
  ) &
  HOLDER=$!
  read -r -t 120 -u "$fd" _ || fail "the holder did not report that it has the lock"
  exec {fd}<&-
}
release_lock() { kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null; HOLDER=''; }
# whether PATH (a folder or a file) is locked: a probe with flock -n fails then, and a probe that fails takes nothing
lock_is_free() { local fd rc=1; exec {fd}<"$1" || return 1; flock -n "$fd" && rc=0; exec {fd}<&-; return "$rc"; }
lock_is_held() { local fd rc=0; exec {fd}<"$1" || return 1; flock -n "$fd" && rc=1; exec {fd}<&-; return "$rc"; }
# An update has put a newer install.sh in the clone: a new file under the same name (a new inode, as the merge makes it). It
# says so in a mark when it starts.
newer_install() {
  sed '1a : >"'"$W"'/ran-newer"' "$CL/scripts/install.sh" >"$W/install.new"; chmod +x "$W/install.new"
  mv -f "$W/install.new" "$CL/scripts/install.sh"
}
# the clone as it stands: every path outside .git with its size and times, and HEAD
tree() { (cd "$CL" && { git rev-parse HEAD; find . -path ./.git -prune -o -printf '%p %s %T@\n'; } | sort | md5sum); }

# SCRIPT as a person starts it in the clone, the output in OUT and the status in RC. reset.sh needs a terminal: it runs in one
# (script), which gives the same status back.
run_script() { # run_script install|update|reset
  local cmd=()
  case $1 in
    install) cmd=(./scripts/install.sh --yes --access local) ;;
    ops) cmd=(./scripts/install.sh --ops-helper) ;;
    update) cmd=(./scripts/update.sh --yes) ;;
    reset) cmd=(./scripts/reset.sh) ;;
  esac
  rm -f "$W/ran-newer"; : >"$S/docker.log"
  if [[ $1 == reset ]]; then
    printf '#!/usr/bin/env bash\ncd %q && exec env S=%q HOME=%q PATH=%q ./scripts/reset.sh\n' "$CL" "$S" "$W/home" "$S/bin:$SYS" >"$W/reset-in-terminal"
    chmod +x "$W/reset-in-terminal"
    script -qec "$W/reset-in-terminal" "$W/reset.typescript" </dev/null >/dev/null 2>&1; RC=$?
    OUT=$(tr -d '\r' <"$W/reset.typescript")
  else
    OUT=$(in_clone "${cmd[@]}" </dev/null 2>&1); RC=$?
  fi
}
said() { [[ $OUT == *"$1"* ]]; }
# the docker calls of the last run, without the one reset.sh makes before it takes the lock
later_calls() { grep -vx 'compose version' "$S/docker.log" | wc -l; }

# One script against a held lock: it refuses with its words, takes nothing from the folder or from Docker, and starts no newer
# install.sh (update.sh and reset.sh could start the one that the holder's update has put in the clone). NEWER says what to expect
# of that file: `runs` when it is the script that is run (it starts, and stops at the lock), `unused` when it must not start.
refuses() { # refuses NAME SCRIPT WORDS [runs|unused]
  local before
  before=$(tree)
  run_script "$2"
  check "$1: it stops with the words of its own" bash -c "[[ $RC != 0 ]] && [[ \$1 == *\"\$2\"* ]]" x "$OUT" "$3"
  check "$1: it does nothing else: Docker is not asked, and the folder is as it was" test "$(later_calls)" = 0 -a "$(tree)" = "$before"
  case ${4:-} in
    runs) check "$1: the file that ran is the newer one, and it stopped at the lock" test -e "$W/ran-newer" ;;
    unused) check "$1: the newer install.sh was not started" test ! -e "$W/ran-newer" ;;
  esac
}

t_the_folder_is_locked() {
  lock_world; hold folder
  check "the holder has the lock" lock_is_held "$CL"
  refuses "install.sh" install "$SAY_INSTALL"
  refuses "install.sh --ops-helper" ops "$SAY_INSTALL"
  refuses "update.sh" update "$SAY_UPDATE"
  refuses "reset.sh" reset "$SAY_RESET"
  release_lock
}
t_a_holder_of_the_old_file_lock_with_install_sh_replaced() {
  # the update to this release, run by 0.8.7's update.sh: it holds scripts/install.sh, and the merge has put a new file there
  lock_world; hold file
  check "the holder has the lock on the file it opened" lock_is_held "$CL/scripts/install.sh"
  newer_install
  check "the file is a new one now, and the lock on it is free" lock_is_free "$CL/scripts/install.sh"
  check "the lock on the folder is free as well, so that only the deleted file shows the holder" lock_is_free "$CL"
  refuses "install.sh" install "$SAY_INSTALL" runs
  refuses "install.sh --ops-helper" ops "$SAY_INSTALL" runs
  refuses "update.sh" update "$SAY_UPDATE" unused
  refuses "reset.sh" reset "$SAY_RESET" unused
  release_lock
}
t_the_lock_is_free() {
  # the near miss: nothing holds it, and the same runs go past the lock
  lock_world
  run_script install
  check "install.sh: it does not refuse, and it goes on to Docker" bash -c "[[ \$1 != *\"\$2\"* && \$3 != 0 ]]" x "$OUT" "$SAY_INSTALL" "$(later_calls)"
  : >"$S/docker.log"; run_script update
  check "update.sh: it does not refuse, and it goes on to Docker" bash -c "[[ \$1 != *\"\$2\"* && \$3 != 0 ]]" x "$OUT" "$SAY_UPDATE" "$(later_calls)"
  : >"$S/docker.log"; run_script reset
  check "reset.sh: it does not refuse, and it goes on to Docker" bash -c "[[ \$1 != *\"\$2\"* && \$3 != 0 ]]" x "$OUT" "$SAY_RESET" "$(later_calls)"
  cron_on; run_script ops
  check "install.sh --ops-helper: it does not refuse, and it sets the helper up" bash -c "[[ $RC == 0 && \$1 != *\"\$2\"* ]]" x "$OUT" "$SAY_INSTALL"
}
t_the_lock_is_free_again_after_its_holder_ends() {
  lock_world; hold folder; release_lock
  run_script update
  check "the holder is gone: update.sh does not refuse" bash -c "[[ \$1 != *\"\$2\"* ]]" x "$OUT" "$SAY_UPDATE"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
