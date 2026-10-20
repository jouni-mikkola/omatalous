import { describe, expect, it } from "vitest";
import { billMonth, billMonthOf } from "../src/analysis/bill-month.ts";
import { createContext } from "../src/analysis/context.ts";
import { explain } from "../src/explain/explain.ts";
import { addDays } from "../src/dates.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const today = "2026-10-16";

/** Rent on the 2nd, Spotify on the 11th (12,99 € from June), Elisa on the 25th, Telia on the 8th until August. */
function household(from: IsoDate, to: IsoDate): Transaction[] {
  const rows: Transaction[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = Number(d.slice(8, 10));
    rows.push(tx({ bookingDate: d, amountCents: -2500, merchant: "Prisma", category: "groceries" }));
    if (day === 2) rows.push(tx({ bookingDate: d, amountCents: -95000, merchant: "Sato", category: "housing" }));
    if (day === 11) rows.push(tx({ bookingDate: d, amountCents: d >= "2026-06-01" ? -1299 : -1199, merchant: "Spotify", category: "subscriptions" }));
    if (day === 25) rows.push(tx({ bookingDate: d, amountCents: -2490, merchant: "Elisa", category: "subscriptions" }));
    if (day === 8 && d <= "2026-09-08") rows.push(tx({ bookingDate: d, amountCents: -3990, merchant: "Telia", category: "subscriptions" }));
  }
  return rows;
}

describe("bill month", () => {
  const ctx = createContext(household("2025-06-01", today), [checking], today);
  const board = billMonth(ctx, "2026-10", new Set());
  const state = (merchant: string) => board.rows.filter((r) => r.merchant === merchant).map((r) => `${r.state} ${r.date}`);

  it("puts a missed bill first, then what is coming, then what was paid", () => {
    expect(board.rows.map((r) => r.state)).toEqual([...board.rows.map((r) => r.state)].sort((a, b) => ["missing", "coming", "paid"].indexOf(a) - ["missing", "coming", "paid"].indexOf(b)));
    expect(board.rows[0]).toMatchObject({ merchant: "Telia", state: "missing", date: "2026-10-08" });
    expect(state("Sato")).toEqual(["paid 2026-10-02"]);
    expect(state("Spotify")).toEqual(["paid 2026-10-11"]);
    expect(state("Elisa")).toEqual(["coming 2026-10-25"]);
    expect(state("Prisma")).toEqual([]);
  });

  it("adds each state up to the month's due", () => {
    const { paidCents, comingCents, missingCents, dueCents } = board.totals;
    expect([paidCents, comingCents, missingCents]).toEqual([95000 + 1299, 2490, 3990]);
    expect(dueCents).toBe(paidCents + comingCents + missingCents);
  });

  it("leaves a cancelled series out, missed or not", () => {
    expect(billMonth(ctx, "2026-10", new Set(["Telia"])).rows.some((r) => r.merchant === "Telia")).toBe(false);
  });

  it("shows only what was paid in a past month, and only what is coming in the next", () => {
    expect(billMonth(ctx, "2026-08", new Set()).rows.every((r) => r.state === "paid")).toBe(true);
    const next = billMonth(ctx, "2026-11", new Set());
    expect(next.rows.map((r) => `${r.merchant} ${r.state}`)).toEqual(["Sato coming", "Spotify coming", "Elisa coming"]);
  });

  it("clamps the asked month to twelve back and one ahead", () => {
    expect(billMonthOf(today, "2020-01")).toBe("2025-10");
    expect(billMonthOf(today, "2027-05")).toBe("2026-11");
    expect(billMonthOf(today, "lokakuu")).toBe("2026-10");
  });

  it("names the row that paid a paid bill, and the month's fixed costs as the series run", () => {
    const sato = board.rows.find((r) => r.merchant === "Sato")!;
    expect(ctx.txs.find((t) => t.id === sato.txId)).toMatchObject({ bookingDate: "2026-10-02", amountCents: -95000 });
    expect(board.fixedMonthlyCents).toBe(95000 + 1299 + 2490 + 3990);
    expect(billMonth(ctx, "2026-10", new Set(["Telia"])).fixedMonthlyCents).toBe(95000 + 1299 + 2490);
  });
});

describe("the figures of Laskut, told by their rows", () => {
  const ctx = createContext(household("2025-06-01", today), [checking], today);
  const range = { from: "2026-10-01", to: "2026-10-31" };
  const args = { view: "own" as const, range, cancelled: new Set<string>() };
  const merchantOf = (id: string) => ctx.txs.find((t) => t.id === id)!.merchant;

  it("adds each state up to the board's own figure, a paid bill as the row that paid it", () => {
    const board = billMonth(ctx, "2026-10", new Set());
    for (const [figure, cents] of [["bills.paid", board.totals.paidCents], ["bills.coming", board.totals.comingCents], ["bills.missing", board.totals.missingCents], ["bills.due", board.totals.dueCents]] as const) {
      const e = explain(figure, ctx, args);
      expect(e.cents).toBe(cents);
      expect(e.check).toEqual({ kind: "sum", diffCents: 0 });
    }
    const paid = explain("bills.paid", ctx, args).lines;
    expect(paid.map((l) => `${l.day} ${merchantOf(l.id)} ${l.cents}`)).toEqual(["2026-10-02 Sato 95000", "2026-10-11 Spotify 1299"]);
  });

  it("tells a coming or missing bill by the series' latest charge", () => {
    expect(explain("bills.coming", ctx, args).lines.map((l) => `${l.day} ${merchantOf(l.id)} ${l.cents}`)).toEqual(["2026-09-25 Elisa 2490"]);
    expect(explain("bills.missing", ctx, args).lines.map((l) => `${l.day} ${merchantOf(l.id)} ${l.cents}`)).toEqual(["2026-09-08 Telia 3990"]);
  });

  it("tells the fixed costs and the subscriptions of a month by series, a cancelled one left out", () => {
    const fixed = explain("bills.fixed", ctx, { ...args, cancelled: new Set(["Telia"]) });
    expect(fixed.cents).toBe(95000 + 1299 + 2490);
    expect(fixed.check.kind === "sum" && fixed.check.diffCents).toBe(0);
    expect(fixed.lines.map((l) => merchantOf(l.id)).sort()).toEqual(["Elisa", "Sato", "Spotify"]);
    const subs = explain("bills.subs", ctx, args);
    expect(subs.check.kind === "sum" && subs.check.diffCents).toBe(0);
  });
});
