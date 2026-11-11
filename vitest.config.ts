import { configDefaults, defineConfig } from "vitest/config";
import { holdCores, startedByVitest } from "./tools/lib/cores.mjs";

// Workers by the cores this run may have (tools/cores.sh: a lease on a share of the machine, so several runs at once do not
// load it to a multiple of its cores). VITEST_MAX_WORKERS, which a check or a release cut sets, wins; with no limit vitest
// takes its own default. A tool that only reads this file (knip) takes no lease.
const share = startedByVitest() ? await holdCores("vitest") : null;

// The test files of a feature module sit in its folder: features/<kind>/<id>/index.test.ts, and those of a module a build
// adds (extensions.ts) in its own folder, which the shared tree does not have.
const CORE = ["packages/*/test/**/*.test.ts", "packages/*/src/private/**/*.test.ts"];
const RULES = "tools/repo-rules/repo-rules*.test.ts";
const REST = ["apps/*/test/**/*.test.ts", "apps/*/src/private/**/*.test.ts", "tools/**/*.test.ts"];
/** A test that compares elapsed time with a limit is a `*.perf.test.ts` and runs only in the `perf` project (docs/DEVELOPMENT.md). */
const PERF = "**/*.perf.test.ts";
/** A test that clicks and types in a page of the web app runs in a DOM (happy-dom) and keeps a fresh module cache, since it fills the global window. */
const DOM = "**/*.dom.test.ts";
/** A test that mocks a module of the code under test, or that leans on a fresh module state, needs a worker of its own: with a shared module cache the mock misses code another file loaded first. */
const ISOLATED = "**/*.isolated.test.ts";

/** Every project: the hooks each file needs. Workers that share modules (`isolate: false`) load a kit once, so a hook is set here, not in a kit.
 * The paths start at the root with a slash: with a plain relative path vitest 5.0.5 under --changed runs a setup file for the first file of a worker only. */
const EVERY = { setupFiles: ["/tools/lib/test-setup.ts"] };
/** Tests that draw tables (web code): the lazy parts of a table are loaded before the first draw. */
const TABLES = { setupFiles: ["/tools/lib/test-setup.ts", "/tools/lib/test-markup.ts"] };

export default defineConfig({
  test: {
    ...(share && !process.env.VITEST_MAX_WORKERS ? { maxWorkers: share } : {}),
    // a private TMPDIR per run; the run fails when a test leaves something in it (tools/lib/tmp-guard.ts)
    globalSetup: ["tools/lib/tmp-guard.ts"],
    // a busy machine (other builds beside the gate) makes a 1 s test take 6 s: a test's own budget is its assertion, not this
    testTimeout: 20_000,
    projects: [
      // pure domain logic: no module state to leak between files, so the files share their workers' module cache
      { test: { ...EVERY, name: "core", include: CORE, exclude: [...configDefaults.exclude, PERF, ISOLATED], isolate: false } },
      // the repo rules parse the same sources in three files: without isolation the files of a worker share the parse cache (tools/repo-rules/warm.ts)
      { test: { ...EVERY, name: "rules", include: [RULES], isolate: false } },
      // server, web and tool tests keep their state in a temporary folder and a database of their own, so they share modules too
      { test: { ...TABLES, name: "main", include: REST, exclude: [...configDefaults.exclude, PERF, ISOLATED, DOM, RULES], isolate: false } },
      // the page tests of the web app: a DOM, and the coverage floor of `pnpm coverage` reads them with the rest
      { test: { ...TABLES, name: "dom", include: ["apps/web/test/**/*.dom.test.ts"], environment: "./tools/lib/dom-environment.ts" } },
      // the files that mock a module (*.isolated.test.ts) get a fresh module cache each
      { test: { ...EVERY, name: "isolated", include: [...CORE, ...REST].map((g) => g.replace("*.test.ts", "*.isolated.test.ts")) } },
      // the timing tests run last, one file at a time, so no other test of this run loads the machine while they measure
      { test: { ...EVERY, name: "perf", include: [...CORE, ...REST].map((g) => g.replace("*.test.ts", "*.perf.test.ts")), maxWorkers: 1, fileParallelism: false, sequence: { groupOrder: 2 } } },
    ],
  },
});
