import { debtInterestNext12Months, debtTotalOn, type Loan, loanBalanceOn, loanInterestNext12Months, loanPayoffDate, loanPeriodInterest } from "@banking/core";
import { describe, expect, it } from "vitest";
import { requestInputs } from "../src/services/analysis.ts";
import { setupApp } from "./helpers.ts";

// The test clock is 2026-10-09: a balance date runs from 1986-10-09 to 2026-10-09 and a last due date to 2076-10-09.
// One month's interest on the balance is 15 234 055 × 340 / 120 000 = 43 163 cents.
const mortgage = {
  name: "Asuntolaina",
  lender: "Nordea",
  kind: "mortgage",
  grantedCents: 18_000_000,
  balanceCents: 15_234_055,
  balanceDate: "2026-10-01",
  rateBp: 340,
  reference: "euribor_12",
  marginBp: 65,
  repayment: "annuity",
  intervalMonths: 1,
  paymentCents: 81_240,
  endDate: "2051-06-15",
  limitCents: null,
  seriesKey: "out:a-1:NORDEA LAINA",
};
const creditLine = { name: "Joustoluotto", kind: "credit_line", balanceCents: 123_456, balanceDate: "2026-10-05", rateBp: 1290, limitCents: 500_000 };
const bare = { name: "Opintolaina", kind: "student", balanceCents: 845_000, balanceDate: "2026-09-30" };
const MAX_CENTS = 1_000_000_000;

