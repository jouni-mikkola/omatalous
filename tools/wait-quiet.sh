#!/usr/bin/env bash
# Waits until this machine is quiet enough for a heavy step (checks, page tests, a release gate), without a CPU spent on it.
#   tools/wait-quiet.sh [--max SECONDS] [--file FILE | --pid PID]
# Quiet means two things at once: no vitest, playwright, tsc or tools/check.sh of ANOTHER worktree is running, and the
# one-minute load average is below twice the number of CPUs. A process of this worktree, of the caller's own process tree,
# or of a run that is itself waiting in this script (a check queued behind another) does not count, so two waiting runs never
# wait for each other. A run still queued for a check slot, a cores lease or the cut lock (tools/slots.sh, tools/cores.sh,
# tools/check/cut-shared.sh or flock in front of its command, or the sh -c of pnpm above them) does not count either: it runs nothing
# yet. The load average counts every distro on the machine, so it alone is never the test.
# It looks every 10 seconds and returns within --max seconds (default 270, never above 280, so one blocking call stays
# under the 5-minute cache of a model session):
#   exit 0  quiet, or --file exists, or --pid has ended (one line "done: ..." for the last two, "quiet after N s" when it waited)
#   exit 3  still busy; one line "busy: <what runs>"
#   exit 2  bad arguments
# An agent calls it in a command of its own and repeats the call on 3; it never loops inside one call:
#   tools/wait-quiet.sh; echo "rc=$?"
# tools/check.sh and e2e/run.mjs call it before their heavy steps unless CHECK_WAIT=0 (the default is 0 inside a release
# cut and in CI, which own the machine, and 1 elsewhere); they repeat on 3 for CHECK_WAIT_MAX seconds (default 1800) and
# then run anyway. Tests set WAIT_QUIET_POLL (seconds between looks), WAIT_QUIET_LOADAVG_FILE, WAIT_QUIET_CPUS and
# WAIT_QUIET_PATTERN (the egrep that pgrep -f matches against command lines). The browser daemon of playwright-cli
# never counts, whatever the pattern; a playwright test run does.
set -uo pipefail

die() { echo "wait-quiet: $*" >&2; exit 2; }
MAX=270 FILE="" PID=""
while (($#)); do
  case $1 in
    --max) (($# >= 2)) || die "--max needs a value"; MAX=$2; shift ;;
    --file) (($# >= 2)) || die "--file needs a value"; FILE=$2; shift ;;
    --pid) (($# >= 2)) || die "--pid needs a value"; PID=$2; shift ;;
    *) die "unknown option $1 (usage: wait-quiet.sh [--max S] [--file F | --pid P])" ;;
  esac
  shift
done
[[ $MAX =~ ^[0-9]+$ ]] || die "--max is a whole number of seconds"
[[ -z $PID || $PID =~ ^[0-9]+$ ]] || die "--pid is a process id"
[[ -z $FILE || -z $PID ]] || die "--file and --pid are alternatives"
if ((MAX > 280)); then echo "wait-quiet: --max $MAX is above 280, using 280" >&2; MAX=280; fi

. "$(dirname "${BASH_SOURCE[0]}")/lib/owner.sh" # alive

POLL=${WAIT_QUIET_POLL:-10}
LOADFILE=${WAIT_QUIET_LOADAVG_FILE:-/proc/loadavg}
CPUS=${WAIT_QUIET_CPUS:-$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}
PATTERN=${WAIT_QUIET_PATTERN:-'node_modules/(\.bin/vitest|vitest/)|node_modules/(@playwright/test|playwright|playwright-core)/|node_modules/typescript/(bin|lib)/tsc|tools/check\.sh'}
# playwright-cli keeps a browser daemon open for the agents and a dashboard (`show`) for the human; open and idle,
# neither is a heavy check
IDLE_BROWSER='(^| )[^ ]*node_modules/@playwright/cli/node_modules/playwright-core/lib/entry/(cliDaemon|dashboardApp)\.js( |$)'
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)

ppid_of() { # the parent of a process, empty when it is gone
  local s
  { s=$(<"/proc/$1/stat"); } 2>/dev/null || return 0
  s=${s##*) }
  set -- $s
  echo "${2:-}"
}

up_from() { # up_from PID: PID and every ancestor of it, space separated
  local p=$1 out=""
  while [[ $p =~ ^[0-9]+$ ]] && ((p > 1)); do out+=" $p"; p=$(ppid_of "$p"); done
  echo "$out"
}

queued_cmd() { # true for the wrapper of a run that waits for a check slot, a cores lease or the cut lock
  [[ $1 =~ ^([^\ ]*/)?(bash|sh)\ +([^\ ]*/)?(slots|cores|cut-shared)\.sh(\ |$) || $1 =~ ^([^\ ]*/)?flock(\ |$) ]]
}

queued() { # queued PID CMD: the process is such a wrapper, or the `sh -c` of pnpm whose child is one
  # It runs nothing yet, and the holders of the slots it waits for would otherwise wait for it. Once its command runs, that
  # command counts on its own. Only the shell of pnpm is looked through: a check that runs the slot suites as children is busy.
  local c
  queued_cmd "$2" && return 0
  [[ $2 =~ ^([^\ ]*/)?(sh|bash)\ +-c\  ]] || return 1
  for c in $(pgrep -P "$1" 2>/dev/null); do
    queued_cmd "$(tr '\0' ' ' <"/proc/$c/cmdline" 2>/dev/null)" && return 0
  done
  return 1
}

kind_of() { # a short name for a command line
  case $1 in
    *vitest*) echo vitest ;;
    *playwright*) echo playwright ;;
    *typescript*) echo tsc ;;
    *check.sh*) echo check.sh ;;
    *) echo "${1%% *}" ;;
  esac
}

