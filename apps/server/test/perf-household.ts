/**
 * A household of a stated size for the performance budgets (perf-reprocess.test.ts, perf-front.test.ts): two members,
 * six accounts (one of them joint, linked by both), five years of rows (about 12 000 counting the joint account's two
 * copies), rules, marks, answers, a split, loans and expected bills. Made-up names and sums only, and the same
 * household every time: a seeded generator, no clock and no Math.random.
 */
import { expect } from "vitest";
import type { RawTransaction } from "@banking/core";
import { ingestTransactions } from "../src/services/ingest.ts";
import { sayAnswer } from "../src/services/money-trace.ts";
import { KEY, link, people, type World } from "./trace-world.ts";

export const SIZE = { members: 2, accounts: 6, years: 5 } as const;
const OUTSIDE_IBAN = "FI7000000000000007";
const OUTSIDE = "ESIMERKKI VUOKRALAINEN";

/** mulberry32: a small seeded generator. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHOPS = ["S-MARKET ESIMERKKI", "K-MARKET ESIMERKKI", "LIDL ESIMERKKI", "ESIMERKKI APTEEKKI", "ESIMERKKI KAHVILA", "ESIMERKKI PIZZA", "ESIMERKKI KIRJAKAUPPA", "ESIMERKKI RAUTAKAUPPA", "ESIMERKKI TAKSI", "ESIMERKKI KAMPAAMO", "ESIMERKKI ELOKUVAT", "ESIMERKKI KUKKA", "ESIMERKKI OPTIKKO", "ESIMERKKI LEMMIKKI", "ESIMERKKI URHEILU", "ESIMERKKI PARTURI", "ESIMERKKI NETTIKAUPPA", "ESIMERKKI LIPPU", "ESIMERKKI PESULA", "ESIMERKKI ASEMA"];
for (let i = 1; i <= 40; i++) SHOPS.push(`ESIMERKKI KAUPPA ${i}`);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Row = { date: string; cents: number; who: string; iban?: string; note?: string };
type Income = { who: string; iban?: string; cents: number } | null;

/** `n` rows spread over the years before `end`: the shops, and each month a salary, a bill and a subscription. */
function spending(rand: () => number, end: number, years: number, n: number, income: Income): Row[] {
  const start = end - years * 365 * DAY;
  const rows: Row[] = [];
  for (let m = 0; m < years * 12; m++) {
    const first = start + m * 30.4 * DAY;
    if (income) rows.push({ date: iso(first + 2 * DAY), cents: income.cents, who: income.who, iban: income.iban });
    rows.push({ date: iso(first + 5 * DAY), cents: -(4000 + (m % 7) * 150), who: "ESIMERKKI SAHKO OY", note: `LASKU ${m}` });
    rows.push({ date: iso(first + 9 * DAY), cents: -1299, who: "ESIMERKKI STREAM" });
  }
  while (rows.length < n) {
    const shop = SHOPS[Math.floor(rand() * SHOPS.length)]!;
    rows.push({ date: iso(start + Math.floor(rand() * years * 365) * DAY), cents: -Math.round(200 + rand() * rand() * 14000), who: shop, note: `OSTO ${rows.length}` });
  }
  return rows;
}

const toRaw = (r: Row, id: string, n: number): RawTransaction => ({
  externalId: `${id}-${n}`, bookingDate: r.date, valueDate: null, amountCents: r.cents, currency: "EUR", status: "booked",
  counterparty: r.who, counterpartyIban: r.iban ?? null, description: r.note ?? null, reference: null, mcc: null,
});

export interface PerfHousehold extends World {
  /** Rows stored, the joint account's copies counted each. */
  rows: number;
  /** Milliseconds the build took, by step. */
  built: Record<string, number>;
}

