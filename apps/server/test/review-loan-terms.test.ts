/**
 * Tarkistettavat's question of a saved loan whose payments cannot be placed (services/review-loan-terms.ts): it names the
 * one fact the loan lacks, goes when the loan's form is saved with it, and is set aside with a mark `dismissed`. A loan
 * linked to a connected account owes what the account says. A connected card that owes is asked for its rate until a rate
 * is saved for it, whether a loan is linked to it or not. Only the member's own loans and cards are asked. Made-up names and sums; the test clock is 9.10.2026.
 */
import type { AccountType } from "@banking/core";
import { loanTermsSubject } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { setupApp } from "./helpers.ts";

type Item = { id: string; kind: string; cents: number; [field: string]: unknown };
type Caller = { call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }> };

const queue = async (c: Caller) => ((await c.call("GET", "/api/review")).body.items as Item[]).filter((i) => i.kind === "loan_terms");

const BASE = { name: "Asuntolaina", kind: "mortgage", balanceCents: 15_000_000, balanceDate: "2026-10-01" };
const FULL = { ...BASE, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, rateBp: 350 };

const save = async (c: Caller, body: object) => (await c.call("POST", "/api/loans", body)).body.loan.id as string;

describe("the question of a loan whose payments cannot be placed", () => {
  it("names the loan and the one fact it lacks", async () => {
    const t = await setupApp();
    const id = await save(t.admin, BASE);
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ id: `loan_terms:${id}`, loanId: id, name: "Asuntolaina", owedCents: 15_000_000, balanceDate: "2026-10-01", missing: "repayment", subject: loanTermsSubject(id) })]);
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

const account = async (t: Awaited<ReturnType<typeof setupApp>>, userId: string, id: string, type: AccountType, balanceCents: number) => {
  const repo = t.s.finance(userId);
  await repo.upsertAccount({ id, connectionId: null, provider: "csv", externalId: null, identity: null, name: id, iban: null, currency: "EUR", type });
  await repo.setAccountBalance(id, balanceCents, "2026-10-09T06:00:00.000Z");
  await reprocess(repo, t.s.settings);
};

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
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ id: "loan_terms:account:card", loanId: null, accountId: "card", name: "card", owedCents: 50_000, missing: "rate", subject: loanTermsSubject("account:card") })]);
    const saved = await t.admin.call("POST", "/api/loans", { name: "Kortti", kind: "card", balanceCents: 50_000, balanceDate: "2026-10-01", limitCents: 200_000, rateBp: 1_900, accountId: "card" });
    expect(saved.status).toBe(200);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("keeps asking for the rate of a card whose linked loan saved none, and names that loan for the form", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", -50_000);
    const id = await save(t.admin, { name: "Kortti", kind: "card", balanceCents: 40_000, balanceDate: "2026-10-01", limitCents: 200_000, accountId: "card" });
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ id: `loan_terms:${id}`, loanId: id, accountId: "card", owedCents: 50_000, balanceDate: "2026-10-09", missing: "rate", subject: loanTermsSubject(id) })]);
    expect((await t.admin.call("PUT", `/api/loans/${id}`, { name: "Kortti", kind: "card", balanceCents: 40_000, balanceDate: "2026-10-01", limitCents: 200_000, accountId: "card", rateBp: 1_900 })).status).toBe(200);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("counts a saved rate of 0 as a rate", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", -50_000);
    await save(t.admin, { name: "Kortti", kind: "card", balanceCents: 50_000, balanceDate: "2026-10-01", limitCents: 200_000, rateBp: 0, accountId: "card" });
    expect(await queue(t.admin)).toEqual([]);
  });

  it("is set aside for a linked card by the loan's own mark", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", -50_000);
    const id = await save(t.admin, { name: "Kortti", kind: "card", balanceCents: 50_000, balanceDate: "2026-10-01", limitCents: 200_000, accountId: "card" });
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanTermsSubject(id), mark: "dismissed" })).status).toBe(200);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("asks nothing of a card that owes nothing", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", 0);
    await account(t, t.adminId, "credit", "credit_card", 12_000);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("is set aside with the mark, for that card alone", async () => {
    const t = await setupApp();
    await account(t, t.adminId, "card", "credit_card", -50_000);
    await account(t, t.adminId, "card-2", "credit_card", -20_000);
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanTermsSubject("account:card"), mark: "in_use" })).status).toBe(400);
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanTermsSubject("account:card"), mark: "dismissed" })).status).toBe(200);
    expect((await queue(t.admin)).map((i) => i.accountId)).toEqual(["card-2"]);
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
