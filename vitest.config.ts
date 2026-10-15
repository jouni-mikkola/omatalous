import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // a private TMPDIR per run; the run fails when a test leaves something in it (tools/lib/tmp-guard.ts)
    globalSetup: ["tools/lib/tmp-guard.ts"],
    // the tests of a feature module sit in its folder: features/<kind>/<id>/index.test.ts
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "packages/*/src/features/**/*.test.ts", "apps/*/src/features/**/*.test.ts", "tools/**/*.test.ts"],
  },
});
