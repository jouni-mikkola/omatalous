/**
 * A pool cut by who paid: the past follows whose money it was, and what is ahead follows who paid the recent rows of
 * each series. Made-up names and sums.
 */
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { AINO, fromAino, fromVille, IBAN, link, people, type R, raw, VILLE, type World } from "./trace-world.ts";

const MONTHS = ["03", "04", "05", "06", "07", "08", "09"];
const MORTGAGE = "ESIMERKKI PANKKI ASUNTOLAINA";

/** Aino pays 1 150,00 into the pool each month; the pool pays the mortgage of 1 104,37 and a bill of 45,63. */
async function household(): Promise<World> {
  const w = await people({ at: new Date("2026-10-09T10:00:00Z") });
  const put = async (userId: string, id: string, rows: R[], balance: number) => {
    await w.db.run("UPDATE accounts SET balance_cents = ? WHERE id = ?", [balance, id]);
    await ingestTransactions(w.s.finance(userId), id, rows.map(raw), "enablebanking");
  };
  await link(w, w.aino, "pool-a", `${AINO}, ${VILLE}`, IBAN.pool, "idn-pool");
  await put(w.aino, "pool-a", MONTHS.flatMap((m): R[] => [fromAino(`2026-${m}-01`, 1150), [`2026-${m}-12`, -1104.37, MORTGAGE], [`2026-${m}-14`, -45.63, "SAHKO OY"]]), 0);
  await put(w.aino, "pool-a", [["2026-09-20", 10, "SAHKO OY"]], 0);
  await put(w.aino, "aino-own", MONTHS.flatMap((m): R[] => [[`2026-${m}-25`, 2500, "TYONANTAJA OY"], [`2026-${m}-01`, -1150, "YHTEINEN TILI", IBAN.pool]]), 150000);
  await put(w.ville, "ville-own", MONTHS.map((m): R => [`2026-${m}-25`, 2000, "TOINEN TYONANTAJA OY"]), 230000);
  await w.db.run("UPDATE transactions SET category = 'mortgage', category_source = 'user', reference = 'RF18 5390 0754 7034' WHERE counterparty LIKE '%ASUNTOLAINA%'");
  await reprocess(w.s.finance(w.aino), w.s.settings);
  await reprocess(w.s.finance(w.ville), w.s.settings);
  expect(await w.s.household.share(w.aino, "pool-a", w.ville)).toBe(true);
  await w.as(w.aino).call("PUT", "/api/accounts/pool-a/use", { users: [{ userId: w.aino, weight: 1 }, { userId: w.ville, weight: 1 }] });
  const proposals = (await w.as(w.aino).call("GET", "/api/loans/proposals?scope=own")).body.proposals;
  expect(proposals).toHaveLength(1);
  const loan = { name: "Asuntolaina", lender: "ESIMERKKI PANKKI", kind: "mortgage", balanceCents: 14_999_999, balanceDate: "2026-10-05", rateBp: 325, repayment: "annuity", intervalMonths: 1, paymentCents: 110437, seriesKey: proposals[0].key };
  expect((await w.as(w.aino).call("POST", "/api/loans", loan)).body.error).toBeUndefined();
  return w;
}

/** What one member's own view says is ahead and owed, and what the month before it spent. */
async function look(w: World, userId: string) {
  const c = w.as(userId);
  const now = (await c.call("GET", "/api/dashboard?scope=own")).body;
  const housing = (await c.call("GET", "/api/reports?scope=own&reports=housing")).body.housing;
  const month = (await c.call("GET", "/api/transactions?scope=own&from=2026-09-01&to=2026-09-30&limit=500")).body;
  return {
    fixedMonthlyCents: now.fixedMonthlyCents,
    upcoming: now.ahead.upcoming.map((u: { date: string; name: string; cents: number; source: string }) => `${u.date} ${u.name} ${u.cents} ${u.source}`),
    loans: housing.loans.map((l: { monthlyCents: number; next: { date: string | null } }) => [l.monthlyCents, l.next.date]),
    spending: month.outCents as number,
    income: month.inCents as number,
  };
}

