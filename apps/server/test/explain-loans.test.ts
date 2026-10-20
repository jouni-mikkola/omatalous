/**
 * The loan figures of Lainat and Varallisuus open their basis (explain/loans.ts): each is the figure /reports and the
 * dashboard send, its lines add up to it and each is named. A loan of the figure is one of the viewer's view.
 */
import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

type Answer = { figure: string; cents: number | null; lines: { id: string; cents: number }[]; check: { kind: string; diffCents?: number }; rows: { id: string; merchant: string }[] };

const mortgage = { name: "Asuntolaina", kind: "mortgage", lender: "Esimerkkipankki", balanceCents: 15_000_000, balanceDate: "2026-06-01", rateBp: 350, reference: "euribor_12", marginBp: 70, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, endDate: "2045-06-01" };

describe("the basis of a loan figure", () => {
  it("adds up to the figures of Lainat and Varallisuus, every line named", async () => {
    const app = await setupApp();
    const added = await app.admin.call("POST", "/api/loans", mortgage);
    expect(added.status).toBe(200);
    const id: string = added.body.loan.id;
    const report = (await app.admin.call("GET", "/api/reports?reports=loans")).body.loans as { total: { cents: number }; interest: { cents: number }; payments: { monthlyCents: number }; loans: { id: string; balance: { cents: number }; interest: { cents: number }; payment: { cents: number } }[] };
    const holdings = (await app.admin.call("GET", "/api/dashboard")).body.holdings as { loansCents: number; loans: { id: string; monthlyPaymentCents: number }[] };
    const row = report.loans.find((l) => l.id === id)!;
    const cases: [string, number][] = [
      ["figure=loans.total", report.total.cents],
      ["figure=loans.interest", report.interest.cents],
      ["figure=loans.payments", report.payments.monthlyCents],
      ["figure=holdings.loans", holdings.loansCents],
      [`figure=loan.balance&loan=${id}`, row.balance.cents],
      [`figure=loan.interest&loan=${id}`, row.interest.cents],
      [`figure=loan.payment&loan=${id}`, row.payment.cents],
      [`figure=loan.monthly&loan=${id}`, holdings.loans.find((l) => l.id === id)!.monthlyPaymentCents],
    ];
    for (const [q, cents] of cases) {
      const res = await app.admin.call("GET", `/api/explain?${q}`);
      expect(res.status, q).toBe(200);
      const a = res.body as Answer;
      expect(a.cents, q).toBe(cents);
      expect(a.check, q).toEqual({ kind: "sum", diffCents: 0 });
      expect(a.lines.length, q).toBeGreaterThan(0);
      const names = new Set(a.rows.map((r) => r.id));
      expect(a.lines.filter((l) => !names.has(l.id)), q).toEqual([]);
    }
    const total = (await app.admin.call("GET", "/api/explain?figure=loans.total")).body as Answer;
    expect(total.rows).toEqual([{ id: `loan:${id}`, merchant: "Asuntolaina", category: "" }]);
  });

  it("refuses a loan that is not the viewer's, a loan of no shape, and a loan where the figure takes none", async () => {
    const app = await setupApp();
    const id: string = (await app.admin.call("POST", "/api/loans", mortgage)).body.loan.id;
    const eero = await app.member("eero", "Eero");
    expect((await eero.call("GET", `/api/explain?figure=loan.balance&loan=${id}`)).status).toBe(404);
    expect((await app.admin.call("GET", "/api/explain?figure=loan.balance&loan=00000000-0000-0000-0000-000000000000")).status).toBe(404);
    for (const q of ["figure=loan.balance", "figure=loan.balance&loan=../x", "figure=loan.balance&loan=account:a%20b", `figure=loans.total&loan=${id}`, `figure=spend.month&loan=${id}`]) {
      expect((await app.admin.call("GET", `/api/explain?${q}`)).status, q).toBe(400);
    }
  });
});
