/**
 * A regular payer's only payment in a pay period, and a change of payer found against the chosen window. Made-up
 * payers ESIMERKKI OY and TOINEN ESIMERKKI OY, 3 000 € a month.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { payDate } from "../src/analysis/income.ts";
import { incomeInsights } from "../src/analysis/income-changes.ts";
import { addMonths } from "../src/dates.ts";
import { incomeReport } from "../src/reports/income.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const ACCOUNTS: Account[] = [{ id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" }];
const LEVEL = 300_000;

/** `n` pay days from the month `first`, on `day` or the banking day before it; `amount` per index. */
function pay(payer: string, first: string, n: number, amount: number | ((i: number) => number), day = 15): Transaction[] {
  return Array.from({ length: n }, (_, i) =>
    tx({
      bookingDate: payDate(addMonths(first, i), { day, rule: "prev" }),
      amountCents: typeof amount === "function" ? amount(i) : amount,
      merchant: payer,
      counterparty: payer,
      description: "PALKKA",
      category: "salary",
      categorySource: "rule",
    }),
  );
}

/** Card purchases every other day up to `to`, so the sync covers every date the tests look at. */
const spend = (from: string, to: string) => series(from, 2, Math.floor((Date.parse(to) - Date.parse(from)) / 864e5 / 2) + 1, -2500, { merchant: "K-Market", category: "groceries", categorySource: "rule" });

const read = (rows: Transaction[], today: string, to: string, accounts: Account[] = ACCOUNTS) => {
  const ctx = createContext(rows, accounts, today);
  const range = { from: `${addMonths(to.slice(0, 7), -11)}-01`, to };
  return { ctx, range, report: incomeReport(ctx, range) };
};
const monthOf = (r: ReturnType<typeof incomeReport>, month: string) => r.months.find((m) => m.month === month)!;
const payerKinds = ["payer_changed", "stopped", "new_source"];
const told = (r: ReturnType<typeof incomeReport>) => r.changes.filter((c) => payerKinds.includes(c.kind));

describe("a regular payer's only payment of a pay period", () => {
  const TODAY = "2026-10-20";
  const steady = () => [...pay("ESIMERKKI OY", "2025-09", 14, LEVEL), ...spend("2025-09-01", TODAY)];
  const changed = (index: number, patch: Partial<Transaction>) => pay("ESIMERKKI OY", "2025-09", 14, LEVEL).map((t, i) => (i === index ? { ...t, ...patch } : t));

  it("has no extra income in a month paid at the usual level, also with a holiday word in the text", () => {
    const rows = [...changed(9, { description: "PALKKA JA LOMARAHA" }), ...spend("2025-09-01", TODAY)];
    const { report } = read(rows, TODAY, TODAY);
    for (const m of report.months) expect(m.byGroup.extra_pay, m.month).toBe(0);
    expect(monthOf(report, "2026-06").byGroup.salary).toBe(LEVEL);
  });

  it("counts a lower sum with a holiday word as regular pay, not as extra", () => {
    const rows = [...changed(9, { description: "PALKKA JA LOMARAHA", amountCents: 240_000 }), ...spend("2025-09-01", TODAY)];
    const june = monthOf(read(rows, TODAY, TODAY).report, "2026-06");
    expect(june.byGroup.salary).toBe(240_000);
    expect(june.byGroup.extra_pay).toBe(0);
  });

  it("splits a payment of one and a half times the level: the level is regular pay, the half is extra", () => {
    const rows = [...changed(6, { amountCents: 450_000 }), ...spend("2025-09-01", TODAY)];
    const march = monthOf(read(rows, TODAY, TODAY).report, "2026-03");
    expect(march.byGroup.salary).toBe(LEVEL);
    expect(march.byGroup.extra_pay).toBe(150_000);
    expect(march.totalCents).toBe(450_000);
  });

  it("keeps a holiday bonus as a second payment of the month extra", () => {
    const bonus = tx({ bookingDate: "2026-06-24", amountCents: 180_000, merchant: "ESIMERKKI OY", counterparty: "ESIMERKKI OY", description: "LOMARAHA", category: "salary", categorySource: "rule" });
    const june = monthOf(read([...steady(), bonus], TODAY, TODAY).report, "2026-06");
    expect(june.byGroup.salary).toBe(LEVEL);
    expect(june.byGroup.extra_pay).toBe(180_000);
  });

  it("leaves a household with one steady payer as it was", () => {
    const { report } = read(steady(), TODAY, TODAY);
    expect(report.earnedCents).toBe(12 * LEVEL);
    expect(report.changes).toEqual([]);
    for (const m of report.months) expect(m.byGroup, m.month).toMatchObject({ salary: LEVEL, extra_pay: 0 });
  });
});

