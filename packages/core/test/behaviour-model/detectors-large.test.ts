import { expect, it } from "vitest";
import { createContext } from "../../src/analysis/context.ts";
import { creditStack } from "../../src/behaviour/credit-stack.ts";
import { paydayEffect } from "../../src/behaviour/payday.ts";
import { splitCandidates } from "../../src/behaviour/split.ts";
import { randomHistory } from "../gen.ts";

// The work of the detectors that behaviour-model.perf.test.ts times on 100 000 rows: on a history of 5000 rows each
// answers, and a second run on a context of its own answers the same (a detector is a pure function over the rows).
it("runs credit stacking, the payday effect and split questions over a long history and repeats its answers", () => {
  const h = randomHistory(3, 5_000, { months: 24, settled: true });
  const run = () => {
    const ctx = createContext(h.txs, h.accounts, "2025-10-28");
    return [creditStack(ctx), paydayEffect(ctx), splitCandidates(ctx)] as const;
  };
  const first = run();
  expect(first.every((r) => r !== undefined)).toBe(true);
  expect(run()).toEqual(first);
}, 30_000);
