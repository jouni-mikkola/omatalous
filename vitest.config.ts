import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // the tests of a feature module sit in its folder: features/<kind>/<id>/index.test.ts
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "packages/*/src/features/**/*.test.ts", "apps/*/src/features/**/*.test.ts", "tools/**/*.test.ts"],
  },
});
