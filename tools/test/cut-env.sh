# shellcheck shell=bash
# The shares of the cores a release cut hands its children. Sourced by every shell suite whose subject reads one of them
# (check.sh, e2e/run.mjs, tools/ci/local-proof.sh, the release command; CORES_SHARE of tools/cores.sh too, but not CORES_HELD, so that no suite takes a second lease): a suite that a check inside a cut runs inherits
# them, and none may reach its scenarios. A suite that tests how one of them is read sets it itself after this line.
unset CUT_LOCK_HELD CUT_LOCK_WAIT CUT_CPUS CORES_SHARE CHECK_JOBS E2E_WORKERS PROOF_JOBS VITEST_MAX_WORKERS npm_config_workspace_concurrency
