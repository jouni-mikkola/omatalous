import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { expectedEveryday, expectedEverydayPerDay } from "../src/analysis/expected.ts";
import { addDays } from "../src/dates.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };

const TODAY = "2026-10-09";
const FIRST = "2026-03-01";

/** A purchase of `cents` every day from the first of March to the last day of September, a shop of its own each time so that no series forms. */
const shopping = (cents = 4000, accountId = "acc-1"): Transaction[] => {
  const rows: Transaction[] = [];
  for (let d: IsoDate = FIRST, n = 0; d <= "2026-09-30"; d = addDays(d, 1), n++) rows.push(tx({ accountId, bookingDate: d, amountCents: -cents, merchant: `Kauppa ${accountId} ${n}`, category: "groceries" }));
  return rows;
};
const ctxOf = (rows: Transaction[], today: IsoDate = TODAY) => createContext(rows.filter((t) => t.bookingDate <= today), [checking, card], today);
const found = (rows: Transaction[], from: IsoDate, until: IsoDate, keep?: Parameters<typeof expectedEveryday>[3]) => {
  const e = expectedEveryday(ctxOf(rows), from, until, keep);
  if (typeof e === "string") throw new Error(e);
  return e;
};

describe("the expected everyday spending of a span of days", () => {
  it("40 euros a day for six months is 40 euros a day, in a month of 31 days too (the 31st counts as an average day)", () => {
    expect(found(shopping(), "2026-10-10", "2026-10-16").cents).toBe(7 * 4000);
    expect(expectedEverydayPerDay(ctxOf(shopping()), "2026-10")).toBe(4000);
  });

  it("a span may run over the end of a month, and none is none", () => {
    expect(found(shopping(), "2026-10-29", "2026-11-02").cents).toBe(5 * 4000);
    expect(found(shopping(), "2026-10-10", "2026-10-09").cents).toBe(0);
  });

  it("a sofa of 1 900 euros in one month is a one-off: the figure leaves it where it was", () => {
    const sofa = tx({ bookingDate: "2026-07-14", amountCents: -190_000, merchant: "Huonekaluliike", category: "home" });
    expect(found([...shopping(), sofa], "2026-10-10", "2026-10-16").cents).toBe(7 * 4000);
  });

  it("the rows of a bill series are in no day", () => {
    const rent = ["2026-07-05", "2026-08-05", "2026-09-05"].map((bookingDate) => tx({ bookingDate, amountCents: -90_000, merchant: "Vuokranantaja Oy", category: "housing" }));
    const ctx = ctxOf([...shopping(), ...rent]);
    expect(rent.every((t) => ctx.fixedIds.has(t.id))).toBe(true);
    expect(found([...shopping(), ...rent], "2026-10-01", "2026-10-31").cents).toBe(31 * 4000);
  });

  it("a refund lowers its day, and money in that is no refund is in none", () => {
    const refund = tx({ bookingDate: "2026-09-10", amountCents: 1500, merchant: "Kauppa acc-1 193", category: "groceries" });
    const pay = tx({ bookingDate: "2026-09-10", amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" });
    // one base month in six has 15 euros less on the 10th
    expect(found([...shopping(), refund, pay], "2026-10-10", "2026-10-10").cents).toBe(4000 - 250);
  });

  it("with `keep` it is what those accounts paid, and the parts add up to the whole", () => {
    const rows = [...shopping(4000, "acc-1"), ...shopping(1000, "card")];
    const [whole, own, onCard] = [undefined, (t: { accountId: string }) => t.accountId === "acc-1", (t: { accountId: string }) => t.accountId === "card"].map((keep) => found(rows, "2026-10-10", "2026-10-16", keep).cents);
    expect([whole, own, onCard]).toEqual([5000 * 7, 4000 * 7, 1000 * 7]);
  });

  it("its range is the lower and upper quartile of the base months, around the figure", () => {
    const steps = shopping().map((t) => ({ ...t, amountCents: t.bookingDate < "2026-07-01" ? -3000 : -5000 }));
    const e = found(steps, "2026-10-10", "2026-10-16");
    expect(e.cents).toBe(7 * 4000);
    expect(e.lowCents).toBe(7 * 3000);
    expect(e.highCents).toBe(7 * 5000);
    expect(e.months).toBe(6);
  });

  it("under three complete months there is no figure, and the reason is history", () => {
    const rows = [...shopping()].filter((t) => t.bookingDate >= "2026-08-01");
    expect(expectedEveryday(ctxOf(rows), "2026-10-10", "2026-10-16")).toBe("history");
    expect(expectedEverydayPerDay(ctxOf(rows), "2026-10")).toBe(0);
  });
});