describe("a change of payer against the chosen window", () => {
  const TODAY = "2027-03-10";
  const rows = [...pay("ESIMERKKI OY", "2025-04", 12, LEVEL), ...pay("TOINEN ESIMERKKI OY", "2026-04", 9, 310_000, 25), ...spend("2025-04-01", TODAY)];

  it("tells the change once, with both payers, when the window ends in December", () => {
    const { report } = read(rows, TODAY, "2026-12-31");
    expect(told(report)).toHaveLength(1);
    expect(told(report)[0]).toMatchObject({ kind: "payer_changed", payer: "TOINEN ESIMERKKI OY", monthlyCents: 10_000 });
    expect(told(report)[0]!.detail).toContain("ESIMERKKI OY, sitten TOINEN ESIMERKKI OY");
  });

  it("tells nothing when the window ends before the old payer stopped", () => {
    expect(told(read(rows, TODAY, "2026-02-28").report)).toEqual([]);
  });

  it("gives the first page the same change as the report", () => {
    const { ctx, range, report } = read(rows, TODAY, "2026-06-30");
    const alert = incomeInsights(ctx, range, NO_INPUTS).map((i) => i.id);
    expect(alert).toHaveLength(1);
    expect(alert).toEqual(report.changes.filter((c) => c.kind === "payer_changed").map((c) => c.id));
  });

  it("keeps the change on the first page for 120 days after the old payer's last payment, and in the report for the year", () => {
    // ESIMERKKI OY was last paid on 13.3.2026
    const onPage = (to: string) => {
      const { ctx, range } = read(rows, TODAY, to);
      return incomeInsights(ctx, range, NO_INPUTS).map((i) => i.id);
    };
    expect(onPage("2026-07-11")).toHaveLength(1);
    expect(onPage("2026-07-12")).toEqual([]);
    expect(onPage("2026-12-31")).toEqual([]);
    expect(onPage(TODAY)).toEqual([]);
    expect(told(read(rows, TODAY, "2026-12-31").report)).toHaveLength(1);
  });

  it("tells a payer that has been silent for 130 days inside a window that ended a year ago", () => {
    const stopped = [...pay("ESIMERKKI OY", "2025-10", 9, LEVEL), ...spend("2025-10-01", "2027-10-25")];
    const { report } = read(stopped, "2027-10-25", "2026-10-23");
    expect(told(report)).toHaveLength(1);
    expect(told(report)[0]).toMatchObject({ kind: "stopped", payer: "ESIMERKKI OY", title: "Palkkaa ei ole tullut 15.6. jälkeen" });
  });

  it("does not tell a payer that stopped before the window", () => {
    const old = [...pay("ESIMERKKI OY", "2024-01", 9, LEVEL), ...pay("TOINEN ESIMERKKI OY", "2025-01", 6, LEVEL), ...spend("2024-01-01", TODAY)];
    expect(told(read(old, TODAY, "2026-12-31").report)).toEqual([]);
  });
});

