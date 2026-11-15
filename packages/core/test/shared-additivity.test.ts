/**
 * A figure over an account several members use is a part and a whole (shared.ts). Over households of two to four
 * members, with the split of the joint account said and unknown: the members' parts of a loan's payment add up to the
 * household's, every view reads the bank's whole the same, and the unsaved loans total adds up on its part side.
 */
import { describe, expect, it } from "vitest";
import { loanProposals } from "../src/loan-detect.ts";
import { unsavedLoans } from "../src/household-debts.ts";
import { isCut, paymentOf, sharedOf, sharedRow, sumShared } from "../src/shared.ts";
import { NO_INPUTS } from "../src/types.ts";
import { generateHousehold } from "./kit/generate.ts";
import type { Spec } from "./kit/truth.ts";
import { viewsOf } from "../../../tools/findings/households.ts";

const LONG = 120_000;

describe("shared.ts", () => {
  it("reads a row as its part and its whole, which are one where the row is not cut", () => {
    expect(sharedRow({ amountCents: -4250, wholeCents: -8500 })).toEqual({ part: -4250, whole: -8500 });
    expect(sharedRow({ amountCents: -4250 })).toEqual({ part: -4250, whole: -4250 });
    expect(isCut({ wholeCents: -8500 })).toBe(true);
    expect(isCut({})).toBe(false);
  });

  it("adds one side of the figures at a time", () => {
    const figures = [sharedOf(100, 200), sharedOf(50), sharedOf(0, 70)];
    expect(sumShared(figures, "part")).toBe(150);
    expect(sumShared(figures, "whole")).toBe(320);
  });

  it("reads a proposal's payment as its monthly part and the bank's payment", () => {
    expect(paymentOf({ monthlyCents: 30_000, paymentCents: 60_000 })).toEqual({ part: 30_000, whole: 60_000 });
  });

  it("totals unsaved loans on the side it is asked for, the part by default", () => {
    const rows = [
      { payee: "Lender A", monthlyCents: 30_000, paymentCents: 60_000 },
      { payee: "Lender B", monthlyCents: 10_000, paymentCents: 10_000 },
    ];
    expect(unsavedLoans(rows)?.paymentCents).toBe(40_000);
    expect(unsavedLoans(rows, "whole")?.paymentCents).toBe(70_000);
    expect(unsavedLoans([])).toBeNull();
  });
});

const SPECS: Spec[] = ([2, 3, 4] as const).flatMap((members) => (["said", "unknown"] as const).flatMap((joint) => (["joint", "checking"] as const).map((loan): Spec => ({ members, joint, loan, cards: "connected" }))));

describe("the members of a household add up to it", () => {
  it(
    "for each loan's payment: the parts add up to the household's, and every view reads the bank's whole the same",
    () => {
      for (const spec of SPECS) {
        const h = generateHousehold(spec, 1);
        const [household, ...members] = viewsOf(h);
        expect(members.length, h.name).toBe(spec.members);
        const proposals = (v: typeof household) => loanProposals(v!.ctx, NO_INPUTS);
        const whole = proposals(household);
        expect(whole.length, h.name).toBeGreaterThan(0);
        const byMember = members.map(proposals);
        for (const p of whole) {
          const mine = byMember.flatMap((list) => list.filter((x) => x.key === p.key));
          expect(sumShared(mine.map(paymentOf), "part"), `${h.name}: ${p.key}`).toBe(p.monthlyCents);
          for (const x of mine) expect(x.paymentCents, `${h.name}: ${p.key}`).toBe(p.paymentCents);
        }
      }
    },
    LONG,
  );

  it(
    "for the unsaved loans total: the members' totals add up to the household's",
    () => {
      for (const spec of SPECS) {
        const h = generateHousehold(spec, 1);
        const [household, ...members] = viewsOf(h);
        const total = (v: typeof household) => unsavedLoans(loanProposals(v!.ctx, NO_INPUTS))?.paymentCents ?? 0;
        expect(members.reduce((sum, v) => sum + total(v), 0), h.name).toBe(total(household));
      }
    },
    LONG,
  );
});
