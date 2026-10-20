#!/usr/bin/env bash
# Runs a command under the shared cut lock: tools/check/cut-shared.sh <label> -- <command>...
# A release cuts under an exclusive lock on cut.lock; a check holds it shared, so the two never run at once. cut.wait is
# the cut's place in the queue: the release holds it exclusive while it waits for cut.lock, and a check takes it shared for
# a moment first, so a check that arrives while the cut waits stands behind it. Both waits share one limit
# (CUT_LOCK_WAIT, CHECK_CUT_WAIT still works; 1800 s). The command runs under the lock, which every child inherits, with
# CUT_LOCK_HELD=1 set for what it starts. With CUT_LOCK_HELD or CI set, or outside a git repository, it runs at once.
# The cut lock comes before any slot of tools/slots.sh: the release gate holds the cut while it waits for the lead's slot,
# so a run that held a slot while it waited for the cut would wait on the gate as the gate waits on it.
# Exit: the command's, or 1 when the cut still held the lock after the limit (with one line naming the lock file).
set -uo pipefail
label=${1:?usage: cut-shared.sh <label> -- <command>...}; shift
[[ ${1:-} == -- ]] || { echo "usage: cut-shared.sh <label> -- <command>..." >&2; exit 2; }
shift
if [[ -n ${CUT_LOCK_HELD:-} || -n ${CI:-} ]] || ! lock=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then exec "$@"; fi
cutwait=$lock/cut.wait lock=$lock/cut.lock limit=${CUT_LOCK_WAIT:-${CHECK_CUT_WAIT:-1800}} t0=$SECONDS rc=0
: >>"$lock"; : >>"$cutwait" 2>/dev/null
{ flock -s -n "$lock" true && { [[ ! -w $cutwait ]] || flock -s -n "$cutwait" true; }; } || echo "$label: waiting for the cut"
if [[ -w $cutwait ]]; then flock -s -w "$limit" -E 97 "$cutwait" true; rc=$?; fi
left=$((limit - (SECONDS - t0))); ((left > 0)) || left=0
((rc != 0)) || { CUT_LOCK_HELD=1 flock -s -w "$left" -E 97 "$lock" "$@"; rc=$?; }
((rc != 97)) || { echo "$label: the cut still holds $lock after $limit s, so the $label did not run" >&2; rc=1; }
exit "$rc"