busy_load() { # prints "load L" when the one-minute load is not below twice the CPUs
  local l
  read -r l _ <"$LOADFILE" 2>/dev/null || return 0
  [[ $l =~ ^[0-9.]+$ ]] || return 0
  awk -v l="$l" -v c="$CPUS" 'BEGIN { exit !(l >= 2 * c) }' && echo "load $l (limit $((2 * CPUS)))"
  return 0
}

busy_procs() { # one "kind (dir)" per kind and worktree of the heavy processes that are not ours and not waiting
  local skip p dir cmd seen=" " item
  skip=$(up_from $$)
  for p in $(pgrep -f 'wait-quiet\.sh' 2>/dev/null); do skip+=$(up_from "$p"); done
  skip+=" "
  for p in $(pgrep -f "$PATTERN" 2>/dev/null); do
    [[ $skip == *" $p "* ]] && continue
    [[ -d /proc/$p ]] || continue
    cmd=$(tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null)
    [[ $cmd =~ $IDLE_BROWSER ]] && continue
    queued "$p" "$cmd" && continue
    dir=$(readlink "/proc/$p/cwd" 2>/dev/null)
    [[ -n $dir && ( $dir == "$ROOT" || $dir == "$ROOT"/* ) ]] && continue
    item="$(kind_of "$cmd") (${dir:-?})"
    [[ $seen == *" $item "* ]] && continue
    seen+="$item "
    echo "$item"
  done
}

what_busy() { # the reasons for being busy, one line, empty when quiet
  local out="" l
  while IFS= read -r l; do out+="${out:+; }$l"; done < <(busy_procs | head -n 4; busy_load)
  echo "$out"
}

began=$SECONDS slept=0
while :; do
  if [[ -n $FILE && -e $FILE ]]; then echo "done: $FILE exists"; exit 0; fi
  if [[ -n $PID ]] && ! alive "$PID"; then echo "done: pid $PID has ended"; exit 0; fi
  what=$(what_busy)
  if [[ -z $what ]]; then
    ((slept == 0)) || echo "quiet after $((SECONDS - began)) s"
    exit 0
  fi
  left=$((MAX - (SECONDS - began)))
  if ((left <= 0)); then echo "busy: $what"; exit 3; fi
  slept=1
  # sleep the poll, or what is left of --max when that is shorter
  if awk -v p="$POLL" -v l="$left" 'BEGIN { exit !(p > l) }'; then sleep "$left"; else sleep "$POLL"; fi
done
