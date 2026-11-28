import { describe, expect, it } from "vitest";
import type { AheadData, AheadRow } from "../src/analysis/ahead.ts";
import { billsBeforePayday } from "../src/analysis/bills-before-payday.ts";

// Bills before a payday on 10.12., worked by hand: 120 € + 180 € + 420 € + 390 € + 130 € = 1 240 €.
const row = (date: string, name: string, euros: number, source: AheadRow["source"] = "recurring"): AheadRow => ({ date, name, category: null, cents: -euros * 100, source });
const rows: AheadRow[] = [
  row("2026-12-01", "Vakuutus", 120),
  row("2026-12-02", "Vesi", 180),
  row("2026-12-03", "Korttilasku", 420, "card"),
  row("2026-12-04", "Sijoitustili", 50, "transfer"),
  { date: "2026-12-07", name: "Sivutulo", category: null, cents: 90_000, source: "income" },
  row("2026-12-05", "Asuntolaina", 390, "expected"),
  row("2026-12-06", "Sähkö", 130),
];
const payday: AheadData["payday"] = { date: "2026-12-10", name: "Esimerkki Oy", pay: null };
const aheadWith = (startCents: number | null): Pick<AheadData, "reason" | "payday" | "rows" | "balance"> => ({
  reason: "payday",
  payday,
  rows,
  balance: startCents === null ? null : ({ startCents } as AheadData["balance"]),
});

describe("billsBeforePayday", () => {
  it("lays the bills against the money in due order, the bill where it runs out split", () => {
    const answer = billsBeforePayday(aheadWith(54_000));
    expect(answer.payday).toBe("2026-12-10");
    expect(answer.bills.map((b) => [b.name, b.coveredCents, b.state])).toEqual([
      ["Vakuutus", 12_000, "covered"],
      ["Vesi", 18_000, "covered"],
      ["Korttilasku", 24_000, "split"],
      ["Asuntolaina", 0, "short"],
      ["Sähkö", 0, "short"],
    ]);
    // pays and transfers are no bills
    expect(answer.billsCents).toBe(124_000);
    expect(answer.coveredCents).toBe(54_000);
    expect(answer.missingCents).toBe(70_000);
    expect(answer.leftOverCount).toBe(3);
  });

  it("covers every bill when the money is enough", () => {
    const answer = billsBeforePayday(aheadWith(124_000));
    expect(answer.bills.every((b) => b.state === "covered")).toBe(true);
    expect(answer.missingCents).toBe(0);
    expect(answer.leftOverCount).toBe(0);
  });

  it("covers none of them when the accounts are overdrawn, and keeps the balance as it is", () => {
    const answer = billsBeforePayday(aheadWith(-5_000));
    expect(answer.moneyCents).toBe(-5_000);
    expect(answer.coveredCents).toBe(0);
    expect(answer.missingCents).toBe(124_000);
    expect(answer.bills.every((b) => b.state === "short")).toBe(true);
  });

  it("says nothing of covering without a balance", () => {
    const answer = billsBeforePayday(aheadWith(null));
    expect(answer.moneyCents).toBeNull();
    expect(answer.coveredCents).toBeNull();
    expect(answer.missingCents).toBeNull();
    expect(answer.leftOverCount).toBeNull();
    expect(answer.bills.every((b) => b.state === null)).toBe(true);
    expect(answer.billsCents).toBe(124_000);
  });

  it("covers none of them with a balance of exactly 0, and has nothing to cover with no bills", () => {
    const empty = billsBeforePayday(aheadWith(0));
    expect(empty.bills.every((b) => b.state === "short" && b.missingCents === b.cents)).toBe(true);
    expect(empty.coveredCents).toBe(0);
    expect(empty.leftOverCount).toBe(5);
    const none = billsBeforePayday({ ...aheadWith(10_000), rows: [] });
    expect(none).toMatchObject({ bills: [], billsCents: 0, coveredCents: 0, missingCents: 0, leftOverCount: 0 });
  });

  it("counts the pay dated before a bill as money for it, as the first page does", () => {
    const pay = (date: string): AheadRow => ({ date, name: "Palkka", category: null, cents: 100_000, source: "income" });
    const answer = billsBeforePayday({ ...aheadWith(30_000), rows: [row("2026-12-01", "Vesi", 100), pay("2026-12-02"), row("2026-12-03", "Vuokra", 500)] });
    expect(answer.bills.map((b) => [b.name, b.coveredCents, b.state])).toEqual([
      ["Vesi", 10_000, "covered"],
      ["Vuokra", 50_000, "covered"],
    ]);
    // an overdraft is filled by the pay first, as on the first page
    const overdrawn = billsBeforePayday({ ...aheadWith(-50_000), rows: [pay("2026-12-02"), row("2026-12-03", "Vuokra", 800)] });
    expect(overdrawn.bills.map((b) => [b.coveredCents, b.missingCents, b.state])).toEqual([[50_000, 30_000, "split"]]);
    // a bill the money did not cover still leaves the account, so a later pay goes to it first
    const late = billsBeforePayday({ ...aheadWith(0), rows: [row("2026-12-01", "Vesi", 500), pay("2026-12-02"), row("2026-12-03", "Vuokra", 800)] });
    expect(late.bills.map((b) => [b.coveredCents, b.state])).toEqual([[0, "short"], [50_000, "split"]]);
    // a pay dated on the bill's own day is not counted before it
    expect(billsBeforePayday({ ...aheadWith(0), rows: [pay("2026-12-03"), row("2026-12-03", "Vuokra", 500)] }).bills[0]!.state).toBe("short");
  });

  it("has no payday when none is waited for", () => {
    expect(billsBeforePayday({ ...aheadWith(0), reason: "none", payday: null }).payday).toBeNull();
  });
});
