/**
 * The sources every rule walks are parsed once, here, and not inside whichever rule runs first: that rule would carry the
 * whole cost of the cold start in its own timeout (a full check on a busy machine took over 20 s for it). The hook has
 * the time the parse needs; a rule's timeout then measures that rule. `parse` keeps its trees, so the second test file on
 * a worker (the `rules` project does not isolate files) finds them parsed and the hook costs it nothing.
 */
import { beforeAll } from "vitest";
import { parse, sourceFiles } from "./lib.ts";

export function warmParse(): void {
  beforeAll(() => {
    for (const f of sourceFiles("packages/", "apps/", "tools/findings/")) parse(f);
  }, 300_000);
}
