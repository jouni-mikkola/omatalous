import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // a private TMPDIR per run; the run fails when a test leaves something in it (tools/lib/tmp-guard.ts)
    globalSetup: ["tools/lib/tmp-guard.ts"],
    // a busy machine (other builds beside the gate) makes a 1 s test take 6 s: a test's own budget is its assertion, not this
    testTimeout: 20_000,
    // the tests of a feature module sit in its folder: features/<kind>/<id>/index.test.ts
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "packages/*/src/features/**/*.test.ts", "apps/*/src/features/**/*.test.ts", "tools/**/*.test.ts"],
  },
});
