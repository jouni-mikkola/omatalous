/**
 * A saved loan whose payments cannot be placed, as a row of Täydennä lainat (services/review-loan-terms.ts): the row names
 * the facts the loan lacks (`missing` below is the first of them), goes when the loan's form is saved with it, and is set aside with a mark `dismissed`. A loan
 * linked to a connected account owes what the account says. A connected card that owes is asked for its rate until a rate
 * is saved for it, whether a loan is linked to it or not. Only the member's own loans and cards are asked. Made-up names and sums; the test clock is 9.10.2026.
 */
import type { AccountType } from "@banking/core";
import { loanTermsSubject } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

type Item = { id: string; kind: string; cents: number; [field: string]: unknown };
type Caller = { call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }> };

/** The rows of Täydennä lainat of saved loans and connected cards, each with the first fact it lacks as `missing`. */
const queue = async (c: Caller) => {
  const list = ((await c.call("GET", "/api/review")).body.items as Item[]).find((i) => i.kind === "loan_terms_list");
  const debts = (list?.debts ?? []) as { source: string; gaps: string[]; [field: string]: unknown }[];
  return debts.filter((d) => d.source === "loan" || d.source === "card").map((d): Record<string, unknown> => ({ ...d, missing: d.gaps[0] }));
};

const BASE = { name: "Asuntolaina", kind: "mortgage", balanceCents: 15_000_000, balanceDate: "2026-10-01" };
const FULL = { ...BASE, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, rateBp: 350 };

const save = async (c: Caller, body: object) => (await c.call("POST", "/api/loans", body)).body.loan.id as string;

describe("the question of a loan whose payments cannot be placed", () => {
  it("names the loan and the one fact it lacks", async () => {
    const t = await setupApp();
    const id = await save(t.admin, BASE);
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ id: `loan:${id}`, loanId: id, name: "Asuntolaina", owedCents: 15_000_000, balanceDate: "2026-10-01", missing: "repayment", subject: loanTermsSubject(id) })]);
  });

  it("asks for each fact in turn, as the plan needs them", async () => {
    const t = await setupApp();
    const missing = async (body: object) => {
      const id = await save(t.admin, body);
      const [item] = await queue(t.admin);
      await t.admin.call("DELETE", `/api/loans/${id}`);
      return item?.missing;
    };
    expect(await missing({ ...BASE, repayment: "bullet" })).toBe("end_date");
    expect(await missing({ ...BASE, repayment: "annuity", rateBp: 350 })).toBe("interval");
    expect(await missing({ ...BASE, repayment: "annuity", intervalMonths: 1, rateBp: 350 })).toBe("payment");
    expect(await missing({ ...BASE, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 })).toBe("rate");
    expect(await missing({ ...BASE, repayment: "bullet", endDate: "2030-01-01" })).toBeUndefined();
  });

  it("keeps asking while a saved loan still lacks the fact", async () => {
    const t = await setupApp();
    const id = await save(t.admin, { ...BASE, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 });
    expect((await t.admin.call("PUT", `/api/loans/${id}`, { ...BASE, name: "Uusi nimi", repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 })).status).toBe(200);
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ loanId: id, name: "Uusi nimi", missing: "rate" })]);
  });

  it("goes once the loan is saved with the fact", async () => {
    const t = await setupApp();
    const id = await save(t.admin, { ...BASE, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 });
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ missing: "rate" })]);
    expect((await t.admin.call("PUT", `/api/loans/${id}`, FULL)).status).toBe(200);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("asks nothing of a loan that owes nothing or of a card", async () => {
    const t = await setupApp();
    await save(t.admin, { ...BASE, balanceCents: 0 });
    await save(t.admin, { name: "Kortti", kind: "card", balanceCents: 50_000, balanceDate: "2026-10-01", limitCents: 200_000 });
    expect(await queue(t.admin)).toEqual([]);
  });

  it("is set aside with a mark that only dismisses, and stays away for that loan alone", async () => {
    const t = await setupApp();
    const id = await save(t.admin, BASE);
    const other = await save(t.admin, { ...BASE, name: "Toinen laina" });
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanTermsSubject(id), mark: "in_use" })).status).toBe(400);
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanTermsSubject(id), mark: "dismissed" })).status).toBe(200);
    expect((await queue(t.admin)).map((i) => i.loanId)).toEqual([other]);
  });

  it("keeps asking for the rate and the payment of a loan whose mark says dismissed, and honours it for the rest", async () => {
    const t = await setupApp();
    const noRate = await save(t.admin, { ...BASE, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 });
    const noPayment = await save(t.admin, { ...BASE, name: "Toinen laina", repayment: "annuity", intervalMonths: 1, rateBp: 350 });
    const noInterval = await save(t.admin, { ...BASE, name: "Kolmas laina", repayment: "annuity", paymentCents: 90_000, rateBp: 350 });
    for (const id of [noRate, noPayment, noInterval]) expect((await t.admin.call("PUT", "/api/marks", { subject: loanTermsSubject(id), mark: "dismissed" })).status).toBe(200);
    expect((await queue(t.admin)).map((i) => [i.loanId, i.missing]).sort()).toEqual([[noRate, "rate"], [noPayment, "payment"]].sort());
  });

  it("is a member's own: another member's loan, paid from an account shared with the first user, is not asked of them", async () => {
    const t = await setupApp();
    const ville = await t.member("ville", "Ville");
    await account(t, ville.id, "v-chk", "checking", 100_000);
    await t.s.household.share(ville.id, "v-chk", t.adminId);
    const id = await save(ville, { ...BASE, name: "Villen laina", seriesKey: "out:v-chk:Esimerkkirahoitus" });
    expect(await queue(t.admin)).toEqual([]);
    expect((await queue(ville)).map((i) => i.loanId)).toEqual([id]);
  });
});