describe("a change of payer in a household with two earners", () => {
  const TODAY = "2026-10-10";
  const TWO: Account[] = [...ACCOUNTS, { id: "acc-2", name: "Toisen tili", iban: null, currency: "EUR", type: "checking" }];
  const onAccount = (accountId: string, list: Transaction[]) => list.map((t) => ({ ...t, accountId }));
  const filler = [...spend("2025-09-01", TODAY), ...onAccount("acc-2", spend("2025-09-01", TODAY))];
  const readTwo = (rows: Transaction[]) => read([...rows, ...filler], TODAY, TODAY, TWO).report;
  // the first earner's payer stops after 6/2026 and the next one begins in 7/2026; the second earner steady on the other account
  const first = [...pay("ESIMERKKI OY", "2025-09", 10, 300_000), ...pay("TOINEN ESIMERKKI OY", "2026-07", 3, 310_000, 25)];

  it("tells each change with its own new payer and its own earlier pay", () => {
    const second = onAccount("acc-2", [...pay("KOLMAS ESIMERKKI OY", "2025-09", 10, 200_000, 10), ...pay("NELJAS ESIMERKKI OY", "2026-07", 3, 250_000, 20)]);
    const changed = readTwo([...first, ...second]).changes.filter((c) => c.kind === "payer_changed");
    expect(Object.fromEntries(changed.map((c) => [c.payer, c.monthlyCents]))).toEqual({ "TOINEN ESIMERKKI OY": 10_000, "NELJAS ESIMERKKI OY": 50_000 });
    expect(changed).toHaveLength(2);
    expect(changed.find((c) => c.payer === "NELJAS ESIMERKKI OY")!.detail).toContain("KOLMAS ESIMERKKI OY, sitten NELJAS ESIMERKKI OY");
  });

  describe("two old payers and two new ones on one account", () => {
    const one = [...ACCOUNTS];
    const readOne = (rows: Transaction[]) => read([...rows, ...spend("2025-08-01", TODAY)], TODAY, TODAY, one).report.changes.filter((c) => c.kind === "payer_changed");
    const byPayer = (changed: ReturnType<typeof readOne>) => Object.fromEntries(changed.map((c) => [c.payer, c.monthlyCents]));
    const old = (second: number) => [...pay("ESIMERKKI OY", "2025-08", 11, 300_000), ...pay("KOLMAS ESIMERKKI OY", "2025-09", 10, second, 10)];

    it("pairs each old payer with the new one whose pay is nearest, not the one paid first", () => {
      const changed = readOne([...old(200_000), ...pay("NELJAS ESIMERKKI OY", "2026-07", 3, 250_000, 3), ...pay("TOINEN ESIMERKKI OY", "2026-07", 3, 310_000, 24)]);
      expect(byPayer(changed)).toEqual({ "TOINEN ESIMERKKI OY": 10_000, "NELJAS ESIMERKKI OY": 50_000 });
      expect(changed.find((c) => c.payer === "TOINEN ESIMERKKI OY")!.detail).toContain("ESIMERKKI OY, sitten TOINEN ESIMERKKI OY");
      expect(changed.find((c) => c.payer === "NELJAS ESIMERKKI OY")!.detail).toContain("KOLMAS ESIMERKKI OY, sitten NELJAS ESIMERKKI OY");
    });

    it("gives a new payer to one old payer only: the next nearest one goes to the other", () => {
      // 2 900 is nearest to both old payers; the first takes it, the other is left with the 2 500
      const changed = readOne([...old(280_000), ...pay("NELJAS ESIMERKKI OY", "2026-07", 3, 290_000, 3), ...pay("TOINEN ESIMERKKI OY", "2026-07", 3, 250_000, 24)]);
      expect(byPayer(changed)).toEqual({ "NELJAS ESIMERKKI OY": -10_000, "TOINEN ESIMERKKI OY": -30_000 });
      expect(changed).toHaveLength(2);
    });
  });

  it("tells pay that stopped, not a change of payer, when the other earner takes a side job of 800 €", () => {
    const second = onAccount("acc-2", [...pay("KOLMAS ESIMERKKI OY", "2025-09", 13, 200_000, 10), ...pay("NELJAS ESIMERKKI OY", "2026-07", 3, 80_000, 20)]);
    const changes = readTwo([...pay("ESIMERKKI OY", "2025-09", 10, 300_000), ...second]).changes;
    expect(changes.filter((c) => c.kind === "payer_changed")).toEqual([]);
    expect(changes.filter((c) => c.kind === "stopped")).toMatchObject([{ payer: "ESIMERKKI OY", title: "Palkkaa ei ole tullut 15.6. jälkeen" }]);
  });

  it("still tells a new payer on the other account when it pays about the old level", () => {
    const moved = onAccount("acc-2", pay("TOINEN ESIMERKKI OY", "2026-07", 3, 310_000, 25));
    const changed = readTwo([...pay("ESIMERKKI OY", "2025-09", 10, 300_000), ...moved]).changes.filter((c) => c.kind === "payer_changed");
    expect(changed).toMatchObject([{ payer: "TOINEN ESIMERKKI OY", monthlyCents: 10_000 }]);
  });
});
