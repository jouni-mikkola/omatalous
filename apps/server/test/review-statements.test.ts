/**
 * The header asks for the number of open questions on every page, and the count is the length of the queue, so the
 * queue is worked out for each page. These tests pin two things: the count is the queue's length in each state of a
 * household, and a warm request reads the database a bounded number of times (the queue reads the view and the
 * member's inputs once, not once for each of its sources). Made-up names and sums; the test clock is 9.10.2026.
 */
import { notLoanMark, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { reviewCount, reviewQueue } from "../src/services/review.ts";
import { setupApp, statementsOf } from "./helpers.ts";

const raw = (bookingDate: string, euros: number, counterparty: string, description: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description, reference: null, mcc: null,
});
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `2026-${String(m).padStart(2, "0")}`);
/** A lender's 250 €, a streaming service's 12,99 €, a shop nothing knows and a salary, every month. */
const ROWS = MONTHS.flatMap((m) => [
  raw(`${m}-05`, -250, "ESIMERKKIRAHOITUS OY", "LAINAN LYHENNYS"),
  raw(`${m}-08`, -12.99, "MAX", "KORTTIOSTO"),
  raw(`${m}-20`, -84.5, "KUMMAKAUPPA XYZ", "KORTTIOSTO"),
  raw(`${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA"),
]);

async function household() {
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
  await ingestTransactions(repo, "chk", ROWS, "csv");
  await reprocess(repo, t.s.settings);
  // a second member with an account of their own, so the queue reads the household's members too
  const maija = await t.member("maija", "Maija");
  const maijaRepo = t.s.finance(maija.id);
  await maijaRepo.upsertAccount({ id: "maija-chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Maijan tili", iban: null, currency: "EUR", type: "checking" });
  await ingestTransactions(maijaRepo, "maija-chk", MONTHS.map((m) => raw(`${m}-12`, -30, "TOINEN KAUPPA XYZ", "KORTTIOSTO")), "csv");
  await reprocess(maijaRepo, t.s.settings);
  return { ...t, maijaId: maija.id };
}

/**
 * The most statements a warm request may make for this household. The queue made 172 before it read the view once and
 * makes 40 now; the room above that is for a source that reads one more thing, not for one that reads the view again.
 */
const MOST = { count: 48, queue: 48 };

describe("the review count and the queue read once", () => {
  it("the count is the length of the queue in every state, and the queue is the same on a second read", async () => {
    const t = await household();
    const items = async (id: string) => (await reviewQueue(t.s, id)).items;
    const first = await items(t.adminId);
    expect(first.map((i) => i.kind)).toContain("loan");
    expect((await reviewCount(t.s, t.adminId)).count).toBe(first.length);
    expect(await items(t.adminId)).toEqual(first);

    // an answer takes its item away, and the count follows
    const loan = first.find((i) => i.kind === "loan") as { id: string; key: string };
    expect((await t.admin.call("PUT", "/api/marks", notLoanMark({ key: loan.key }))).status).toBe(200);
    const answered = await items(t.adminId);
    expect(answered.map((i) => i.id)).not.toContain(loan.id);
    expect((await reviewCount(t.s, t.adminId)).count).toBe(answered.length);

    // a new payee is asked about
    const repo = t.s.finance(t.adminId);
    await ingestTransactions(repo, "chk", [raw("2026-10-08", -61.2, "TOINEN KAUPPA XYZ", "KORTTIOSTO")], "csv");
    await reprocess(repo, t.s.settings);
    const grown = await items(t.adminId);
    expect(grown.map((i) => i.id)).toContain("payee_out:Toinen Kauppa Xyz");
    expect(answered.map((i) => i.id)).not.toContain("payee_out:Toinen Kauppa Xyz");
    expect((await reviewCount(t.s, t.adminId)).count).toBe(grown.length);

    // the other member is asked about their own rows only, and the count says the same
    const maija = await items(t.maijaId);
    expect((await reviewCount(t.s, t.maijaId)).count).toBe(maija.length);
    expect(maija.map((i) => i.id)).not.toContain(loan.id);
  });

  it("a warm count and a warm queue read the database a bounded number of times", async () => {
    const t = await household();
    // the first request builds the context; the next ones read what a request reads
    await reviewQueue(t.s, t.adminId);
    const queue = await statementsOf(t.db, () => reviewQueue(t.s, t.adminId));
    const count = await statementsOf(t.db, () => reviewCount(t.s, t.adminId));
    expect.soft(count, "statements of a warm count").toBeLessThanOrEqual(MOST.count);
    expect.soft(queue, "statements of a warm queue").toBeLessThanOrEqual(MOST.queue);
  });
});