const account = async (t: Awaited<ReturnType<typeof setupApp>>, userId: string, id: string, type: AccountType, balanceCents: number, balanceAt = "2026-10-09T06:00:00.000Z") => {
  const repo = t.s.finance(userId);
  await repo.upsertAccount({ id, connectionId: null, provider: "csv", externalId: null, identity: null, name: id, iban: null, currency: "EUR", type });
  await repo.setAccountBalance(id, balanceCents, balanceAt);
  await reprocess(repo, t.s.settings);
};

const raw = (bookingDate: string, amountCents: number, counterparty: string, description: string | null = null) => ({
  externalId: `${bookingDate}|${amountCents}|${counterparty}`, bookingDate, valueDate: null, amountCents, currency: "EUR", status: "booked" as const, counterparty, counterpartyIban: null, description, reference: null, mcc: null,
});
const addDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * A card that shows paid in full: 10 euros of purchases a day from 1.3. and, on each 9th from April to September, a bill
 * from the checking account for what the days since the 9th before came to. The card owes the 30 days since the last bill
 * and the 9 days before the first one, 39 000 cents in all.
 */
const paidInFullCard = async (t: Awaited<ReturnType<typeof setupApp>>) => {
  const repo = t.s.finance(t.adminId);
  await account(t, t.adminId, "chk", "checking", 100_000);
  await account(t, t.adminId, "card", "credit_card", -39_000);
  const card = [];
  for (let d = "2026-03-01"; d <= "2026-10-09"; d = addDay(d)) card.push(raw(d, -1_000, "Kahvila"));
  const chk = [];
  const ninths = ["03", "04", "05", "06", "07", "08", "09"].map((m) => `2026-${m}-09`);
  for (let i = 1; i < ninths.length; i++) {
    const cents = ((Date.parse(ninths[i]!) - Date.parse(ninths[i - 1]!)) / 86_400_000) * 1_000;
    chk.push(raw(ninths[i]!, -cents, "NORDEA RAHOITUS", "KORTTILASKU"));
    card.push(raw(ninths[i]!, cents, "Maksu kiitos"));
  }
  await ingestTransactions(repo, "chk", chk, "enablebanking");
  await ingestTransactions(repo, "card", card, "enablebanking");
  await reprocess(repo, t.s.settings);
};

