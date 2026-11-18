/**
 * What the CSV exports total is what the pages show. The rows file is set against the transaction list, the cash flow
 * file and the month table and category file against the dashboard's totals and the reports of Raportit, each in the own
 * view and the household view, on a household with a refund, a card statement, a loan account, money moved to savings
 * and a joint account that is cut into parts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { AUGUST, BOTH_MONTHS, loadSumsHousehold, SEPTEMBER, type SumsHousehold } from "./sums-household.ts";

type Scope = "own" | "household";
type Range = { from: string; to: string };
const SCOPES: readonly Scope[] = ["own", "household"];
const RANGES: readonly Range[] = [BOTH_MONTHS, AUGUST, SEPTEMBER];

let home: SumsHousehold;
beforeAll(async () => {
  home = await loadSumsHousehold();
}, 30_000);

/** A file's rows and cells: the BOM off, a quoted cell read whole, no heading kept apart. */
function cells(file: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = file.charCodeAt(0) === 0xfeff ? file.slice(1) : file;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ";") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}
/** A cell of euros with a decimal comma, in cents; an empty cell is null. */
const centsOf = (cell: string | undefined): number | null => (cell === undefined || cell === "" ? null : Math.round(Number(cell.replace(",", ".")) * 100));
const cents = (cell: string | undefined): number => centsOf(cell) ?? 0;
const sum = (values: readonly number[]) => values.reduce((n, v) => n + v, 0);

const query = (range: Range, scope: Scope) => `from=${range.from}&to=${range.to}&scope=${scope}`;
const csvOf = async (path: string) => {
  const res = await home.aino.call("GET", path);
  expect(res.status, path).toBe(200);
  return cells(res.body as string);
};
const dashboard = async (range: Range, scope: Scope) => (await home.aino.call("GET", `/api/dashboard?${query(range, scope)}`)).body.totals as {
  incomeCents: number; consumptionCents: number; debtCents: number; expenseCents: number; savedCents: number; borrowedCents: number; leftCents: number;
};

describe("the rows file adds up to the transaction list", () => {
  it.each(SCOPES)("has the rows of the list, their amounts and their transfer marks (%s view)", async (scope) => {
    const [, ...rows] = await csvOf(`/api/export/transactions.csv?${query(BOTH_MONTHS, scope)}`);
    const list = (await home.aino.call("GET", `/api/transactions?${query(BOTH_MONTHS, scope)}&limit=500`)).body;
    expect(list.items.length).toBe(list.total);
    expect(rows.length).toBe(list.total);
    expect(sum(rows.map((r) => cents(r[7])))).toBe(sum(list.items.map((t: { amountCents: number }) => t.amountCents)));
    const marked = (r: { isTransfer: boolean; bookingDate: string; amountCents: number }) => `${r.bookingDate} ${r.amountCents} ${r.isTransfer}`;
    expect(rows.map((r) => `${r[0]} ${cents(r[7])} ${r[10] !== ""}`).sort()).toEqual(list.items.map(marked).sort());
  });

  it("holds the fixture's kinds of row, so each check above can fail", async () => {
    const [, ...rows] = await csvOf(`/api/export/transactions.csv?${query(BOTH_MONTHS, "household")}`);
    const amounts = rows.map((r) => cents(r[7]));
    expect(amounts).toContain(1500);
    expect(amounts).toContain(-4250);
    expect(amounts).toContain(30000);
    expect(amounts).toContain(-10000);
    expect(amounts).toContain(-73333);
    expect(rows.some((r) => r[10] !== "")).toBe(true);
  });
});