describe("what is ahead on a pool cut by who paid", () => {
  it("follows who paid the recent rows of a series, as the month's spending does", async () => {
    const w = await household();
    const before = { aino: await look(w, w.aino), ville: await look(w, w.ville) };
    // with the weights each member carries half of the mortgage and the bill, in the past and ahead
    // the refund of 10,00 lowers the month's spending, 5,00 of it for each
    expect([before.aino.spending, before.ville.spending]).toEqual([57001, 56999]);
    expect(before.ville.loans[0]![1]).not.toBeNull();
    expect([before.aino.income - 250000, before.ville.income - 200000]).toEqual([0, 0]);
    expect((await w.s.analysis.get(w.s, w.aino, "own")).ctx.standing).toBeUndefined();

    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
    const after = { aino: await look(w, w.aino), ville: await look(w, w.ville) };
    expect((await w.s.analysis.get(w.s, w.aino, "own")).ctx.standing).toBeDefined();
    // ahead: Aino paid all of the mortgage, so it is hers whole, where the weights gave her half
    const mortgage = (rows: string[]) => rows.filter((u) => /asuntolaina/i.test(u));
    expect(mortgage(before.aino.upcoming)).toEqual([expect.stringMatching(/ -5521[89] /)]);
    expect(mortgage(after.aino.upcoming)).toEqual([expect.stringMatching(/ -110437 /)]);
    expect(after.aino.fixedMonthlyCents).toBeGreaterThan(before.aino.fixedMonthlyCents);
    // Ville paid none of it, and none of it is ahead of him
    expect(mortgage(after.ville.upcoming)).toEqual([]);
    // the past: Aino paid all the money into the pool, so the mortgage and the bill were hers. The refund of 10,00 comes
    // back to the same two as the bill was cut to, so 5,00 of it nets out for each, and what Ville bore in the end is nothing
    expect([after.aino.spending, after.ville.spending]).toEqual([114000, 0]);
    expect([after.aino.spending - (after.aino.income - 250000), after.ville.spending - (after.ville.income - 200000)]).toEqual([114000, 0]);
  });

  it("a bill Ville typed for a pool series he paid none of stays on his list once", async () => {
    const w = await household();
    const bill = { name: "Esimerkki Pankki Asuntolaina", amountCents: 110437, dueDate: "2026-10-12", cadence: "once", category: "mortgage" };
    expect((await w.as(w.ville).call("POST", "/api/expected-bills", bill)).body.error).toBeUndefined();
    const before = await look(w, w.ville);
    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
    const after = await look(w, w.ville);
    // the mortgage is on the list once: Ville's own bill, with no series of the pool beside it
    expect(before.upcoming.filter((u: string) => /asuntolaina/i.test(u))).toHaveLength(1);
    expect(after.upcoming.filter((u: string) => /asuntolaina/i.test(u))).toHaveLength(1);
  });
});

/**
 * A joint account whose split nobody said, cut by who paid, with a monthly mortgage payment of 843,64 that the bank
 * takes from it. The members pay the account on the first of the month, each the share `paying` says.
 */
