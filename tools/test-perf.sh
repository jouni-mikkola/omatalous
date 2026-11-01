#!/usr/bin/env bash
# The timing tests (*.perf.test.ts, the `perf` project of vitest.config.ts): each holds a time against a limit, so they run
# when the machine is quiet, one file at a time.
#   tools/test-perf.sh [vitest filters]      pnpm test:perf [filters]
# It waits for a quiet machine like a check does (tools/wait-quiet.sh, one call at a time, repeated while it answers 3 for
# PERF_WAIT_MAX seconds, default 1800; 0 does not wait) and then runs the project, passing the arguments to vitest.
set -uo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$ROOT" || exit 1

began=$SECONDS
max=${PERF_WAIT_MAX:-1800}
while ((max > 0)); do
  bash "$ROOT/tools/wait-quiet.sh" --max "${PERF_WAIT_CALL:-270}"
  rc=$?
  ((rc == 3)) || break
  if ((SECONDS - began >= max)); then echo "test:perf: the machine is still busy after $((SECONDS - began)) s, running anyway"; break; fi
done
exec pnpm exec vitest run --project perf "$@"
