/** The time of long work: a reprocess and the build of its analysis leave the loop to other members in short turns. It runs in the perf project (docs/DEVELOPMENT.md). */
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { setupApp } from "./helpers.ts";
import { history } from "./yielding-kit.ts";

/** The longest time the event loop went without a turn while `work` ran, and how long `work` took. */
async function longestHold(work: () => Promise<unknown>): Promise<{ hold: number; total: number }> {
  let hold = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    hold = Math.max(hold, now - last);
    last = now;
  }, 1);
  const start = performance.now();
  await work();
  const total = performance.now() - start;
  // a hold that ends with the work is seen by the next tick only
  await new Promise((r) => setTimeout(r, 2));
  clearInterval(timer);
  return { hold, total };
}

describe("one user's reprocess and the others' requests", () => {
  it("a reprocess and the build of its analysis leave the loop to other members in short turns", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 12_000);
    const other = await setup.member("toinen");
    // what the other member does meanwhile: a short request at a time
    const waits: number[] = [];
    let done = false;
    const asking = (async () => {
      while (!done) {
        const start = performance.now();
        expect((await other.call("GET", "/api/auth/state")).status).toBe(200);
        waits.push(performance.now() - start);
        await new Promise((r) => setTimeout(r, 2));
      }
    })();
    const run = await longestHold(() => reprocess(repo, setup.s.settings));
    const build = await longestHold(() => setup.s.analysis.get(setup.s, setup.adminId, "own"));
    done = true;
    await asking;
    // relative bounds hold on a busy machine too: no piece takes half of the whole
    expect(run.hold).toBeLessThan(run.total / 2);
    expect(build.hold).toBeLessThan(build.total / 2);
    expect(waits.length).toBeGreaterThan(4);
    expect(Math.max(...waits)).toBeLessThan((run.total + build.total) / 2);
  });
});
