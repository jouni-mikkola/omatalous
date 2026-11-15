#!/usr/bin/env bash
# The timing tests (*.perf.test.ts, the `perf` project of vitest.config.ts): each holds a time against a limit, so they run
# when the machine is quiet, one file at a time.
#   tools/test-perf.sh [vitest filters]      pnpm test:perf [filters]
# It runs the project, passing the arguments to vitest.
set -uo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$ROOT" || exit 1
exec pnpm exec vitest run --project perf "$@"
