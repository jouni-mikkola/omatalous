/**
 * A pool cut by who paid: the past follows whose money it was, what is ahead keeps the stable cut. Made-up names and sums.
 */
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { AINO, fromAino, IBAN, link, people, type R, raw, VILLE, type World } from "./trace-world.ts";

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
  const month = (await c.call("GET", "/api/transactions?scope=own&from=2026-09-01&to=2026-09-30&limit=500")).body;
  return {
    fixedMonthlyCents: now.fixedMonthlyCents,
    upcoming: now.ahead.upcoming.map((u: { date: string; name: string; cents: number; source: string }) => `${u.date} ${u.name} ${u.cents} ${u.source}`),
    loans: now.housing.loans.map((l: { monthlyCents: number; next: { date: string | null } }) => [l.monthlyCents, l.next.date]),
    spending: month.outCents as number,
    income: month.inCents as number,
  };
}

describe("what is ahead on a pool cut by who paid", () => {
  it("keeps what each member saw with the weights, while the month's spending follows who paid", async () => {
    const w = await household();
    const before = { aino: await look(w, w.aino), ville: await look(w, w.ville) };
    // with the weights each member carries half of the mortgage and the bill, in the past and ahead
    expect([before.aino.spending, before.ville.spending]).toEqual([57501, 57499]);
    expect(before.ville.loans[0]![1]).not.toBeNull();
    expect([before.aino.income - 250000, before.ville.income - 200000]).toEqual([500, 500]);
    expect((await w.s.analysis.get(w.s, w.aino, "own")).ctx.standing).toBeUndefined();

    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
    const after = { aino: await look(w, w.aino), ville: await look(w, w.ville) };
    expect((await w.s.analysis.get(w.s, w.aino, "own")).ctx.standing).toBeDefined();
    for (const who of ["aino", "ville"] as const) {
      expect(after[who].upcoming, who).toEqual(before[who].upcoming);
      expect(after[who].fixedMonthlyCents, who).toBe(before[who].fixedMonthlyCents);
      expect(after[who].loans, who).toEqual(before[who].loans);
    }
    // the past: Aino paid all the money into the pool, so the mortgage and the bill were hers. The refund of 10,00 comes
    // back to the same two as the bill was cut to, so 5,00 of it nets out for Ville, and what he bore in the end is nothing
    expect([after.aino.spending, after.ville.spending]).toEqual([114500, 500]);
    expect([after.aino.spending - (after.aino.income - 250000), after.ville.spending - (after.ville.income - 200000)]).toEqual([114000, 0]);
  });

  it("a bill Ville typed for a pool row he has nothing of still matches its row", async () => {
    const w = await household();
    const bill = { name: "Esimerkki Pankki Asuntolaina", amountCents: 110437, dueDate: "2026-10-12", cadence: "once", category: "mortgage" };
    expect((await w.as(w.ville).call("POST", "/api/expected-bills", bill)).body.error).toBeUndefined();
    const before = await look(w, w.ville);
    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
    const after = await look(w, w.ville);
    // the mortgage is on the list once, as the series, not once more as the typed bill
    expect(after.upcoming).toEqual(before.upcoming);
    expect(after.upcoming.filter((u: string) => /asuntolaina/i.test(u))).toHaveLength(1);
  });
});