describe("loans", () => {
  it("adds, lists, replaces and deletes a loan, and keeps it in the database", async () => {
    const { admin, db, adminId } = await setupApp();
    expect((await admin.call("GET", "/api/loans")).body).toEqual({ loans: [] });

    const added = await admin.call("POST", "/api/loans", mortgage);
    expect(added.status).toBe(200);
    expect(added.body.loan).toEqual({ id: added.body.loan.id, ...mortgage });
    expect(added.body.loan.id).toMatch(/^[0-9a-f-]{36}$/);
    const id: string = added.body.loan.id;
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([added.body.loan]);
    expect(await db.first("SELECT user_id, created_at, updated_at FROM loans WHERE id = ?", [id])).toEqual({ user_id: adminId, created_at: "2026-10-09T10:00:00.000Z", updated_at: "2026-10-09T10:00:00.000Z" });

    // the body of a PUT is the whole loan: what it leaves out is saved as not given
    const replaced = await admin.call("PUT", `/api/loans/${id}`, { ...bare, name: "Asuntolaina 2" });
    expect(replaced.status).toBe(200);
    const none = { lender: null, grantedCents: null, rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null };
    expect(replaced.body.loan).toEqual({ id, ...bare, name: "Asuntolaina 2", ...none });
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([replaced.body.loan]);

    expect((await admin.call("DELETE", `/api/loans/${id}`)).body).toEqual({ ok: true });
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([]);
    expect((await admin.call("DELETE", `/api/loans/${id}`)).status).toBe(404);
    expect((await admin.call("PUT", `/api/loans/${id}`, mortgage)).status).toBe(404);
  });

  it("lists the loans in the order they were added, and a field left out is null", async () => {
    const { admin } = await setupApp();
    for (const loan of [mortgage, creditLine, bare]) expect((await admin.call("POST", "/api/loans", loan)).status).toBe(200);
    const loans: Loan[] = (await admin.call("GET", "/api/loans")).body.loans;
    expect(loans.map((l) => l.name)).toEqual(["Asuntolaina", "Joustoluotto", "Opintolaina"]);
    expect(loans[1]).toMatchObject({ kind: "credit_line", repayment: null, limitCents: 500_000, rateBp: 1290, paymentCents: null, endDate: null });
    expect(loans[2]).toMatchObject({ lender: null, grantedCents: null, rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null });
  });

  it("trims the name and the lender, and a blank lender is none", async () => {
    const { admin } = await setupApp();
    const r = await admin.call("POST", "/api/loans", { ...bare, name: "  Autolaina  ", lender: "  OP  " });
    expect(r.body.loan).toMatchObject({ name: "Autolaina", lender: "OP" });
    expect((await admin.call("POST", "/api/loans", { ...bare, lender: "   " })).body.loan.lender).toBeNull();
  });

  // every bound of routes/loans.ts with a value just outside it
  const refused: [string, Record<string, unknown>][] = [
    ["a name that is blank", { ...mortgage, name: "   " }],
    ["a name that is not text", { ...mortgage, name: 12 }],
    ["no name", { ...mortgage, name: undefined }],
    ["a name over 80 characters", { ...mortgage, name: "x".repeat(81) }],
    ["a name with a control character", { ...mortgage, name: "Asunto\nlaina" }],
    ["a lender that is not text", { ...mortgage, lender: 12 }],
    ["a lender over 80 characters", { ...mortgage, lender: "x".repeat(81) }],
    ["a lender with a control character", { ...mortgage, lender: "Nor\u0000dea" }],
    ["a kind outside the list", { ...mortgage, kind: "boat" }],
    ["a kind that is not text", { ...mortgage, kind: 1 }],
    ["no kind", { ...mortgage, kind: undefined }],
    ["no balance", { ...mortgage, balanceCents: undefined }],
    ["a balance of null", { ...mortgage, balanceCents: null }],
    ["a negative balance", { ...mortgage, balanceCents: -1 }],
    ["a balance with a fraction of a cent", { ...mortgage, balanceCents: 15_234_055.5 }],
    ["a balance as text", { ...mortgage, balanceCents: "15234055" }],
    ["a balance over ten million euros", { ...bare, balanceCents: MAX_CENTS + 1 }],
    ["a balance beyond the safe integers", { ...bare, balanceCents: 1e21 }],
    ["a granted amount of zero", { ...mortgage, grantedCents: 0 }],
    ["a negative granted amount", { ...mortgage, grantedCents: -18_000_000 }],
    ["a granted amount with a fraction", { ...mortgage, grantedCents: 0.5 }],
    ["a granted amount over ten million euros", { ...mortgage, grantedCents: MAX_CENTS + 1 }],
    ["a granted amount as text", { ...mortgage, grantedCents: "180000" }],
    ["a payment of zero", { ...mortgage, paymentCents: 0 }],
    ["a negative payment", { ...mortgage, paymentCents: -81_240 }],
    ["a payment with a fraction of a cent", { ...mortgage, paymentCents: 81_240.5 }],
    ["a payment over ten million euros", { ...mortgage, paymentCents: MAX_CENTS + 1 }],
    ["a payment as a truth value", { ...mortgage, paymentCents: true }],
    ["a limit of zero", { ...creditLine, limitCents: 0 }],
    ["a negative limit", { ...creditLine, limitCents: -500_000 }],
    ["a limit with a fraction of a cent", { ...creditLine, limitCents: 500_000.25 }],
    ["a limit over ten million euros", { ...creditLine, limitCents: MAX_CENTS + 1 }],
    ["a negative rate", { ...mortgage, rateBp: -1 }],
    ["a rate with a fraction of a hundredth", { ...mortgage, rateBp: 325.5 }],
    ["a rate over 50 %", { ...mortgage, rateBp: 5001 }],
    ["a rate as text", { ...mortgage, rateBp: "3,40" }],
    ["a negative margin", { ...mortgage, marginBp: -65 }],
    ["a margin with a fraction of a hundredth", { ...mortgage, marginBp: 65.5 }],
    ["a margin over 50 %", { ...mortgage, marginBp: 5001 }],
    ["a reference outside the list", { ...mortgage, reference: "prime" }],
    ["a reference that is not text", { ...mortgage, reference: 12 }],
    ["a repayment outside the list", { ...mortgage, repayment: "balloon" }],
    ["a repayment that is not text", { ...mortgage, repayment: 2 }],
    ["an interval of zero months", { ...mortgage, intervalMonths: 0 }],
    ["an interval of 13 months", { ...mortgage, intervalMonths: 13 }],
    ["an interval of a month and a half", { ...mortgage, intervalMonths: 1.5 }],
    ["a negative interval", { ...mortgage, intervalMonths: -1 }],
    ["no balance date", { ...mortgage, balanceDate: undefined }],
    ["a balance date that does not exist", { ...mortgage, balanceDate: "2026-02-30" }],
    ["a balance date in another format", { ...mortgage, balanceDate: "1.10.2026" }],
    ["a balance date tomorrow", { ...mortgage, balanceDate: "2026-10-10" }],
    ["a balance date more than 40 years back", { ...bare, balanceDate: "1986-10-08" }],
    ["a balance date in the year 26", { ...bare, balanceDate: "0026-10-01" }],
    ["a last due date that does not exist", { ...mortgage, endDate: "2051-06-31" }],
    ["a last due date in another format", { ...mortgage, endDate: "15.6.2051" }],
    ["a last due date more than 40 years back", { ...mortgage, endDate: "1986-10-08" }],
    ["a last due date more than 50 years ahead", { ...mortgage, endDate: "2076-10-10" }],
    ["a last due date in the year 9999", { ...mortgage, endDate: "9999-12-31" }],
    ["a review day that does not exist", { ...mortgage, rateReviewDate: "2027-02-30" }],
    ["a review day as a number", { ...mortgage, rateReviewDate: 20_270_314 }],
    ["a review day in another format", { ...mortgage, rateReviewDate: "14.3.2027" }],
    ["a review day that is empty", { ...mortgage, rateReviewDate: "" }],
    ["a review day more than 40 years back", { ...mortgage, rateReviewDate: "1986-10-08" }],
    ["a review day more than 50 years ahead", { ...mortgage, rateReviewDate: "2076-10-10" }],
    ["an empty series key", { ...mortgage, seriesKey: "" }],
    ["a series key over 200 characters", { ...mortgage, seriesKey: "x".repeat(201) }],
    ["a series key with a control character", { ...mortgage, seriesKey: "out:a-1:\u0007" }],
    ["a series key that is not text", { ...mortgage, seriesKey: 7 }],
    ["a card with a repayment plan", { ...creditLine, kind: "card", repayment: "annuity" }],
    ["a credit line with a repayment plan", { ...creditLine, repayment: "bullet" }],
    ["a bullet loan with a payment", { ...mortgage, repayment: "bullet" }],
    ["an annuity whose payment is a cent under the interest", { ...mortgage, paymentCents: 43_162 }],
    ["a fixed instalment under the interest", { ...mortgage, repayment: "fixed_instalment", paymentCents: 43_162 }],
    ["a payment every third month, a cent under that interval's interest", { ...mortgage, intervalMonths: 3, paymentCents: 129_488 }],
    ["a name of one character nobody sees", { ...mortgage, name: "​" }],
    ["a lender that turns the line around", { ...mortgage, lender: "Pankki‮" }],
    ["a series key with a line separator", { ...mortgage, seriesKey: "out:a-1: " }],
    ["a field that is not part of a loan", { ...mortgage, userId: "someone" }],
    ["an id of the caller's choosing", { ...mortgage, id: "mine" }],
  ];

  it("refuses each value outside its range or list, on a new loan and on a change", async () => {
    const { admin, db } = await setupApp();
    for (const [what, payload] of refused) {
      const r = await admin.call("POST", "/api/loans", payload);
      expect(r.status, what).toBe(400);
      expect(typeof r.body.error, what).toBe("string");
    }
    expect((await admin.call("POST", "/api/loans", [mortgage])).status).toBe(400);
    expect(await db.first("SELECT count(*) AS n FROM loans")).toEqual({ n: 0 });

    const kept = (await admin.call("POST", "/api/loans", mortgage)).body.loan;
    for (const [what, payload] of refused) expect((await admin.call("PUT", `/api/loans/${kept.id}`, payload)).status, what).toBe(400);
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([kept]);
  });

  it("names the field in the message", async () => {
    const { admin } = await setupApp();
    const error = async (payload: Record<string, unknown>) => (await admin.call("POST", "/api/loans", payload)).body.error;
    expect(await error({ ...mortgage, balanceCents: -1 })).toBe("Lainaa jäljellä pitää olla vähintään 0 € ja enintään 10 000 000 €.");
    expect(await error({ ...mortgage, paymentCents: 0 })).toBe("Maksuerän pitää olla vähintään 0,01 € ja enintään 10 000 000 €.");
    expect(await error({ ...mortgage, rateBp: 5001 })).toBe("Kokonaiskoron pitää olla 0–50 %, enintään kahden desimaalin tarkkuudella.");
    expect(await error({ ...mortgage, balanceDate: "2026-10-10" })).toMatch(/^Jäljellä olevan summan päivä/);
    expect(await error({ ...mortgage, endDate: "2076-10-10" })).toMatch(/^Viimeinen eräpäivä/);
    expect(await error({ ...mortgage, rateReviewDate: "2027-02-30" })).toBe("Koron tarkistuspäivä voi olla enintään 40 vuotta sitten ja 50 vuoden päässä.");
    expect(await error({ ...mortgage, paymentCents: 43_162 })).toMatch(/^Maksuerä on pienempi kuin lyhennysvälin korko/);
    // a payment holiday is such a loan with every field right, so the message names the way to save it
    expect(await error({ ...mortgage, paymentCents: 43_162 })).toMatch(/jätä maksuerä tyhjäksi/);
    expect(await error({ ...mortgage, repayment: "bullet" })).toMatch(/^Kertalyhenteisellä/);
    expect(await error({ ...creditLine, repayment: "annuity" })).toBe("Luottokortilla ja luottolimiitillä ei ole lyhennystapaa. Jätä se tyhjäksi.");
    expect(await error({ ...creditLine, kind: "card", repayment: "annuity" })).toMatch(/^Luottokortilla ja luottolimiitillä/);
    expect(await error({ ...mortgage, kind: "boat" })).toBe("Tuntematon laji.");
    expect(await error({ ...mortgage, paymentCents: 43_162 })).toMatch(/jätä maksuerä tyhjäksi, jos maksat vain korkoa\.$/);
  });

  it("takes the first and last value of each range", async () => {
    const { admin } = await setupApp();
    const edges: [string, Record<string, unknown>][] = [
      ["a balance of zero", { ...bare, balanceCents: 0 }],
      ["a balance of ten million euros", { ...bare, balanceCents: MAX_CENTS }],
      ["a granted amount, a payment and a limit of one cent", { ...bare, grantedCents: 1, paymentCents: 1, limitCents: 1 }],
      ["a granted amount and a limit of ten million euros", { ...bare, grantedCents: MAX_CENTS, limitCents: MAX_CENTS }],
      ["a rate and a margin of zero", { ...mortgage, rateBp: 0, marginBp: 0 }],
      ["a rate and a margin of 50 %", { ...bare, rateBp: 5000, marginBp: 5000 }],
      ["an interval of 12 months", { ...mortgage, intervalMonths: 12, paymentCents: 600_000 }],
      ["a balance date today", { ...mortgage, balanceDate: "2026-10-09" }],
      ["a balance date 40 years back", { ...bare, balanceDate: "1986-10-09" }],
      ["a last due date 40 years back", { ...mortgage, endDate: "1986-10-09" }],
      ["a last due date 50 years ahead", { ...mortgage, endDate: "2076-10-09" }],
      ["a review day 40 years back", { ...mortgage, rateReviewDate: "1986-10-09" }],
      ["a review day today", { ...mortgage, rateReviewDate: "2026-10-09" }],
      ["a review day 50 years ahead", { ...mortgage, rateReviewDate: "2076-10-09" }],
      ["a payment equal to the interest", { ...mortgage, paymentCents: 43_163 }],
      ["a payment every third month equal to that interval's interest", { ...mortgage, intervalMonths: 3, paymentCents: 129_489 }],
      ["an equal principal payment under the interest, which comes on top", { ...mortgage, repayment: "equal_principal", paymentCents: 100 }],
      ["a payment under the interest without a plan to hold it", { ...mortgage, repayment: null, paymentCents: 100 }],
      ["a bullet loan without a payment", { ...mortgage, repayment: "bullet", paymentCents: null }],
      ["a card with a limit and an interval", { ...creditLine, kind: "card", intervalMonths: 1 }],
      ["a name and a lender of 80 characters", { ...bare, name: "x".repeat(80), lender: "y".repeat(80) }],
      ["a series key of 200 characters", { ...bare, seriesKey: "x".repeat(200) }],
    ];
    expect(loanPeriodInterest(mortgage.balanceCents, mortgage.rateBp, 1)).toBe(43_163);
    for (const [what, payload] of edges) expect((await admin.call("POST", "/api/loans", payload)).status, what).toBe(200);
  });

  it("keeps core inside whole cents: no accepted loan grows, whatever the day", async () => {
    const { admin } = await setupApp();
    const old = { name: "Raja", kind: "other", balanceCents: MAX_CENTS, balanceDate: "1986-10-09", rateBp: 5000 };
    // the review's case was 100 % a year with a small payment: NaN by the year 3300
    const extremes: Record<string, unknown>[] = [
      { ...old, repayment: "annuity", intervalMonths: 12, paymentCents: loanPeriodInterest(MAX_CENTS, 5000, 12) },
      { ...old, repayment: "fixed_instalment", intervalMonths: 1, paymentCents: loanPeriodInterest(MAX_CENTS, 5000, 1) },
      { ...old, repayment: "annuity", intervalMonths: 1, paymentCents: loanPeriodInterest(MAX_CENTS, 5000, 1), endDate: "2076-10-09" },
      { ...old, repayment: "equal_principal", intervalMonths: 1, paymentCents: 1 },
      { ...old, repayment: "bullet", endDate: "2076-10-09" },
      { ...old },
      { ...old, balanceDate: "2026-10-09", limitCents: 1 },
    ];
    const loans: Loan[] = [];
    for (const payload of extremes) {
      const r = await admin.call("POST", "/api/loans", payload);
      expect(r.status, JSON.stringify(payload)).toBe(200);
      loans.push(r.body.loan);
    }
    for (const day of ["2026-10-09", "2027-10-09", "2076-10-08", "2076-10-09", "2200-01-01", "3300-01-01"]) {
      for (const loan of loans) {
        const what = `${loan.repayment} ${loan.intervalMonths} ${loan.endDate} on ${day}`;
        const owed = loanBalanceOn(loan, day).cents;
        expect(Number.isSafeInteger(owed), what).toBe(true);
        expect(owed, what).toBeGreaterThanOrEqual(0);
        expect(owed, what).toBeLessThanOrEqual(loan.balanceCents);
        const interest = loanInterestNext12Months(loan, day).cents;
        expect(Number.isSafeInteger(interest), what).toBe(true);
        expect(interest, what).toBeGreaterThanOrEqual(0);
        // a year's interest is at most the rate on the stated balance, a cent of rounding for each payment aside
        expect(interest, what).toBeLessThanOrEqual(MAX_CENTS / 2 + 12);
      }
      expect(Number.isSafeInteger(debtTotalOn(loans, day).cents), day).toBe(true);
      expect(Number.isSafeInteger(debtInterestNext12Months(loans, day).cents), day).toBe(true);
    }
    // the widest span the dates allow, 90 years of monthly payments, still reaches its last due date
    expect(loanPayoffDate(loans[2]!)).toEqual({ date: "2076-10-09", unknown: null, never: false });
  });

  it("keeps a list of at most 50 loans", async () => {
    const { admin } = await setupApp();
    for (let i = 0; i < 50; i++) expect((await admin.call("POST", "/api/loans", { ...bare, name: `Laina ${i}` })).status).toBe(200);
    const over = await admin.call("POST", "/api/loans", bare);
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/enintään 50/);
    // a change is not a new loan
    const first = (await admin.call("GET", "/api/loans")).body.loans[0];
    expect((await admin.call("PUT", `/api/loans/${first.id}`, bare)).status).toBe(200);
  });

  it("each member reads, changes and deletes only their own loans, by id too", async () => {
    const { admin, adminId, member, db } = await setupApp();
    const eero = await member("eero");
    const mine = (await admin.call("POST", "/api/loans", mortgage)).body.loan;
    const theirs = (await eero.call("POST", "/api/loans", { ...bare, name: "Eeron laina" })).body.loan;

    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([mine]);
    expect((await eero.call("GET", "/api/loans")).body.loans).toEqual([theirs]);

    // someone else's loan answers like one that does not exist, and stays as it was
    const changed = await eero.call("PUT", `/api/loans/${mine.id}`, { ...bare, name: "Kaapattu" });
    expect(changed.status).toBe(404);
    expect(changed.body).toEqual({ error: "Lainaa ei löydy." });
    const stolen = await eero.call("DELETE", `/api/loans/${mine.id}`);
    expect(stolen.status).toBe(404);
    expect(stolen.body).toEqual({ error: "Lainaa ei löydy." });
    expect((await admin.call("PUT", `/api/loans/${theirs.id}`, mortgage)).status).toBe(404);
    expect((await admin.call("DELETE", `/api/loans/${theirs.id}`)).status).toBe(404);
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([mine]);
    expect((await eero.call("GET", "/api/loans")).body.loans).toEqual([theirs]);
    expect(await db.all("SELECT user_id, name FROM loans ORDER BY name")).toEqual([
      { user_id: adminId, name: "Asuntolaina" },
      { user_id: eero.id, name: "Eeron laina" },
    ]);
  });

  it("a fixed rate has no review day: a day sent with one is checked and dropped, and another rate keeps its day", async () => {
    const { admin } = await setupApp();
    const fixed = { ...mortgage, reference: "fixed", marginBp: null };
    const added = await admin.call("POST", "/api/loans", { ...fixed, rateReviewDate: "2027-03-14" });
    expect(added.status).toBe(200);
    const id: string = added.body.loan.id;
    expect(added.body.loan).toEqual({ id, ...fixed });
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([{ id, ...fixed }]);
    expect((await admin.call("POST", "/api/loans", { ...fixed, rateReviewDate: "2027-02-30" })).status).toBe(400);

    // the same loan on a reference rate keeps the day, and loses it when its rate is made fixed
    expect((await admin.call("PUT", `/api/loans/${id}`, { ...mortgage, rateReviewDate: "2027-03-14" })).body.loan).toEqual({ id, ...mortgage, rateReviewDate: "2027-03-14" });
    expect((await admin.call("PUT", `/api/loans/${id}`, { ...fixed, rateReviewDate: "2027-03-14" })).body.loan).toEqual({ id, ...fixed });
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([{ id, ...fixed }]);
  });

  it("keeps the review day of the rate: a real date, also one that has passed, and null clears it", async () => {
    const { admin, db } = await setupApp();
    const day = async (id: string) => (await db.first<{ rate_review_date: string | null }>("SELECT rate_review_date FROM loans WHERE id = ?", [id]))?.rate_review_date;
    const added = await admin.call("POST", "/api/loans", { ...mortgage, rateReviewDate: "2027-03-14" });
    expect(added.status).toBe(200);
    const id: string = added.body.loan.id;
    expect(added.body.loan).toEqual({ id, ...mortgage, rateReviewDate: "2027-03-14" });
    expect(await day(id)).toBe("2027-03-14");
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([added.body.loan]);

    // a day that has passed is taken: the rate has been reviewed since
    const passed = await admin.call("PUT", `/api/loans/${id}`, { ...mortgage, rateReviewDate: "2026-03-14" });
    expect(passed.status).toBe(200);
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([{ id, ...mortgage, rateReviewDate: "2026-03-14" }]);

    // a refused day changes nothing
    expect((await admin.call("PUT", `/api/loans/${id}`, { ...mortgage, rateReviewDate: "2027-02-30" })).status).toBe(400);
    expect(await day(id)).toBe("2026-03-14");

    // null clears it, and so does a body that leaves it out: the body of a PUT is the whole loan
    for (const cleared of [{ ...mortgage, rateReviewDate: null }, mortgage]) {
      expect((await admin.call("PUT", `/api/loans/${id}`, { ...mortgage, rateReviewDate: "2027-03-14" })).status).toBe(200);
      const r = await admin.call("PUT", `/api/loans/${id}`, cleared);
      expect(r.status).toBe(200);
      expect(r.body.loan).toEqual({ id, ...mortgage });
      expect(await day(id)).toBeNull();
      expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([{ id, ...mortgage }]);
    }
    // a loan added with null has no day either
    expect((await admin.call("POST", "/api/loans", { ...bare, rateReviewDate: null })).body.loan).not.toHaveProperty("rateReviewDate");
  });

  it("a member cannot set the review day on another member's loan, and each loan keeps its own day", async () => {
    const { admin, member, db } = await setupApp();
    const eero = await member("eero");
    const mine = (await admin.call("POST", "/api/loans", { ...mortgage, rateReviewDate: "2027-03-14" })).body.loan;
    const theirs = (await eero.call("POST", "/api/loans", { ...bare, rateReviewDate: "2027-05-02" })).body.loan;

    const stolen = await eero.call("PUT", `/api/loans/${mine.id}`, { ...mortgage, rateReviewDate: "2028-01-01" });
    expect(stolen.status).toBe(404);
    expect(stolen.body).toEqual({ error: "Lainaa ei löydy." });
    // the same call with the day cleared would be the way to wipe it: refused as well
    expect((await eero.call("PUT", `/api/loans/${mine.id}`, { ...mortgage, rateReviewDate: null })).status).toBe(404);
    expect(await db.all("SELECT name, rate_review_date FROM loans ORDER BY name")).toEqual([
      { name: "Asuntolaina", rate_review_date: "2027-03-14" },
      { name: "Opintolaina", rate_review_date: "2027-05-02" },
    ]);
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([mine]);
    expect((await eero.call("GET", "/api/loans")).body.loans).toEqual([theirs]);
    // near miss: the owner changes it
    expect((await admin.call("PUT", `/api/loans/${mine.id}`, { ...mortgage, rateReviewDate: "2028-01-01" })).status).toBe(200);
    expect((await eero.call("GET", "/api/loans")).body.loans).toEqual([theirs]);
  });

  it("sharing an account shares no loan", async () => {
    const { admin, adminId, member, s } = await setupApp();
    const eero = await member("eero");
    await admin.call("POST", "/api/demo");
    const accounts: { id: string }[] = (await admin.call("GET", "/api/meta")).body.accounts;
    for (const a of accounts) expect((await admin.call("PUT", `/api/accounts/${a.id}/shares/${eero.id}`)).status).toBe(200);
    const mine = (await admin.call("POST", "/api/loans", mortgage)).body.loan;

    expect((await eero.call("GET", "/api/loans")).body.loans).toEqual([]);
    expect((await eero.call("PUT", `/api/loans/${mine.id}`, bare)).status).toBe(404);
    expect((await requestInputs(s, eero.id, [])).inputs.loans).toEqual([]);
    expect((await requestInputs(s, adminId, [])).inputs.loans).toEqual([mine]);
  });

  it("a loan reaches the request inputs at once, with no data version bump, and leaves with its delete", async () => {
    const { admin, adminId, s } = await setupApp();
    await admin.call("POST", "/api/demo");
    const version = await s.settings.dataVersionOf([adminId]);
    expect((await requestInputs(s, adminId, [])).inputs.loans).toEqual([]);

    const a = (await admin.call("POST", "/api/loans", mortgage)).body.loan;
    const b = (await admin.call("POST", "/api/loans", creditLine)).body.loan;
    expect((await requestInputs(s, adminId, [])).inputs.loans).toEqual([a, b]);

    const changed = (await admin.call("PUT", `/api/loans/${a.id}`, { ...mortgage, balanceCents: 15_000_000 })).body.loan;
    expect((await requestInputs(s, adminId, [])).inputs.loans).toEqual([changed, b]);
    await admin.call("DELETE", `/api/loans/${b.id}`);
    expect((await requestInputs(s, adminId, [])).inputs.loans).toEqual([changed]);
    expect(await s.settings.dataVersionOf([adminId])).toBe(version);
    // the dashboard and the reports are built from those inputs
    expect((await admin.call("GET", "/api/reports?from=2026-01-01&to=2026-09-30")).status).toBe(200);
  });

  it("a value a newer version wrote and this one does not know reads as not given", async () => {
    const { admin, adminId, db } = await setupApp();
    await db.run(
      "INSERT INTO loans (id, user_id, name, kind, balance_cents, balance_date, reference, repayment, created_at, updated_at) VALUES ('later', ?, 'Venelaina', 'boat', 500000, '2026-10-01', 'prime', 'balloon', '2026-10-09T10:00:00.000Z', '2026-10-09T10:00:00.000Z')",
      [adminId],
    );
    expect((await admin.call("GET", "/api/loans")).body.loans).toMatchObject([{ id: "later", name: "Venelaina", kind: "other", reference: null, repayment: null, balanceCents: 500_000 }]);
  });

  it("needs a signed-in user and the CSRF header", async () => {
    const { app, admin } = await setupApp();
    const anonymous = await app.request("http://localhost:8080/api/loans", { headers: { "X-Requested-With": "fetch" } });
    expect(anonymous.status).toBe(401);
    expect((await admin.call("POST", "/api/loans", mortgage, { "X-Requested-With": "" })).status).toBe(403);
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([]);

    const loan = (await admin.call("POST", "/api/loans", mortgage)).body.loan;
    expect((await admin.call("PUT", `/api/loans/${loan.id}`, bare, { "X-Requested-With": "" })).status).toBe(403);
    expect((await admin.call("DELETE", `/api/loans/${loan.id}`, undefined, { "X-Requested-With": "" })).status).toBe(403);
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([loan]);
  });

  it("goes with the user: deleting the user deletes the loans", async () => {
    const { admin, member, db } = await setupApp();
    const eero = await member("eero");
    await eero.call("POST", "/api/loans", mortgage);
    await admin.call("POST", "/api/loans", bare);
    expect(await db.first("SELECT count(*) AS n FROM loans WHERE user_id = ?", [eero.id])).toEqual({ n: 1 });
    await admin.call("DELETE", `/api/users/${eero.id}`);
    expect(await db.all("SELECT name FROM loans")).toEqual([{ name: "Opintolaina" }]);
  });
});
