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
import type { User } from "../src/db/rows.ts";
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
  // the queue takes the user of the request, so the tests hand it the same rows the middleware would
  const users: User[] = [(await t.s.users.get(t.adminId))!, (await t.s.users.get(maija.id))!];
  return { ...t, maijaId: maija.id, userOf: (id: string) => users.find((u) => u.id === id)! };
}

/**
 * The most statements a warm request may make for this household. The queue made 172 before it read the view once, 28
 * before it read the accounts and their uses once for the request, and makes 23 now. The viewer comes with the request and
 * the user list is read once for the members and the temporary passwords. A source that reads one more thing raises it by
 * that; a source that reads the view again must not.
 */
const MOST = { count: 23, queue: 23 };

describe("the review count and the queue read once", () => {
  it("the count is the length of the queue in every state, and the queue is the same on a second read", async () => {
    const t = await household();
    const items = async (id: string) => (await reviewQueue(t.s, t.userOf(id))).items;
    const first = await items(t.adminId);
    expect(first.map((i) => i.kind)).toContain("loan_terms_list");
    const debts = (items: typeof first) => items.flatMap((i) => (i.kind === "loan_terms_list" ? i.debts : []));
    expect((await reviewCount(t.s, t.userOf(t.adminId))).count).toBe(first.length);
    expect(await items(t.adminId)).toEqual(first);
    // the loan questions are the proposals of the loans route, which reads its own view and its own inputs
    const proposals = (await t.admin.call("GET", "/api/loans/proposals")).body.proposals as { key: string }[];
    expect(debts(first).flatMap((d) => (d.source === "proposal" || d.source === "plan" ? [d.key] : [])).sort()).toEqual(proposals.map((p) => p.key).sort());

    // an answer takes its debt away, and the count follows
    const loan = debts(first).find((d) => d.source === "proposal")!;
    expect((await t.admin.call("PUT", "/api/marks", notLoanMark({ key: loan.key! }))).status).toBe(200);
    const answered = await items(t.adminId);
    expect(debts(answered).map((d) => d.id)).not.toContain(loan.id);
    expect((await reviewCount(t.s, t.userOf(t.adminId))).count).toBe(answered.length);

    // a new payee is asked about
    const repo = t.s.finance(t.adminId);
    await ingestTransactions(repo, "chk", [raw("2026-10-08", -61.2, "TOINEN KAUPPA XYZ", "KORTTIOSTO")], "csv");
    await reprocess(repo, t.s.settings);
    const grown = await items(t.adminId);
    expect(grown.map((i) => i.id)).toContain("payee_out:Toinen Kauppa Xyz");
    expect(answered.map((i) => i.id)).not.toContain("payee_out:Toinen Kauppa Xyz");
    expect((await reviewCount(t.s, t.userOf(t.adminId))).count).toBe(grown.length);

    // the other member is asked about their own rows only, and the count says the same
    const maija = await items(t.maijaId);
    expect((await reviewCount(t.s, t.userOf(t.maijaId))).count).toBe(maija.length);
    expect(maija.map((i) => i.id)).not.toContain(loan.id);
  });

  it("a warm count and a warm queue read the database a bounded number of times", async () => {
    const t = await household();
    // the first request builds the context; the next ones read what a request reads
    const admin = t.userOf(t.adminId);
    await reviewQueue(t.s, admin);
    const queue = await statementsOf(t.db, () => reviewQueue(t.s, admin));
    const count = await statementsOf(t.db, () => reviewCount(t.s, admin));
    expect.soft(count, "statements of a warm count").toBeLessThanOrEqual(MOST.count);
    expect.soft(queue, "statements of a warm queue").toBeLessThanOrEqual(MOST.queue);
  });
});