describe("the question of a loan on a reference rate", () => {
  const EURIBOR = { ...FULL, reference: "euribor_12" };
  it("asks the margin, then the day the rate is reviewed, and goes once the loan has both", async () => {
    const t = await setupApp();
    const id = await save(t.admin, EURIBOR);
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ loanId: id, missing: "margin" })]);
    expect((await t.admin.call("PUT", `/api/loans/${id}`, { ...EURIBOR, marginBp: 80 })).status).toBe(200);
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ loanId: id, missing: "review_date" })]);
    expect((await t.admin.call("PUT", `/api/loans/${id}`, { ...EURIBOR, marginBp: 80, rateReviewDate: "2027-01-05" })).status).toBe(200);
    expect(await queue(t.admin)).toEqual([]);
  });
  it("asks nothing more of a loan with a fixed rate", async () => {
    const t = await setupApp();
    await save(t.admin, { ...FULL, reference: "fixed" });
    expect(await queue(t.admin)).toEqual([]);
  });
  it("may be set aside with the mark of the loan", async () => {
    const t = await setupApp();
    const id = await save(t.admin, EURIBOR);
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanTermsSubject(id), mark: "dismissed" })).status).toBe(200);
    expect(await queue(t.admin)).toEqual([]);
  });
});

describe("the question of a loan linked to a connected account", () => {
  it("asks when the account owes and the typed balance says nothing is owed, and tells what the account owes", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "mortgage", "loan", -12_000_000);
    const id = await save(t.admin, { ...BASE, balanceCents: 0, accountId: "mortgage" });
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ loanId: id, owedCents: 12_000_000, balanceDate: "2026-10-09", missing: "repayment" })]);
  });

  it("asks nothing when the bank shows the loan paid off, whatever the typed balance says", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "mortgage", "loan", 0);
    await save(t.admin, { ...BASE, accountId: "mortgage" });
    expect(await queue(t.admin)).toEqual([]);
  });
});

