/**
 * The range of the longer forecast holds in a backtest (docs/ROADMAP.md, Longer forecasts): in the demo household and in
 * the households of the fake bank, the real net saving of a month lies inside the range in at least 80 % of the months.
 * Each month is forecast from the rows booked before it only. When the share falls short, the model is wrong: never this test.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type AnalysisContext, createContext, earnedIncome, FORECAST_SEED, enrichTransactions, isCompleteMonth, MIN_COMPARE_MONTHS, monthOf, netSamples, simulateNet, spendingThrough, type Account, type Transaction } from "@banking/core";
// @ts-expect-error TS7016
import { household } from "../../../e2e/fake-bank/household.mjs";
import { demoHousehold } from "../../../tools/findings/households.ts";
import { NOW, setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const TODAY = NOW.toISOString().slice(0, 10);
const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const MIN_HIT = 0.8;
/** The report's seed and others: the share must not hang on one lucky draw. */
const SEEDS = [FORECAST_SEED, 1, 2, 3, 4, 5];

interface BacktestMonth {
  month: string;
  actualCents: number;
  lowCents: number;
  highCents: number;
  inside: boolean;
}

/**
 * Forecasts each month of `months` from the rows before it only and sets the range against what the month really
 * netted. `at(day)` gives the context of the rows booked before `day` with `day` as its today. A month `whole` does
 * not count as complete, or with too few complete months before it, is left out.
 */
function backtestRange(at: (day: string) => AnalysisContext, whole: AnalysisContext, months: readonly string[], seed: number = FORECAST_SEED, horizon = 1): BacktestMonth[] {
  const out: BacktestMonth[] = [];
  for (const month of months) {
    const samples = netSamples(at(`${month}-01`), month);
    // the sum of `horizon` months from `month` on: all of them complete
    const span = Array.from({ length: horizon }, (_, i) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + i, 1)).toISOString().slice(0, 7));
    if (!samples || samples.length < MIN_COMPARE_MONTHS || !span.every((m) => isCompleteMonth(whole, m))) continue;
    const { lowCents, highCents } = simulateNet(samples, horizon, seed).total[horizon - 1]!;
    const actualCents = span.reduce((sum, m) => sum + earnedIncome(whole, m) - spendingThrough(whole, m), 0);
    out.push({ month, actualCents, lowCents, highCents, inside: actualCents >= lowCents && actualCents <= highCents });
  }
  return out;
}

const hitShare = (rows: readonly BacktestMonth[]): number | null => (rows.length ? rows.filter((r) => r.inside).length / rows.length : null);

/** The months before the running one that have rows, oldest first. */
function monthsOf(txs: readonly Transaction[]): string[] {
  const first = txs.reduce((d, t) => (t.bookingDate < d ? t.bookingDate : d), TODAY).slice(0, 7);
  const out: string[] = [];
  for (let m = first; m < monthOf(TODAY); m = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)).toISOString().slice(0, 7)) out.push(m);
  return out;
}

/**
 * `txs` are the raw rows. The context of a day is made from the rows before it enriched again, so nothing the later
 * rows teach (a steady payer, a returned purchase, a transfer pair) reaches the past; it is made once for each day.
 */
/** The rows enriched again: `enrichTransactions` returns the rows it changed, which replace their old selves. */
function enriched(rows: readonly Transaction[], accounts: readonly Account[], rules: Parameters<typeof enrichTransactions>[2], day: string): Transaction[] {
  const changed = new Map(enrichTransactions(rows, accounts, rules, new Map(), undefined, undefined, day).map((t) => [t.id, t]));
  return rows.map((t) => changed.get(t.id) ?? t);
}

function backtester(txs: readonly Transaction[], accounts: readonly Account[], rules: Parameters<typeof enrichTransactions>[2]) {
  const cuts = new Map<string, AnalysisContext>();
  const at = (day: string): AnalysisContext => {
    if (!cuts.has(day)) {
      const before = txs.filter((t) => t.bookingDate < day);
      cuts.set(day, createContext(enriched(before, accounts, rules, day), accounts, day));
    }
    return cuts.get(day)!;
  };
  const whole = createContext(enriched(txs, accounts, rules, TODAY), accounts, TODAY);
  return (seed?: number, horizon = 1) => backtestRange(at, whole, monthsOf(txs), seed, horizon);
}

describe("the range of the longer forecast", () => {
  it("holds in at least 80 % of the months of the demo household, whatever the seed", () => {
    const h = demoHousehold(TODAY);
    const hits = backtester(h.txs, h.accounts, h.rules);
    for (const seed of SEEDS) expect(hitShare(hits(seed))!, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_HIT);
    for (const seed of SEEDS) expect(hitShare(hits(seed, 3))!, `three months, seed ${seed}`).toBeGreaterThanOrEqual(MIN_HIT);
    const rows = hits();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(hitShare(rows)!).toBeGreaterThanOrEqual(MIN_HIT);
  });

  it("holds in at least 80 % of the months of the fake bank's household", async () => {
    const bank = household(TODAY);
    const mock = mockBank();
    const { admin, s, adminId } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, mock.fetchMock);
    await admin.call("POST", "/api/connections/start", {});
    mock.answers["POST /sessions"] = { status: 200, body: { session_id: "sess-1", aspsp: { name: "Nordea", country: "FI" }, access: { valid_until: "2027-04-06T00:00:00Z" }, accounts: bank.accounts } };
    for (const a of bank.accounts as { uid: string }[]) {
      mock.answers[`GET /accounts/${a.uid}/details`] = { status: 200, body: a };
      mock.answers[`GET /accounts/${a.uid}/transactions`] = { status: 200, body: { transactions: bank.transactions[a.uid] ?? [] } };
      const amount = { currency: "EUR", amount: ((bank.balances[a.uid] ?? 0) / 100).toFixed(2) };
      mock.answers[`GET /accounts/${a.uid}/balances`] = { status: 200, body: { balances: [{ name: "Kirjattu saldo", balance_amount: amount, balance_type: "CLBD", reference_date: TODAY }] } };
    }
    expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${mock.state}` })).status).toBe(200);
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    const repo = s.finance(adminId);
    const txs = await repo.allTransactions();
    const accounts = await repo.listAccounts();
    const hits = backtester(txs, accounts, []);
    for (const seed of SEEDS) expect(hitShare(hits(seed))!, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_HIT);
    // the fake bank's lease refund month (+2 562 €) sits in three of the seven three-month windows: no share is asked of those
    const rows = hits();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(hitShare(rows)!).toBeGreaterThanOrEqual(MIN_HIT);
  });
});
