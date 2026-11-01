/**
 * What a period leaves out, told with the amount (analysis/notices.ts): card bills whose purchases are not seen, rows in
 * another currency, and the days before the bank history. Made-up data; a period that leaves nothing out has no notice.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { coverageNotices } from "../src/analysis/notices.ts";
import type { ForeignDay } from "../src/foreign-rows.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-16";
const checking: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking", bank: "Nordea" };
const row = (bookingDate: string, amountCents: number, over: Partial<ReturnType<typeof tx>> = {}) => tx({ accountId: "chk", bookingDate, amountCents, category: "groceries", ...over });
const bill = (bookingDate: string, euros: number) => row(bookingDate, -euros * 100, { category: "card_bill", merchant: "Resurs Bank", counterparty: "Resurs Bank" });
const foreign = (...rows: { day: string; currency: string; amountMinor: number }[]): ForeignDay[] => [
  { accountId: "chk", count: rows.length, newestDay: rows.map((r) => r.day).sort().pop()!, rows: rows.map((r) => ({ ...r, scale: 2 })) },
];
const ctxOf = (rows: ReturnType<typeof row>[], foreignRows: ForeignDay[] = []) => createContext(rows, [checking], TODAY, undefined, foreignRows, [{ accountId: "chk", askedFrom: "2026-01-01", firstRowDay: rows[0]?.bookingDate ?? null, source: "default" }]);
const whole = { from: "2026-02-01", to: "2026-09-30" };

describe("coverage notices", () => {
  it("tells the card bills of a card that is not connected, with their sum", () => {
    const rows = [row("2026-02-03", -5000), bill("2026-03-05", 120), bill("2026-04-05", 80), bill("2026-10-05", 999)];
    const [n, ...rest] = coverageNotices(ctxOf(rows), whole);
    expect(rest).toEqual([]);
    expect(n).toMatchObject({ kind: "cards", cents: 20_000 });
    expect(n!.text.replace(/\s/g, " ")).toContain("200 €");
    expect(n!.text).toContain("Resurs Bank ei ole yhdistetty");
  });

  it("sums the rows of another currency per currency, in the bank's figure, inside the period only", () => {
    const rows = [row("2026-02-03", -5000)];
    const f = foreign({ day: "2026-03-10", currency: "USD", amountMinor: -2000 }, { day: "2026-04-10", currency: "USD", amountMinor: -500 }, { day: "2026-05-10", currency: "SEK", amountMinor: -10_000 }, { day: "2026-10-02", currency: "USD", amountMinor: -9900 });
    const n = coverageNotices(ctxOf(rows, f), whole);
    expect(n).toHaveLength(1);
    expect(n[0]!.currencies).toEqual([
      { currency: "SEK", count: 1, totalMinor: -10_000, scale: 2, outMinor: -10_000, inMinor: 0 },
      { currency: "USD", count: 2, totalMinor: -2500, scale: 2, outMinor: -2500, inMinor: 0 },
    ]);
    expect(n[0]!.text).toContain("2 riviä, −25,00 USD");
    expect(n[0]!.text).toContain("1 rivi, −100,00 SEK");
  });

  it("counts the days of the period before the first known day", () => {
    const n = coverageNotices(ctxOf([row("2026-05-01", -5000)]), whole);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ kind: "history", days: 89, from: "2026-05-01" });
    expect(n[0]!.text).toContain("1.5.2026");
    expect(n[0]!.text).toContain("89 päivää");
  });

  it("is quiet when the period leaves nothing out, and for near misses", () => {
    const rows = [row("2026-02-02", -5000), bill("2026-12-05", 50)];
    // the first day is within the slack of the period's first day; a bill and a dollar row outside the period do not count
    expect(coverageNotices(ctxOf(rows, foreign({ day: "2026-10-02", currency: "USD", amountMinor: -100 })), whole)).toEqual([]);
    // a period that has not begun has nothing to leave out
    expect(coverageNotices(ctxOf(rows), { from: "2026-11-01", to: "2026-11-30" })).toEqual([]);
  });

  it("cuts a running period at today and tells all three in order", () => {
    const rows = [row("2026-10-02", -5000), bill("2026-10-05", 60)];
    const n = coverageNotices(ctxOf(rows, foreign({ day: "2026-10-07", currency: "USD", amountMinor: -100 })), { from: "2026-01-01", to: "2026-12-31" });
    expect(n.map((x) => x.kind)).toEqual(["cards", "currency", "history"]);
    expect(n[2]!.text).toContain("1.1.–1.10.2026");
  });

  it("adds rows of mixed scale exactly and counts only the asked accounts", () => {
    const rows = [row("2026-10-02", -5000)];
    const mixed: ForeignDay[] = [
      { accountId: "chk", count: 2, newestDay: "2026-10-03", rows: [
        { day: "2026-10-02", currency: "USD", amountMinor: -100, scale: 2 },
        { day: "2026-10-03", currency: "USD", amountMinor: -2, scale: 0 },
      ] },
      { accountId: "other", count: 1, newestDay: "2026-10-03", rows: [{ day: "2026-10-03", currency: "USD", amountMinor: -500, scale: 2 }] },
    ];
    const whole = { from: "2026-10-01", to: "2026-10-31" };
    const all = coverageNotices(ctxOf(rows, mixed), whole).find((x) => x.kind === "currency")!;
    expect(all.currencies).toEqual([{ currency: "USD", count: 3, totalMinor: -800, scale: 2, outMinor: -800, inMinor: 0 }]);
    const mine = coverageNotices(ctxOf(rows, mixed), whole, [], new Set(["chk"])).find((x) => x.kind === "currency")!;
    expect(mine.currencies).toEqual([{ currency: "USD", count: 2, totalMinor: -300, scale: 2, outMinor: -300, inMinor: 0 }]);
  });

  it("keeps money out and in apart, so a refund does not cancel a purchase", () => {
    const f = foreign({ day: "2026-03-10", currency: "USD", amountMinor: -10000 }, { day: "2026-03-12", currency: "USD", amountMinor: 10000 });
    const n = coverageNotices(ctxOf([row("2026-02-03", -5000)], f), whole);
    expect(n[0]!.text).toContain("2 riviä, −100,00 ja +100,00 USD");
  });
});