describe("the question of a connected card with no terms", () => {
  it("asks for the rate of a card that owes, and goes once a loan with a rate is linked to the card", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", -50_000);
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ id: "card:card", source: "card", loanId: null, accountId: "card", name: "card", owedCents: 50_000, gaps: ["rate"], subject: null })]);
    const saved = await t.admin.call("POST", "/api/loans", { name: "Kortti", kind: "card", balanceCents: 50_000, balanceDate: "2026-10-01", limitCents: 200_000, rateBp: 1_900, accountId: "card" });
    expect(saved.status).toBe(200);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("keeps asking for the rate of a card whose linked loan saved none, and names that loan for the form", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", -50_000);
    const id = await save(t.admin, { name: "Kortti", kind: "card", balanceCents: 40_000, balanceDate: "2026-10-01", limitCents: 200_000, accountId: "card" });
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ id: "card:card", loanId: id, accountId: "card", owedCents: 50_000, balanceDate: "2026-10-09", gaps: ["rate"] })]);
    // saved again with the rate left empty, the card is still asked
    expect((await t.admin.call("PUT", `/api/loans/${id}`, { name: "Kortti", kind: "card", balanceCents: 40_000, balanceDate: "2026-10-01", limitCents: 200_000, accountId: "card", rateBp: null })).status).toBe(200);
    expect((await queue(t.admin)).map((i) => i.loanId)).toEqual([id]);
    expect((await t.admin.call("PUT", `/api/loans/${id}`, { name: "Kortti", kind: "card", balanceCents: 40_000, balanceDate: "2026-10-01", limitCents: 200_000, accountId: "card", rateBp: 1_900 })).status).toBe(200);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("counts a saved rate of 0 as a rate", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", -50_000);
    await save(t.admin, { name: "Kortti", kind: "card", balanceCents: 50_000, balanceDate: "2026-10-01", limitCents: 200_000, rateBp: 0, accountId: "card" });
    expect(await queue(t.admin)).toEqual([]);
  });

  it("keeps asking for the rate of a linked card whatever the loan's mark says", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", -50_000);
    const id = await save(t.admin, { name: "Kortti", kind: "card", balanceCents: 50_000, balanceDate: "2026-10-01", limitCents: 200_000, accountId: "card" });
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanTermsSubject(id), mark: "dismissed" })).status).toBe(200);
    expect((await queue(t.admin)).map((i) => i.loanId)).toEqual([id]);
  });

  it("asks nothing of a card the rows show paid in full, whether a loan without a rate is linked to it or not", async () => {
    const t = await setupApp();
    await paidInFullCard(t);
    expect(await queue(t.admin)).toEqual([]);
    await save(t.admin, { name: "Kortti", kind: "card", balanceCents: 39_000, balanceDate: "2026-10-01", limitCents: 200_000, accountId: "card" });
    expect(await queue(t.admin)).toEqual([]);
  });

  it("asks nothing of a linked card that owes nothing, though its loan has no rate", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", 0);
    await save(t.admin, { name: "Kortti", kind: "card", balanceCents: 50_000, balanceDate: "2026-10-01", limitCents: 200_000, accountId: "card" });
    expect(await queue(t.admin)).toEqual([]);
  });

  it("takes the typed balance and its day when they are newer than the account's", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", -50_000, "2026-10-05T06:00:00.000Z");
    const id = await save(t.admin, { name: "Kortti", kind: "card", balanceCents: 40_000, balanceDate: "2026-10-07", limitCents: 200_000, accountId: "card" });
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ loanId: id, owedCents: 40_000, balanceDate: "2026-10-07", missing: "rate" })]);
  });

  it("asks nothing of a credit line drawn on an account that is no card", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "mortgage", "loan", -2_000_000);
    await save(t.admin, { name: "Luottoraja", kind: "credit_line", balanceCents: 2_000_000, balanceDate: "2026-10-01", limitCents: 3_000_000, accountId: "mortgage" });
    expect(await queue(t.admin)).toEqual([]);
  });

  it("asks nothing of a card that owes nothing", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", 0);
    await account(t, t.adminId, "credit", "credit_card", 12_000);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("keeps asking for the rate of a card whatever its mark says", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", -50_000);
    await account(t, t.adminId, "card-2", "credit_card", -20_000);
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanTermsSubject("account:card"), mark: "in_use" })).status).toBe(400);
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanTermsSubject("account:card"), mark: "dismissed" })).status).toBe(200);
    expect((await queue(t.admin)).map((i) => i.accountId).sort()).toEqual(["card", "card-2"]);
  });

  it("is the member's own: another member's card, shared with the first user or not, is not asked of them", async () => {
    const t = await setupApp();
    const ville = await t.member("ville", "Ville");
    await account(t, ville.id, "v-card", "credit_card", -30_000);
    await account(t, ville.id, "v-hidden", "credit_card", -40_000);
    await t.s.household.share(ville.id, "v-card", t.adminId);
    expect(await queue(t.admin)).toEqual([]);
    expect((await queue(ville)).map((i) => i.accountId).sort()).toEqual(["v-card", "v-hidden"]);
  });
});

