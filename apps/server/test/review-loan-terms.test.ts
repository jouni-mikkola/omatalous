/**
 * Tarkistettavat's question of a saved loan whose payments cannot be placed (services/review-loan-terms.ts): it names the
 * one fact the loan lacks, goes when the loan's form is saved with it, and is set aside with a mark `dismissed`. Only the
 * member's own loans are asked. Made-up names and sums; the test clock is 9.10.2026.
 */
import { loanTermsSubject } from "@banking/core";
import { describe, expect, it } from "vitest";
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

  it("is a member's own: another member's loan is not asked of the household's first user", async () => {
    const t = await setupApp();
    const ville = await t.member("ville", "Ville");
    const id = await save(ville, { ...BASE, name: "Villen laina" });
    expect(await queue(t.admin)).toEqual([]);
    expect((await queue(ville)).map((i) => i.loanId)).toEqual([id]);
  });
});
