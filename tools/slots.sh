#!/usr/bin/env bash
# Runs a command while holding one of N slots, so a few workers on one machine do not all run their checks at once
# (four at once made seeded tests time out). Used by tools/check.sh.
#   tools/slots.sh [--dir DIR] [--pool NAME] [--slots N] [--wait SECONDS] [--label NAME] -- command [args...]
# A slot is a directory in DIR (default: check-slots in the git common dir, shared by all worktrees) that holds
# the owner's pid and start time. --pool NAME picks another default directory, <NAME>-slots, so a caller can have slots
# of its own: the lead's landing and the release gate use --pool lead --slots 1 and never wait behind the workers' two.
# A slot whose owner is gone is taken over, so a killed run does not block anyone.
# After --wait seconds (default 1800) the command runs without a slot, so a stuck holder cannot block for ever.
# CHECK_SLOTS, CHECK_SLOT_WAIT and CHECK_SLOT_POLL (seconds between tries, default 1) set the defaults.
# A wait appends one line to lead-logs/slots.log in the git common dir: the label, the seconds waited and the date.
set -uo pipefail

die() { echo "slots: $*" >&2; exit 2; }
DIR="" POOL=check SLOTS=${CHECK_SLOTS:-2} WAIT=${CHECK_SLOT_WAIT:-1800} POLL=${CHECK_SLOT_POLL:-1} LABEL=run
while (($#)); do
  case $1 in
    --dir) (($# >= 2)) || die "--dir needs a value"; DIR=$2; shift ;;
    --pool) (($# >= 2)) || die "--pool needs a value"; POOL=$2; shift ;;
    --slots) (($# >= 2)) || die "--slots needs a value"; SLOTS=$2; shift ;;
    --wait) (($# >= 2)) || die "--wait needs a value"; WAIT=$2; shift ;;
    --label) (($# >= 2)) || die "--label needs a value"; LABEL=$2; shift ;;
    --) shift; break ;;
    *) die "unknown option $1 (usage: slots.sh [--dir DIR] [--pool NAME] [--slots N] [--wait S] -- command...)" ;;
  esac
  shift
done
(($#)) || die "no command"
[[ $SLOTS =~ ^[0-9]+$ && $WAIT =~ ^[0-9]+$ ]] || die "--slots and --wait are whole numbers"
[[ $POOL =~ ^[a-z][a-z0-9-]*$ ]] || die "--pool is a short lower-case name"
((SLOTS > 0)) || exec "$@"
if [[ -z $DIR ]]; then
  suffix=-$POOL; [[ $POOL != check ]] || suffix=
  common=$(git rev-parse --git-common-dir 2>/dev/null) && DIR=$(cd "$common" && pwd)/$POOL-slots || DIR=${TMPDIR:-/tmp}/omatalous-slots$suffix-$(id -u)
fi
mkdir -p "$DIR" || die "cannot create $DIR"
# SLOTS_LOG: where a wait is written (default lead-logs/slots.log in the git common dir; empty: nowhere)
if [[ -z ${SLOTS_LOG+x} ]]; then
  common=$(git rev-parse --git-common-dir 2>/dev/null) && LOG=$(cd "$common" && pwd)/lead-logs/slots.log || LOG=''
else
  LOG=$SLOTS_LOG
fi

. "$(dirname "${BASH_SOURCE[0]}")/lib/owner.sh" # start_of, old, owner_gone: shared with the landing queue

stale() { # slot dir: true when its owner is gone
  local pid st
  if ! read -r pid st <"$1/owner" 2>/dev/null || [[ ! $pid =~ ^[0-9]+$ ]]; then old "$1"; return; fi
  owner_gone "$pid" "$st"
}

reap() { # remove a stale slot; one reaper at a time, so a slot that was just taken again is never removed
  mkdir "$DIR/reap" 2>/dev/null || { old "$DIR/reap" && rmdir "$DIR/reap" 2>/dev/null; return 1; }
  stale "$1" && rm -rf "$1"
  rmdir "$DIR/reap" 2>/dev/null
  return 0
}

ME="$$ $(start_of $$)"
MINE=""
release() { [[ -n $MINE && $(cat "$MINE/owner" 2>/dev/null) == "$ME" ]] && rm -rf "$MINE"; MINE=""; }
trap release EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

try_slot() {
  local d=$DIR/slot-$1
  mkdir "$d" 2>/dev/null || { stale "$d" && reap "$d" && mkdir "$d" 2>/dev/null; } || return 1
  echo "$ME" >"$d/owner" || return 1
  MINE=$d
}

t0=$SECONDS told=$SECONDS waited=0
until [[ -n $MINE ]]; do
  for ((n = 0; n < SLOTS; n++)); do try_slot "$n" && break; done
  [[ -z $MINE ]] || break
  waited=1
  if ((SECONDS - t0 >= WAIT)); then echo "$LABEL: no free slot after ${WAIT}s, running without one" >&2; break; fi
  if ((SECONDS - told >= 60 || SECONDS == t0)); then echo "$LABEL: all $SLOTS slots are taken, waiting for one (CHECK_SLOTS=$SLOTS)" >&2; told=$SECONDS; fi
  sleep "$POLL"
done
((SECONDS - t0 < 2)) || echo "$LABEL: waited $((SECONDS - t0))s for a slot" >&2
# every wait leaves a line (label, seconds waited, date) in the lead's logs, so that a queue shows afterwards: the line above
# goes to stderr, which workers cut off with tail. A slot taken at once is not a wait.
if ((waited)) && [[ -n $LOG ]]; then
  mkdir -p "${LOG%/*}" 2>/dev/null && printf '%s %s %s\n' "$LABEL" "$((SECONDS - t0))" "$(date '+%Y-%m-%d %H:%M:%S')" >>"$LOG" 2>/dev/null
fi

# The command runs in its own process group (set -m), so a signal sent to it reaches everything it started. A signal
# to this script is passed on and the slot stays taken until the command has ended, then the EXIT trap gives it back.
set -m
"$@" &
child=$!
forward() { kill -TERM -- "-$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null; }
trap forward INT TERM HUP
{ wait "$child"; } 2>/dev/null
rc=$?
# wait returns early when a signal arrives: wait again until the command is gone
while kill -0 "$child" 2>/dev/null; do { wait "$child"; } 2>/dev/null; rc=$?; done
exit "$rc"