describe("the cash flow file adds up to the dashboard", () => {
  it.each(SCOPES)("has each month's money in, spending and saving as the dashboard totals them (%s view)", async (scope) => {
    for (const range of RANGES) {
      const [, ...rows] = await csvOf(`/api/export/report.csv?report=cashflow&${query(range, scope)}`);
      const totals = await dashboard(range, scope);
      expect(rows.length, `${range.from} months`).toBe(range === BOTH_MONTHS ? 2 : 1);
      const column = (i: number) => sum(rows.map((r) => cents(r[i])));
      expect([column(1), column(2), column(3), column(4), column(5), column(8)], `${range.from} ${scope}`).toEqual([
        totals.incomeCents, totals.consumptionCents, totals.debtCents, totals.savedCents, totals.borrowedCents, totals.leftCents,
      ]);
    }
  });

  it.each(SCOPES)("has the months of a range add up to the totals of the range (%s view)", async (scope) => {
    const [, ...months] = await csvOf(`/api/export/report.csv?report=cashflow&${query(BOTH_MONTHS, scope)}`);
    const parts = [await dashboard(AUGUST, scope), await dashboard(SEPTEMBER, scope)];
    const whole = await dashboard(BOTH_MONTHS, scope);
    expect(months.map((r) => cents(r[1]))).toEqual(parts.map((t) => t.incomeCents));
    expect(sum(parts.map((t) => t.expenseCents))).toBe(whole.expenseCents);
    expect(sum(parts.map((t) => t.incomeCents))).toBe(whole.incomeCents);
    expect(sum(parts.map((t) => t.savedCents))).toBe(whole.savedCents);
  });
});

describe("the month table adds up to the dashboard and the category file", () => {
  it.each(SCOPES)("has its sum row at the dashboard's spending of each month and of the range, and its rows at the sum row (%s view)", async (scope) => {
    const [head, ...rows] = await csvOf(`/api/export/report.csv?report=pivot&${query(BOTH_MONTHS, scope)}`);
    const sumRow = rows[rows.length - 1]!;
    const lines = rows.slice(0, -1);
    expect(lines.length).toBeGreaterThan(3);
    // a row is its label and group, a cell for each month, its total and its average; the head of the months says how many
    const months = head!.filter((h) => /^\d{4}-\d{2}$/.test(h));
    expect(months).toEqual(["2026-08", "2026-09"]);
    const cell = (r: string[], i: number) => cents(r[2 + i]);
    const total = (r: string[]) => cents(r[2 + months.length]);
    for (const [i, month] of months.entries()) {
      const range = month === "2026-08" ? AUGUST : SEPTEMBER;
      expect(cell(sumRow, i), `${month} ${scope} sum row`).toBe((await dashboard(range, scope)).expenseCents);
      expect(sum(lines.map((r) => cell(r, i))), `${month} ${scope} rows`).toBe(cell(sumRow, i));
    }
    expect(total(sumRow)).toBe((await dashboard(BOTH_MONTHS, scope)).expenseCents);
    expect(sum(lines.map(total))).toBe(total(sumRow));
    for (const r of lines) expect(total(r), r[0]).toBe(sum(months.map((_, i) => cell(r, i))));
  });

  it.each(SCOPES)("has the total of the category file at the same figure (%s view)", async (scope) => {
    const [, ...categories] = await csvOf(`/api/export/report.csv?report=categories&${query(BOTH_MONTHS, scope)}`);
    const [, ...pivot] = await csvOf(`/api/export/report.csv?report=pivot&${query(BOTH_MONTHS, scope)}`);
    const pivotTotal = cents(pivot[pivot.length - 1]![4]);
    const api = (await home.aino.call("GET", `/api/reports?reports=categories&${query(BOTH_MONTHS, scope)}`)).body.categories;
    const expense = (await dashboard(BOTH_MONTHS, scope)).expenseCents;
    expect(sum(categories.map((r) => cents(r[2])))).toBe(api.totalCents);
    expect(api.totalCents).toBe(expense);
    expect(pivotTotal).toBe(api.totalCents);
    expect(sum(categories.map((r) => Number(r[4])))).toBe(sum(api.groups.flatMap((g: { categories: { count: number }[] }) => g.categories.map((c) => c.count))));
  });

  it("has each category of the category file at the rows of the rows file in that category (household view)", async () => {
    const [, ...categories] = await csvOf(`/api/export/report.csv?report=categories&${query(BOTH_MONTHS, "household")}`);
    const [, ...rows] = await csvOf(`/api/export/transactions.csv?${query(BOTH_MONTHS, "household")}`);
    const mismatches: string[] = [];
    for (const c of categories) {
      const mine = rows.filter((r) => r[5] === c[1] && r[10] === "");
      const spent = -sum(mine.map((r) => cents(r[7])));
      if (cents(c[2]) !== spent) mismatches.push(`${c[1]}: category file ${cents(c[2])}, rows file ${spent}`);
    }
    expect(categories.length).toBeGreaterThan(3);
    expect(mismatches.length, mismatches.join(" | ")).toBe(0);
  });
});