export async function perfHousehold(seed = 20_260_101): Promise<PerfHousehold> {
  const built: Record<string, number> = {};
  let t = performance.now();
  const lap = (name: string) => {
    const n = performance.now();
    built[name] = Math.round(n - t);
    t = n;
  };
  const clock = { at: new Date("2026-10-09T10:00:00Z") };
  const w = await people(clock);
  const rand = seeded(seed);
  const end = clock.at.getTime();
  await link(w, w.aino, "aino-save", "MEIKALAINEN AINO", "FI8000000000000008", "idn-aino-save", "savings");
  await link(w, w.aino, "aino-card", "MEIKALAINEN AINO", "FI9000000000000009", "idn-aino-card", "credit_card");
  await link(w, w.ville, "ville-save", "LAHTINEN VILLE", "FI1100000000000011", "idn-ville-save", "savings");
  for (const [owner, id] of [[w.aino, "pool-a"], [w.ville, "pool-b"]] as const) await link(w, owner, id, "MEIKALAINEN AINO, LAHTINEN VILLE", "FI3000000000000003", KEY);
  lap("accounts");

  // the two own accounts carry the most rows; the joint account has the same rows in both copies
  const plan: [owner: string, id: string, rows: Row[]][] = [
    [w.aino, "aino-own", spending(rand, end, SIZE.years, 3400, { who: "ESIMERKKI OY", cents: 310_000 })],
    [w.ville, "ville-own", spending(rand, end, SIZE.years, 3000, { who: "ESIMERKKI TYONANTAJA OY", cents: 280_000 })],
    [w.aino, "aino-card", spending(rand, end, SIZE.years, 900, null)],
    [w.aino, "aino-save", spending(rand, end, SIZE.years, 120, { who: "MEIKALAINEN AINO", iban: "FI1000000000000001", cents: 20_000 })],
    [w.ville, "ville-save", spending(rand, end, SIZE.years, 120, { who: "LAHTINEN VILLE", iban: "FI2000000000000002", cents: 15_000 })],
  ];
  const pool = spending(rand, end, SIZE.years, 1900, null);
  for (let m = 0; m < SIZE.years * 12; m++) {
    const date = iso(end - (SIZE.years * 365 - m * 30.4 - 1) * DAY);
    pool.push({ date, cents: 90_000, who: "MEIKALAINEN AINO", iban: "FI1000000000000001" }, { date, cents: 60_000, who: "LAHTINEN VILLE", iban: "FI2000000000000002" }, { date, cents: 45_000, who: OUTSIDE, iban: OUTSIDE_IBAN });
  }
  plan.push([w.aino, "pool-a", pool], [w.ville, "pool-b", pool]);
  let rows = 0;
  for (const [owner, id, list] of plan) {
    await ingestTransactions(w.s.finance(owner), id, list.map((r, i) => toRaw(r, id, i)), "enablebanking");
    rows += list.length;
    // the joint account's trace needs the balance the bank tells: what the rows add up to
    if (id.startsWith("pool")) await w.db.run("UPDATE accounts SET balance_cents = ? WHERE id = ?", [list.reduce((n, r) => n + r.cents, 0), id]);
  }
  lap("rows");

  // rules, marks, a loan and expected bills for each member, written to the repo: a rule through the route would
  // categorise the whole history again each time
  for (const owner of [w.aino, w.ville]) {
    const repo = w.s.finance(owner);
    for (let i = 0; i < 25; i++) await repo.addRule({ field: "merchant_exact", pattern: `ESIMERKKI KAUPPA ${i + 1}`, category: i % 2 ? "groceries" : "shopping", priority: 10 });
    for (let i = 0; i < 5; i++) await repo.addRule({ field: "description", pattern: `OSTO ${i + 1}0`, category: "shopping", priority: 10 });
    for (let i = 0; i < 20; i++) await repo.setMark(`question:payee:ESIMERKKI KAUPPA ${30 + i}`, "dismissed", "2026-10-01");
    await repo.addLoan({ id: `loan-${owner}`, name: "Asuntolaina", lender: "ESIMERKKI PANKKI", kind: "mortgage", grantedCents: 20_000_000, balanceCents: 15_000_000, balanceDate: "2026-09-30", rateBp: 350, reference: "euribor_12", marginBp: 80, repayment: "annuity", intervalMonths: 1, paymentCents: 82_000, endDate: "2046-09-30", limitCents: null, seriesKey: null }, "2026-10-01T00:00:00Z");
    for (const [name, cadence, cents] of [["Autovakuutus", "yearly", 45_000], ["Kotivakuutus", "semiannual", 12_000], ["Kiinteistovero", "quarterly", 30_000]] as const)
      await repo.addExpectedBill({ id: `bill-${owner}-${name}`, name, amountCents: cents, dueDate: "2026-11-15", cadence, category: null }, "2026-10-01T00:00:00Z");
  }
  lap("rules-marks-loans-bills");

  // the joint account cut by who paid it, the outside payer and the opening answered
  expect(await w.s.household.share(w.aino, "pool-a", w.ville)).toBe(true);
  expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
  // every question the joint account asks gets an answer, so the household has answers to read
  const meta = (await w.as(w.aino).call("GET", "/api/meta")).body;
  const questions: { kind: "in" | "opening"; key: string }[] = meta.accounts.find((a: { id: string }) => a.id === "pool-a")?.questions ?? [];
  expect(questions.length).toBeGreaterThan(0);
  for (const q of questions) await sayAnswer(w.s, KEY, { kind: q.kind, key: q.key, owner: q.kind === "opening" ? "none" : `u:${w.aino}` }, w.aino);
  lap("split-answers");
  return Object.assign(w, { rows, built });
}
