/**
 * Property tests for the money invariants. A seeded generator makes random households (accounts, rows, categories,
 * transfers, refunds) and every run checks the same rules, so a failure names its seed and can be replayed.
 * No library: the generator is 20 lines.
 */
import { describe, expect, it } from "vitest";
import { buildDashboard, buildReports, CATEGORIES, createContext, enrichTransactions, flowsOf, getCategory, totalsOf, addDays, type Account, type Transaction } from "../src/index.ts";

function rng(seed: number) {
  let a = seed | 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
  };
}

const TODAY = "2026-10-09";
const MERCHANTS = ["K-Market", "Spotify", "Neste", "Wolt", "Sato Oyj", "Acme Oy", "Nordnet", "Nordea Rahoitus Suomi Oy", "Virtanen Matti", "Finnair", "HSL", "Apteekki", "Elisa", "If Vahinkovakuutus"];
const ACCOUNT_TYPES: Account["type"][] = ["checking", "savings", "credit_card", "loan", "other"];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** clean: a row goes the way its category says (no refunds, no money back from savings), so no category nets below zero. */
function household(seed: number, rows = 400, spanDays = 900, end = TODAY, clean = false) {
  const r = rng(seed);
  const accounts: Account[] = [{ id: "a0", name: "Käyttö", iban: "FI2112345600000785", currency: "EUR", type: "checking" }];
  for (let i = 1; i < r.int(1, 4); i++) accounts.push({ id: `a${i}`, name: `Tili ${i}`, iban: null, currency: "EUR", type: r.pick(ACCOUNT_TYPES) });
  const txs: Transaction[] = [];
  for (let i = 0; i < rows; i++) {
    const category = r.pick(CATEGORY_IDS);
    const sign = clean ? (getCategory(category).kind === "income" ? 1 : -1) : r.next() < 0.8 ? -1 : 1;
    // a mix of tiny, usual and huge amounts, always whole cents
    const size = r.pick([1, 99, 1250, 4590, 25000, 105000, 300000, 99999999]);
    txs.push({
      id: `t${seed}-${i}`,
      accountId: r.pick(accounts).id,
      bookingDate: addDays(end, -r.int(0, spanDays)),
      amountCents: sign * Math.max(1, r.int(1, size)),
      currency: "EUR",
      status: r.next() < 0.05 ? "pending" : "booked",
      counterparty: r.next() < 0.3 ? r.pick(MERCHANTS) : null,
      counterpartyIban: null,
      description: null,
      mcc: r.next() < 0.3 ? String(r.int(1000, 9999)) : null,
      merchant: r.pick(MERCHANTS),
      category,
      categorySource: r.next() < 0.3 ? "user" : "default",
      isTransfer: r.next() < 0.08,
    });
    if (clean && txs[i]!.categorySource !== "user") txs[i]!.categorySource = "default";
  }
  return { accounts, txs };
}

/** Rows as the server stores them: after the enrichment pipeline has run. */
function enriched(h: { accounts: Account[]; txs: Transaction[] }) {
  const changed = new Map(enrichTransactions(h.txs, h.accounts, []).map((t) => [t.id, t]));
  return h.txs.map((t) => changed.get(t.id) ?? t);
}

function walk(value: unknown, path: string, bad: string[]) {
  if (typeof value === "number" && !Number.isFinite(value)) bad.push(`${path}=${value}`);
  else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, bad));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, bad);
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

describe("every transaction lands in exactly one flow or is a transfer", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const { accounts, txs } = household(seed);
    const rows = enriched({ accounts, txs });
    const savings = new Set(accounts.filter((a) => a.type === "savings").map((a) => a.id));
    const loans = new Set(accounts.filter((a) => a.type === "loan").map((a) => a.id));
    for (const t of rows) {
      const f = flowsOf(t, savings, loans);
      const parts = [f.consumption, f.debt, f.saved, f.income, f.borrowed];
      expect(parts.every(Number.isInteger), `${t.id} integer`).toBe(true);
      const nonZero = parts.filter((p) => p !== 0).length;
      expect(nonZero, `${t.id} ${t.category} in several flows`).toBeLessThanOrEqual(1);
      // signed sum: what came in minus what left, saved counted as leaving
      const signed = f.income + f.borrowed - f.consumption - f.debt - f.saved;
      const kind = getCategory(t.category).kind;
      if (loans.has(t.accountId)) expect(signed, `${t.id} loan account row`).toBe(0);
      else if (t.isTransfer) expect(signed, `${t.id} transfer`).toBe(savings.has(t.accountId) ? -t.amountCents : 0);
      else if (kind === "transfer" && t.category !== "credit_draw") expect(signed, `${t.id} neutral`).toBe(0);
      else expect(signed, `${t.id} ${t.category} flows add up to the amount`).toBe(t.amountCents);
      // a flow is never booked on the wrong side of zero for its kind, except refunds and withdrawals
      if (!t.isTransfer && !loans.has(t.accountId) && kind === "income") expect(f.consumption + f.debt + f.saved).toBe(0);
    }
  });
});

