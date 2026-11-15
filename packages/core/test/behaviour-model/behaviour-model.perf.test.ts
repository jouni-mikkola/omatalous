/**
 * P7: a detector is a pure function over the rows, under 1 s per 10 000 rows. The three of BA1 together take about
 * 0,2 s on 100 000 rows on an idle machine; the budget leaves room for a busy one.
 */
import { expect, it } from "vitest";
import { createContext } from "../../src/analysis/context.ts";
import { creditStack } from "../../src/behaviour/credit-stack.ts";
import { paydayEffect } from "../../src/behaviour/payday.ts";
import { splitCandidates } from "../../src/behaviour/split.ts";
import { randomHistory } from "../gen.ts";
import { bestOfSync } from "../../../../tools/lib/timing.ts";

it("runs credit stacking, the payday effect and split questions over 100 000 rows within 1 s", () => {
  const h = randomHistory(3, 100_000, { months: 24, settled: true });
  // each run on a context of its own, so no run reads what an earlier one left in it
  let ctx: ReturnType<typeof createContext>;
  const { ms, result } = bestOfSync(
    2,
    () => [creditStack(ctx), paydayEffect(ctx), splitCandidates(ctx)] as const,
    () => (ctx = createContext(h.txs, h.accounts, "2025-10-28")),
  );
  expect(result.every((r) => r !== undefined)).toBe(true);
  expect(ms).toBeLessThan(1000);
}, 30_000);
