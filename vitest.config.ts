import { defineConfig } from "vitest/config";
import { holdCores } from "./tools/lib/cores.mjs";

// Workers by the cores this run may have (tools/cores.sh: a lease on a share of the machine, so several runs at once do not
// load it to a multiple of its cores). VITEST_MAX_WORKERS, which a check or a release cut sets, wins; with no limit vitest
// takes its own default.
const share = await holdCores("vitest");

export default defineConfig({
  test: {
    ...(share && !process.env.VITEST_MAX_WORKERS ? { maxWorkers: share } : {}),
    // a private TMPDIR per run; the run fails when a test leaves something in it (tools/lib/tmp-guard.ts)
    globalSetup: ["tools/lib/tmp-guard.ts"],
    // a busy machine (other builds beside the gate) makes a 1 s test take 6 s: a test's own budget is its assertion, not this
    testTimeout: 20_000,
    // the tests of a feature module sit in its folder: features/<kind>/<id>/index.test.ts
    // and those of a module a build adds (extensions.ts) in its own folder, which the shared tree does not have
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "packages/*/src/features/**/*.test.ts", "apps/*/src/features/**/*.test.ts", "packages/*/src/private/**/*.test.ts", "apps/*/src/private/**/*.test.ts", "tools/**/*.test.ts"],
  },
});