describe("totals", () => {
  it.each(SEEDS)("seed %i: dashboard, cash flow, categories, pivot and summary agree", (seed) => {
    // clean rows, and no re-categorising: a rule may turn an "income" row into spending the other way round
    const { accounts, txs } = household(seed, 400, 900, TODAY, true);
    const ctx = createContext(txs, accounts, TODAY);
    const r = rng(seed * 7);
    for (let k = 0; k < 4; k++) {
      const from = addDays(TODAY, -r.int(0, 600));
      const to = addDays(from, r.int(0, 400));
      if (to > TODAY) continue;
      const range = { from, to };
      const d = buildDashboard(ctx, range);
      const rep = buildReports({ ctx, range, balances: [] });
      const label = `${seed} ${from}..${to}`;
      const sumFlows = totalsOf(ctx.txs.filter((t) => t.bookingDate >= from && t.bookingDate <= to).map((t) => t.flows));
      expect(d.totals, label).toEqual(sumFlows);
      expect(rep.cashflow.totals, `cashflow ${label}`).toEqual(d.totals);
      expect(rep.summary.incomeCents, label).toBe(d.totals.incomeCents);
      expect(rep.summary.spendingCents, label).toBe(d.totals.expenseCents);
      expect(rep.summary.savedCents, label).toBe(d.totals.savedCents);
      expect(rep.summary.netCents, label).toBe(d.totals.netCents);
      expect(rep.categories.totalCents, `categories ${label}`).toBe(d.totals.expenseCents);
      expect(rep.pivot.totalCents, `pivot ${label}`).toBe(d.totals.expenseCents);
      expect(d.categories.reduce((s, c) => s + c.cents, 0), `dashboard categories ${label}`).toBe(d.totals.expenseCents);
      expect(rep.cashflow.rows.reduce((s, x) => s + x.incomeCents, 0), label).toBe(d.totals.incomeCents);
      expect(rep.cashflow.rows.reduce((s, x) => s + x.consumptionCents + x.debtCents, 0), label).toBe(d.totals.expenseCents);
      const fv = rep.fixedVariable.totals;
      expect(fv.fixedCents + fv.habitCents + fv.variableCents + fv.debtCents, `fixed ${label}`).toBe(d.totals.expenseCents);
      expect(d.totals.netCents).toBe(d.totals.incomeCents - d.totals.expenseCents);
      for (const v of Object.values(d.totals)) if (v !== null) expect(Number.isInteger(v) || typeof v === "number", label).toBe(true);
      for (const v of [d.totals.incomeCents, d.totals.consumptionCents, d.totals.debtCents, d.totals.savedCents, d.totals.borrowedCents]) expect(Number.isInteger(v), label).toBe(true);
    }
  });

  it.each(SEEDS)("seed %i: with refunds, a category that nets below zero stays a row with its minus and everything adds up", (seed) => {
    const { accounts, txs } = household(seed);
    const ctx = createContext(enriched({ accounts, txs }), accounts, TODAY);
    const range = { from: addDays(TODAY, -400), to: TODAY };
    const d = buildDashboard(ctx, range);
    const rep = buildReports({ ctx, range, balances: [] });
    const net = new Map<string, number>();
    for (const t of ctx.txs) if (t.bookingDate >= range.from && t.spend) net.set(t.category, (net.get(t.category) ?? 0) + t.spend);
    const positive = [...net.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
    expect(rep.categories.totalCents).toBe(d.totals.expenseCents);
    // the dashboard's own category list holds such a category too, so its rows add up to the spending
    expect(d.categories.reduce((s, c) => s + c.cents, 0)).toBe(d.totals.expenseCents);
    expect(positive).toBeGreaterThanOrEqual(d.totals.expenseCents);
    expect(rep.cashflow.totals).toEqual(d.totals);
    expect(rep.summary.spendingCents).toBe(d.totals.expenseCents);
    expect(rep.pivot.totalCents).toBe(rep.pivot.rows.reduce((s, r) => s + r.totalCents, 0));
    expect(rep.pivot.totalCents).toBe(d.totals.expenseCents);
  });

  // report totals cover the whole range even when the tables show only the last 24 months
  it("a range longer than the 24 shown months still has report totals equal to the dashboard", () => {
    const { accounts, txs } = household(3, 600, 1500, TODAY, true);
    const ctx = createContext(txs, accounts, TODAY);
    const range = { from: addDays(TODAY, -1400), to: TODAY };
    const d = buildDashboard(ctx, range);
    const rep = buildReports({ ctx, range, balances: [] });
    expect(rep.cashflow.totals).toEqual(d.totals);
    expect(rep.categories.totalCents).toBe(d.totals.expenseCents);
    expect(rep.pivot.totalCents).toBe(d.totals.expenseCents);
  });
});

describe("no NaN or Infinity", () => {
  const cases: { name: string; today: string; rows: number; span: number; range: { from: string; to: string } }[] = [
    { name: "empty data", today: TODAY, rows: 0, span: 0, range: { from: "2026-10-01", to: TODAY } },
    { name: "one row", today: TODAY, rows: 1, span: 0, range: { from: "2026-10-01", to: TODAY } },
    { name: "one-day range", today: TODAY, rows: 300, span: 400, range: { from: "2026-09-15", to: "2026-09-15" } },
    { name: "one-day range today", today: TODAY, rows: 300, span: 400, range: { from: TODAY, to: TODAY } },
    { name: "leap day", today: "2028-02-29", rows: 300, span: 500, range: { from: "2028-02-29", to: "2028-02-29" } },
    { name: "leap february", today: "2028-03-05", rows: 300, span: 800, range: { from: "2028-02-01", to: "2028-02-29" } },
    { name: "leap day a year later", today: "2029-03-01", rows: 300, span: 800, range: { from: "2028-02-29", to: "2029-02-28" } },
    { name: "spring DST month", today: "2026-03-31", rows: 300, span: 500, range: { from: "2026-03-01", to: "2026-03-31" } },
    { name: "DST change day", today: "2026-03-29", rows: 300, span: 500, range: { from: "2026-03-29", to: "2026-03-29" } },
    { name: "autumn DST month", today: "2026-10-31", rows: 300, span: 500, range: { from: "2026-10-01", to: "2026-10-31" } },
    { name: "autumn DST change day", today: "2026-10-25", rows: 300, span: 500, range: { from: "2026-10-25", to: "2026-10-25" } },
    { name: "future range", today: TODAY, rows: 200, span: 300, range: { from: "2026-11-01", to: "2026-11-30" } },
    { name: "year boundary", today: "2027-01-01", rows: 300, span: 500, range: { from: "2026-12-31", to: "2027-01-01" } },
  ];
  it.each(cases)("$name", ({ today, rows, span, range }) => {
    for (const seed of [1, 2, 3]) {
      const { accounts, txs } = household(seed, rows, span, today);
      const ctx = createContext(enriched({ accounts, txs }), accounts, today);
      const bad: string[] = [];
      walk(buildDashboard(ctx, range), "dashboard", bad);
      walk(buildReports({ ctx, range, balances: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balanceCents: rows ? 12345 : null, ownerName: null, balanceAt: null })) }), "reports", bad);
      expect(bad, `seed ${seed}`).toEqual([]);
    }
  });

  it("a household with only income, only refunds or only transfers", () => {
    const base = household(1, 0).accounts;
    for (const [category, amount] of [["salary", 300000], ["groceries", 2500], ["transfer", -1000]] as const) {
      const txs: Transaction[] = Array.from({ length: 30 }, (_, i) => ({
        id: `x${i}`, accountId: "a0", bookingDate: addDays(TODAY, -i * 10), amountCents: amount, currency: "EUR", status: "booked", counterparty: null, counterpartyIban: null,
        description: null, mcc: null, merchant: "X", category, categorySource: "user", isTransfer: category === "transfer",
      }));
      const ctx = createContext(txs, base, TODAY);
      const range = { from: "2026-01-01", to: TODAY };
      const bad: string[] = [];
      walk(buildDashboard(ctx, range), "dashboard", bad);
      walk(buildReports({ ctx, range, balances: [] }), "reports", bad);
      expect(bad, category).toEqual([]);
    }
  });
});

describe("enrichment", () => {
  it.each(SEEDS.slice(0, 15))("seed %i: a category set by the user is never changed, and a second run changes nothing", (seed) => {
    const { accounts, txs } = household(seed);
    const once = enriched({ accounts, txs });
    for (const t of once) {
      const before = txs.find((x) => x.id === t.id)!;
      if (before.categorySource === "user") expect(t.category).toBe(before.category);
      expect(Number.isInteger(t.amountCents)).toBe(true);
    }
    expect(enrichTransactions(once, accounts, [])).toEqual([]);
  });
});
