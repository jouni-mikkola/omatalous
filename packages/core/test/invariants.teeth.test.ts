/**
 * The checks of kit/invariants.ts must fail on a household made wrong on purpose, not only pass on the generated ones.
 * Each case takes the household view of a generated household, changes what the engine said of a row the labels
 * know, and expects the check that guards it to say so.
 */
import { describe, expect, it } from "vitest";
import type { AnalysisTx } from "../src/analysis/context.ts";
import { createContext } from "../src/analysis/context.ts";
import { generateHousehold } from "./kit/generate.ts";
import { conservation, labelledFlow, memberLegs, namesake, onePool, prefix } from "./kit/invariants.ts";
import type { GeneratedHousehold } from "./kit/truth.ts";
import { type HouseholdView, viewsOf } from "../../../tools/findings/households.ts";

const LONG = 60_000;
const NO_FLOWS = { consumption: 0, debt: 0, saved: 0, income: 0, borrowed: 0 };

const h: GeneratedHousehold = generateHousehold({ members: 2, joint: "said", loan: "checking", cards: "connected", events: ["benefit-rule", "payment-app", "namesake", "member-fee", "refund"] }, 1);
const whole = (): HouseholdView => viewsOf(h)[0]!;

/** The view with the rows `pick` chooses changed by `change`, in the rows and in the context the checks read. */
function changed(v: HouseholdView, pick: (t: AnalysisTx) => boolean, change: (t: AnalysisTx) => Partial<AnalysisTx>): HouseholdView {
  const txs = v.ctx.txs.map((t) => (pick(t) ? { ...t, ...change(t) } : t));
  return { ...v, txs, ctx: { ...createContext(txs, v.accounts, h.today), txs } };
}
const labelled = (kind: string, event?: string) => (t: AnalysisTx) => h.truth.get(t.id)?.kind === kind && (event === undefined || h.truth.get(t.id)?.event === event);

describe("the invariant checks catch a household made wrong", () => {
  it("I3 labelled flow: a salary counted as spending", () => {
    expect(labelledFlow(h, whole()).filter((v) => v.line.includes("salary"))).toEqual([]);
    const bad = changed(whole(), labelled("salary"), () => ({ flows: { ...NO_FLOWS, consumption: 1 } }));
    expect(labelledFlow(h, bad).some((v) => v.line.includes("salary"))).toBe(true);
  });

  it(
    "I3b prefix: both rows of a business turned into a person's payments are found by their labels",
    () => {
      const bad = changed(whole(), (t) => (t.counterparty ?? "").endsWith("TAIKA PIZZA"), () => ({ category: "p2p" }));
      const found = prefix(h, bad).map((v) => v.line);
      expect(found.some((line) => line.includes(" TAIKA PIZZA is a business and counts as p2p") && !line.includes("MOBILEPAY"))).toBe(true);
      expect(found.some((line) => line.includes("MOBILEPAY TAIKA PIZZA is a business and counts as p2p"))).toBe(true);
    },
    LONG,
  );

  it("I3d namesake: a stranger's payment read as a transfer between the household's own accounts", () => {
    expect(namesake(h, whole())).toEqual([]);
    const bad = changed(whole(), (t) => h.truth.get(t.id)?.event === "namesake", () => ({ isTransfer: true }));
    expect(namesake(h, bad).map((v) => v.check)).toEqual(["I3d.namesake"]);
  });

  it("I1b: an own transfer counted as spending in the household view", () => {
    const bad = changed(whole(), labelled("own_transfer"), () => ({ flows: { ...NO_FLOWS, consumption: 1 } }));
    expect(memberLegs(h, bad).map((v) => v.check)).toEqual(["I1b.member-legs"]);
  });

  it(
    "I1 bridge: a shop purchase on a card that no flow counted leaves a residual in its month",
    () => {
      const shop = whole().ctx.txs.find((t) => h.truth.get(t.id)?.kind === "shop" && t.bookingDate.startsWith("2025-09"))!;
      const bad = changed(whole(), (t) => t.id === shop.id, () => ({ flows: NO_FLOWS }));
      const residualIn = (v: HouseholdView): number => Number(/^residual (-?\d+)/.exec(conservation(h, v).find((x) => x.month === "2025-09")?.line ?? "residual 0")![1]);
      // the purchase was spending of -amount: leaving it out raises the month's residual by exactly that
      expect(residualIn(bad) - residualIn(whole())).toBe(-shop.amountCents);
    },
    LONG,
  );

  it(
    "I1 pool and cards: a card's debt taken off while the pool does not pay its bills",
    () => {
      const v = whole();
      expect(onePool(h, v).filter((x) => x.check === "I1.pool-cards")).toEqual([]);
      const without = new Set(["chk-1", "joint"]);
      const found = onePool(h, v, without).filter((x) => x.check === "I1.pool-cards");
      expect(found.some((x) => x.line.includes("card-0") && x.line.includes("chk-0"))).toBe(true);
    },
    LONG,
  );
});