describe("the question of a payment the loan's plan did not expect", () => {
  const KEY = "out:chk:Esimerkkirahoitus";
  const LOAN = { ...FULL, balanceDate: "2026-08-01", seriesKey: KEY };
  const payment = (date: string, cents: number) => raw(date, -cents, "ESIMERKKIRAHOITUS OY", "LAINAN LYHENNYS");
  const drift = async (c: Caller) => ((await c.call("GET", "/api/review")).body.items as Item[]).filter((i) => i.kind === "loan_drift");

  /** A household whose loan was saved in August, with the rows of the lender on its checking account. */
  const household = async (rows: ReturnType<typeof raw>[], body: object = LOAN) => {
    const t = await setupApp();
    await account(t, t.adminId, "chk", "checking", 100_000);
    const repo = t.s.finance(t.adminId);
    await ingestTransactions(repo, "chk", rows, "csv");
    await reprocess(repo, t.s.settings);
    const id = await save(t.admin, body);
    const [saved] = await repo.listLoans();
    await repo.updateLoan(saved!, "2026-08-02T06:00:00.000Z");
    return { t, id };
  };

  it("names the payment the bank took, the one the plan expected and the payment to save, with the row", async () => {
    const { t, id } = await household([payment("2026-09-02", 90_000), payment("2026-10-02", 95_000)]);
    expect(await drift(t.admin)).toEqual([expect.objectContaining({ id: `loan_drift:${id}`, cents: 0, loanId: id, name: "Asuntolaina", date: "2026-10-02", paidCents: 95_000, expectedCents: 90_000, newPaymentCents: 95_000, reviewDate: null, rowCount: 1 })]);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("asks nothing while the payments are the plan's, within the bank's rounding", async () => {
    const { t } = await household([payment("2026-09-02", 90_000), payment("2026-10-02", 90_500)]);
    expect(await drift(t.admin)).toEqual([]);
  });

  it("goes when the loan is saved after the row", async () => {
    const { t, id } = await household([payment("2026-09-02", 90_000), payment("2026-10-02", 95_000)]);
    expect(await drift(t.admin)).toHaveLength(1);
    expect((await t.admin.call("PUT", `/api/loans/${id}`, { ...LOAN, paymentCents: 95_000 })).status).toBe(200);
    expect(await drift(t.admin)).toEqual([]);
  });

  it("proposes the due date as the review day of a loan on a reference rate", async () => {
    const { t } = await household([payment("2026-09-02", 90_000), payment("2026-10-02", 95_000)], { ...LOAN, reference: "euribor_12", marginBp: 80, rateReviewDate: "2026-09-01" });
    expect(await drift(t.admin)).toEqual([expect.objectContaining({ newPaymentCents: 95_000, reviewDate: "2026-10-01" })]);
  });

  it("leaves the loan's terms first: a loan that lacks a fact has no drift question", async () => {
    const { t, id } = await household([payment("2026-09-02", 90_000), payment("2026-10-02", 95_000)], { ...LOAN, reference: "euribor_12" });
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ loanId: id, missing: "margin" })]);
    expect(await drift(t.admin)).toEqual([]);
  });

  it("asks nothing of a loan with no series", async () => {
    const { t } = await household([payment("2026-09-02", 90_000), payment("2026-10-02", 95_000)], { ...LOAN, seriesKey: null });
    expect(await drift(t.admin)).toEqual([]);
  });
});

describe("Täydennä lainat", () => {
  const items = async (c: Caller) => (await c.call("GET", "/api/review")).body.items as Item[];

  it("is one item, first in the queue, its debts the largest year of payments first and the ones of no known payment last", async () => {
    const t = await setupApp();
    const bare = await save(t.admin, { ...BASE, name: "Ei maksua" });
    const small = await save(t.admin, { ...BASE, name: "Pieni", repayment: "annuity", intervalMonths: 1, paymentCents: 20_000 });
    const large = await save(t.admin, { ...BASE, name: "Suuri", repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 });
    const [first, ...rest] = await items(t.admin);
    expect(first).toMatchObject({ kind: "loan_terms_list", id: "loan-terms", cents: 12 * 110_000 });
    expect(rest.filter((i) => i.kind === "loan_terms_list")).toEqual([]);
    expect((first!.debts as { loanId: string }[]).map((d) => d.loanId)).toEqual([large, small, bare]);
  });

  it("tells what the household owes as the first page does, and how many debts have no balance", async () => {
    const t = await setupApp();
    await save(t.admin, { ...BASE, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 });
    await account(t, t.adminId, "card", "credit_card", -50_000);
    const [first] = await items(t.admin);
    const { debtCents } = (await t.admin.call("GET", "/api/dashboard?scope=own")).body.holdings as { debtCents: number | null };
    expect(debtCents).toBeGreaterThan(0);
    expect(first).toMatchObject({ kind: "loan_terms_list", debtsCents: debtCents, noBalance: 0 });
  });

  it("leaves the queue once no debt lacks a fact", async () => {
    const t = await setupApp();
    const id = await save(t.admin, { ...BASE, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 });
    expect((await items(t.admin)).map((i) => i.kind)).toContain("loan_terms_list");
    expect((await t.admin.call("PUT", `/api/loans/${id}`, FULL)).status).toBe(200);
    expect((await items(t.admin)).map((i) => i.kind)).not.toContain("loan_terms_list");
  });
});
