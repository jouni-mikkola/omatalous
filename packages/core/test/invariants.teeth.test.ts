/**
 * The checks of kit/invariants.ts must fail on a household made wrong on purpose, not only pass on the generated ones.
 * Each case takes the household view of a generated household, changes what the engine said of a row the labels
 * know, and expects the check that guards it to say so.
 */
import { describe, expect, it } from "vitest";
import { type AnalysisTx, createContext } from "../src/analysis/context.ts";
import { monthKnown } from "../src/analysis/coverage.ts";
import { addMonths, dateIn, monthOf } from "../src/dates.ts";
import { buildReports } from "../src/reports/index.ts";
import { generateHousehold } from "./kit/generate.ts";
import { conservation, labelledFlow, loanParts, memberLegs, monthlyLoans, moneyIn, namesake, onePool, ownTransfers, prefix, unknownMonth, walletQuestions, walletRole } from "./kit/invariants.ts";
import type { GeneratedHousehold } from "./kit/truth.ts";
import { tx } from "./helpers.ts";
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

  it("I1b: the fee of a member transfer is allowed, and a leg that counts more than its fee is not", () => {
    const feeLegs = (t: AnalysisTx) => (h.truth.get(t.id)?.feeCents ?? 0) > 0;
    expect(memberLegs(h, whole())).toEqual([]);
    expect(whole().ctx.txs.some(feeLegs)).toBe(true);
    const bad = changed(whole(), feeLegs, (t) => ({ flows: { ...NO_FLOWS, consumption: -t.amountCents } }));
    expect(memberLegs(h, bad).map((v) => v.check)).toEqual(["I1b.member-legs"]);
  });

  it("I1c: money in from the holder's own account read as income", () => {
    expect(ownTransfers(h, whole())).toEqual([]);
    const bad = changed(whole(), (t) => labelled("own_transfer")(t) && t.amountCents > 0, () => ({ isTransfer: false, category: "income" }));
    expect(ownTransfers(h, bad).map((v) => v.check)).toEqual(["I1c.own-transfer"]);
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

  it("I3a money in: a refund is exempt by its label alone, and the same row with another label is a finding", () => {
    const unlabelled: GeneratedHousehold = { ...h, truth: new Map([...h.truth].map(([id, l]) => [id, l.kind === "refund" ? { ...l, kind: "shop" as const } : l])) };
    expect(moneyIn(unlabelled, whole())).not.toEqual(moneyIn(h, whole()));
    const bad = changed(whole(), labelled("salary"), () => ({ category: "groceries", categorySource: "default" }));
    expect(moneyIn(h, bad).some((v) => v.line.includes("as groceries"))).toBe(true);
  });

  it("I3c wallet role: a question that offers the wallet payer as the member's own money is found", () => {
    const asked = walletQuestions(h, whole());
    expect(asked.length).toBeGreaterThan(0);
    expect(walletRole(h, whole(), asked)).toEqual([]);
    expect(walletRole(h, whole(), asked.map((q) => ({ ...q, options: [...q.options, "own_money" as const] }))).map((v) => v.check)).toContain("I3c.wallet-role");
    expect(walletRole(h, whole(), asked.map((q) => ({ ...q, proposal: "own_money" as const }))).map((v) => v.check)).toContain("I3c.wallet-role");
  });

  it(
    "I4 loan parts: a member's view that loses the loan's payments no longer adds up to the household",
    () => {
      const views = viewsOf(h);
      expect(monthlyLoans(views[0]!).size).toBeGreaterThan(0);
      expect(loanParts(h, views)).toEqual([]);
      const payer = views[1]!;
      const txs = payer.ctx.txs.filter((t) => h.truth.get(t.id)?.kind !== "loan_instalment");
      const lost: HouseholdView = { ...payer, txs, ctx: createContext(txs, payer.accounts, h.today) };
      expect(txs.length).toBeLessThan(payer.ctx.txs.length);
      expect(loanParts(h, [views[0]!, lost, ...views.slice(2)]).map((v) => v.check)).toContain("I4.loan-parts");
    },
    LONG,
  );

  it(
    "I7 unknown month: a report that gives a month the data does not reach a zero",
    () => {
      // a small account with rows from three months before the household's first row: those months are unknown
      const first = whole().ctx.txs.map((t) => t.bookingDate).sort()[0]!;
      const old = { id: "sav-old", name: "Vanha säästötili", iban: null, currency: "EUR", type: "savings" } as const;
      const rows = [0, 1].map((i) => tx({ bookingDate: dateIn(addMonths(monthOf(first), -3 + i), 15), amountCents: 100, accountId: "sav-old", merchant: "Pankki", category: "other", categorySource: "rule" }));
      const txs = [...whole().ctx.txs, ...rows];
      const v: HouseholdView = { ...whole(), accounts: [...whole().accounts, old], txs, ctx: createContext(txs, [...whole().accounts, old], h.today) };
      expect(monthKnown(v.ctx, addMonths(monthOf(first), -1))).toBe(false);
      expect(unknownMonth(h, v)).toEqual([]);
      const zeroed: typeof buildReports = (input, only) => {
        const r = buildReports(input, only);
        r.spendingMonths.totals = r.spendingMonths.totals.map((x) => x ?? 0);
        return r;
      };
      expect(unknownMonth(h, v, zeroed).map((x) => x.check)).toContain("I7.unknown-month");
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
