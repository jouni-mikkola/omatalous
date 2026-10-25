#!/usr/bin/env bash
# The share of the machine's cores that one heavy run (vitest, Playwright, a check) may use, so that several runs at once do
# not load the machine to a multiple of its cores and make each other's tests time out. A run takes one of K leases (the
# slots of tools/slots.sh, pool "cores", shared by the worktrees of a clone). The first run of a quiet machine takes all the
# cores, so a lone check is as fast as it can be; the other leases share half as many again between them, so the runs together
# stay within 1.5 times the cores (12 cores, 2 leases: 12 and 6). A run that finds every lease taken waits for one.
#   tools/cores.sh [--label NAME] -- command...   runs the command holding a lease; it sees CORES_SHARE (the cores it may
#                                                 use) and CORES_HELD=1, which a run inside it takes as "the lease is held"
#   tools/cores.sh --hold [--label NAME]          for a process that cannot be wrapped (vitest.config.ts, e2e/run.mjs through
#                                                 tools/lib/cores.mjs): prints the share on a line once it holds a lease, keeps
#                                                 it until its stdin ends (the holder going away, killed or not, frees it)
#   tools/cores.sh --share                        prints the numbers without taking a lease: cores, leases, the share of the first run and of the others
# Nothing is taken, and the command runs at once, when CORES_HELD is set (a run inside a run), under CI or a release cut
# (VITEST_MAX_WORKERS is set: they hand out their own shares). A caller with an E2E_WORKERS of its own takes none.
# Settings, each from the environment, else from the file check-cores.conf in the git common dir (NAME=number lines, shared by
# the worktrees), else the default:
#   CHECK_CORES        the cores to share (default: this machine's CPUs)
#   CHECK_CORE_SLOTS   K, the runs at once (default: one per 6 CPUs, at least 1); 0 sets no limit
# CHECK_SLOT_WAIT and CHECK_SLOT_POLL (tools/slots.sh) set how long a run waits for a lease before it runs without one.
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

settings() { # CORES and K from the environment, the file, the machine
  local common conf="" k v
  if common=$(git rev-parse --git-common-dir 2>/dev/null); then conf=$(cd "$common" && pwd)/check-cores.conf; fi
  if [[ -r $conf ]]; then
    while IFS='=' read -r k v; do
      case $k in
        CHECK_CORES | CHECK_CORE_SLOTS) [[ $v =~ ^[0-9]+$ && -z ${!k+x} ]] && printf -v "$k" %s "$v" ;;
      esac
    done <"$conf"
  fi
  CORES=${CHECK_CORES:-$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}
  [[ $CORES =~ ^[0-9]+$ ]] && ((CORES > 0)) || CORES=4
  K=${CHECK_CORE_SLOTS:-$((CORES / 6 > 0 ? CORES / 6 : 1))}
  [[ $K =~ ^[0-9]+$ ]] || K=1
  ((K <= CORES)) || K=$CORES
}

share_for() { # share_for HELD: the cores of a lease taken when HELD leases (its own included) were taken; 0 = no lease, run after the wait
  local s=$CORES
  if (($1 != 1 && K > 1)); then s=$((CORES / 2 / (K - 1))); fi
  echo "$((s > 0 ? s : 1))"
}

settings
mode=run label=run
while (($#)); do
  case $1 in
    --hold) mode=hold ;;
    --share) mode=share ;;
    --label) label=${2:?--label needs a value}; shift ;;
    --__held) mode=$2-held; shift ;; # inside the slot (below)
    --) shift; break ;;
    *) echo "cores: unknown option $1 (usage: cores.sh [--label NAME] [--hold] -- command...)" >&2; exit 2 ;;
  esac
  shift
done

case $mode in
  share) echo "cores=$CORES leases=$K first=$(share_for 1) others=$(share_for 2)"; exit 0 ;;
  run-held | hold-held)
    held=${SLOTS_HELD:-0}
    CORES_SHARE=$(share_for "$held"); export CORES_SHARE CORES_HELD=1
    if [[ $mode == hold-held ]]; then echo "$CORES_SHARE"; cat >/dev/null; exit 0; fi
    exec "$@"
    ;;
esac

if [[ $mode == run ]]; then (($#)) || { echo "cores: no command" >&2; exit 2; }; fi
if [[ -n ${CORES_HELD:-}${CI:-}${VITEST_MAX_WORKERS:-} ]] || ((K == 0)); then
  # the lease is somebody else's, or there is no limit: the share is the one already handed down, else the whole machine
  CORES_SHARE=${CORES_SHARE:-$CORES}; export CORES_SHARE
  if [[ $mode == hold ]]; then echo "$CORES_SHARE"; cat >/dev/null; exit 0; fi
  exec "$@"
fi
if [[ $mode == hold ]]; then
  exec bash "$HERE/slots.sh" --pool cores --slots "$K" --label "$label" -- bash "$HERE/cores.sh" --__held hold
fi
exec bash "$HERE/slots.sh" --pool cores --slots "$K" --label "$label" -- bash "$HERE/cores.sh" --__held run -- "$@"