async function mortgagePool(paying: { aino: number; ville: number }): Promise<World> {
  const payment = 843.64;
  const w = await people({ at: new Date("2026-10-09T10:00:00Z") });
  const put = async (userId: string, id: string, rows: R[], balance: number) => {
    await w.db.run("UPDATE accounts SET balance_cents = ? WHERE id = ?", [balance, id]);
    await ingestTransactions(w.s.finance(userId), id, rows.map(raw), "enablebanking");
  };
  await link(w, w.aino, "pool-a", `${AINO}, ${VILLE}`, IBAN.pool, "idn-pool");
  const into = (m: string): R[] => [...(paying.aino ? [fromAino(`2026-${m}-01`, paying.aino)] : []), ...(paying.ville ? [fromVille(`2026-${m}-02`, paying.ville)] : [])];
  await put(w.aino, "pool-a", MONTHS.flatMap((m): R[] => [...into(m), [`2026-${m}-12`, -payment, MORTGAGE]]), 0);
  const toPool = (euros: number, date: string): R[] => (euros ? [[date, -euros, "YHTEINEN TILI", IBAN.pool]] : []);
  await put(w.aino, "aino-own", MONTHS.flatMap((m): R[] => [[`2026-${m}-25`, 2500, "TYONANTAJA OY"], ...toPool(paying.aino, `2026-${m}-01`)]), 150000);
  await put(w.ville, "ville-own", MONTHS.flatMap((m): R[] => [[`2026-${m}-25`, 2000, "TOINEN TYONANTAJA OY"], ...toPool(paying.ville, `2026-${m}-02`)]), 230000);
  await w.db.run("UPDATE transactions SET category = 'mortgage', category_source = 'user', reference = 'RF18 5390 0754 7034' WHERE counterparty LIKE '%ASUNTOLAINA%'");
  await reprocess(w.s.finance(w.aino), w.s.settings);
  await reprocess(w.s.finance(w.ville), w.s.settings);
  expect(await w.s.household.share(w.aino, "pool-a", w.ville)).toBe(true);
  expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
  return w;
}

/** The figures of the forecast in a member's own view: the mortgage row ahead, the fixed costs, the loans no one has saved and the sum left to the payday. */
async function forecast(w: World, userId: string) {
  const { ahead, fixedMonthlyCents, holdings, nyt } = (await w.as(userId).call("GET", "/api/dashboard?scope=own")).body;
  expect(nyt.left.known).toBe(true);
  return {
    ahead: ahead.upcoming.filter((u: { name: string }) => /asuntolaina/i.test(u.name)).map((u: { date: string; cents: number }) => [u.date, u.cents]),
    fixedMonthlyCents: fixedMonthlyCents as number,
    unsaved: holdings.unsavedLoans ? [holdings.unsavedLoans.count, holdings.unsavedLoans.paymentCents] : null,
    billsCents: nyt.left.billsCents as number,
    leftCents: nyt.left.leftCents as number,
    balanceCents: nyt.left.balanceCents as number,
  };
}

describe("the forecast of a pool nobody split, cut by who paid", () => {
  it("the member who paid all of the payment has all of it ahead, as in every month before", async () => {
    const w = await mortgagePool({ aino: 843.64, ville: 0 });
    const month = (await w.as(w.aino).call("GET", "/api/transactions?scope=own&from=2026-09-01&to=2026-09-30&limit=500")).body;
    expect(month.outCents).toBe(84364);
    const f = await forecast(w, w.aino);
    expect(f.ahead).toEqual([["2026-10-12", -84364]]);
    expect(f.fixedMonthlyCents).toBe(84364);
    expect(f.unsaved).toEqual([1, 84364]);
    expect(f.billsCents).toBe(84364);
    expect(f.leftCents).toBe(f.balanceCents - 84364);
    // the other member paid none of it and has none of it ahead
    const v = await forecast(w, w.ville);
    expect([v.ahead, v.unsaved, v.billsCents]).toEqual([[], null, 0]);
  });

  it("two members who paid half each have half ahead", async () => {
    const w = await mortgagePool({ aino: 421.82, ville: 421.82 });
    for (const who of [w.aino, w.ville]) {
      const f = await forecast(w, who);
      expect(f.ahead).toEqual([["2026-10-12", -42182]]);
      expect(f.fixedMonthlyCents).toBe(42182);
      expect(f.unsaved).toEqual([1, 42182]);
      expect(f.billsCents).toBe(42182);
      expect(f.leftCents).toBe(f.balanceCents - 42182);
    }
  });
});
