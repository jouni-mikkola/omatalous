/**
 * Täydennä lainat in Tarkistettavat: one item lists every debt that lacks a balance, a rate or a payment, one row each.
 * A row asks only what its debt lacks and closes into its result line once saved; the queue is read again so the
 * totals are the server's, and Seuraava moves on after the last row. Made-up lenders, cards and sums.
 */
import { type Loan, notLoanMark } from "@banking/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { queryClient } from "../src/query-client.ts";
import { Review } from "../src/pages/Review.tsx";
import type { ReviewItem } from "../src/pages/review-items.ts";
import type { LoanTermsDebt } from "../src/pages/review-loan-items.ts";
import type { Meta } from "../src/types.ts";
import { failing, stubApi } from "./dom-kit.ts";

const T = { timeout: 15000 };
const metaOf = (accounts: unknown[] = [], today = "2026-10-09") => ({ accounts, sharedAccounts: [], bank: { banks: [] }, today }) as unknown as Meta;
const debtOf = (over: Partial<LoanTermsDebt>): LoanTermsDebt => ({
  id: "d",
  source: "loan",
  name: "Laina",
  loanId: null,
  accountId: null,
  key: null,
  kind: "other",
  placed: true,
  monthlyCents: null,
  latestCents: null,
  lastDate: null,
  owedCents: null,
  balanceDate: null,
  gaps: [],
  subject: null,
  terms: null,
  savedCards: [],
  ...over,
});
const listOf = (debts: LoanTermsDebt[], debtsCents: number | null = null, noBalance = 0) => ({ kind: "loan_terms_list", id: "loan-terms", cents: 0, debts, debtsCents, noBalance }) as unknown as ReviewItem;
const show = (items: ReviewItem[], meta = metaOf(), reload = () => {}) => render(createElement(Review, { meta, queue: { data: { items }, error: null, reload } }));
const savedLoan = (over: Partial<Loan>): Loan => ({ id: "loan-7", name: "Asuntolaina", lender: null, kind: "mortgage", grantedCents: null, balanceCents: 15_000_000, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, endDate: null, limitCents: null, seriesKey: null, ...over }) as Loan;
const plain = (s: string | null | undefined) => (s ?? "").replace(/\s/g, " ");
/** The row of the list that is still asked, by its place among those. */
const openRow = (n = 0) => document.querySelectorAll<HTMLElement>("li.review-debt:not(.is-done)")[n]!;
const totals = () => plain(document.querySelector(".review-debt-totals")!.textContent);

describe("Täydennä lainat", () => {
  it("is one question with a row per debt, each headed by what is known of it", () => {
    queryClient.clear();
    stubApi({ "GET /api/loans": { loans: [], fixings: {} } });
    const debts = [
      debtOf({ id: "proposal:k", source: "proposal", name: "Esimerkkipankki", key: "k", kind: "mortgage", monthlyCents: 86_141, latestCents: 86_141, lastDate: "2026-10-16" }),
      debtOf({ id: "loan-8", source: "loan", name: "Autolaina", loanId: "loan-8", kind: "car", owedCents: 1_200_000, gaps: ["rate"] }),
    ];
    show([listOf(debts, null, 1)]);
    expect(document.querySelector(".review-item")!.textContent).toContain("Täydennä lainat");
    const names = [...document.querySelectorAll(".review-debt-name")].map((h) => plain(h.textContent));
    expect(names).toEqual([plain("Esimerkkipankki · Asuntolaina · 861,41 €/kk · eräpäivä 16."), plain("Autolaina · Jäljellä 12 000,00 €")]);
    // the total is unknown while a debt has no balance: a dash, never a sum the page adds itself
    expect(totals()).toBe(plain("Velat yhteensä –Ilman saldoa 1"));
  });

  it("asks a saved loan only the fact it lacks, saves the loan's own form, closes the row into its result line and reads the queue again", async () => {
    queryClient.clear();
    const loan = savedLoan({});
    const other = savedLoan({ id: "loan-8", name: "Toinen laina" });
    const seen = stubApi({ "GET /api/loans": { loans: [other, loan], fixings: {} }, "PUT /api/loans/loan-7": { loan: { ...loan, rateBp: 350 } } });
    let reloads = 0;
    const debts = [
      debtOf({ id: "loan-7", source: "loan", name: "Asuntolaina", loanId: "loan-7", kind: "mortgage", owedCents: 15_000_000, gaps: ["rate"], subject: "question:loan-terms:loan-7" }),
      debtOf({ id: "loan-8", source: "loan", name: "Toinen laina", loanId: "loan-8", kind: "mortgage", gaps: ["end_date"], subject: "question:loan-terms:loan-8" }),
    ];
    const view = show([listOf(debts, 30_000_000, 0)], metaOf(), () => void reloads++);
    const rate = await within(openRow(0)).findByLabelText(/^Korko/, {}, T);
    // the missing fact alone is asked; the rest of the form is behind one button
    expect(screen.queryAllByLabelText(/^Maksuerä/)).toHaveLength(0);
    expect(screen.queryAllByLabelText("Nimi")).toHaveLength(0);
    expect(within(openRow(1)).getByLabelText(/^Viimeinen eräpäivä/)).toBeTruthy();
    // the rate and the payment keep asking: no dismissal on that row, one on the row that lacks its end
    expect(within(openRow(0)).queryByRole("button", { name: "Älä muistuta tästä enää" })).toBeNull();
    expect(within(openRow(1)).getByRole("button", { name: "Älä muistuta tästä enää" })).toBeTruthy();
    fireEvent.change(rate, { target: { value: "3,5" } });
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "PUT" && s.path === "/api/loans/loan-7")).toBe(true), T);
    expect(seen.find((s) => s.method === "PUT")!.body).toMatchObject({ name: "Asuntolaina", rateBp: 350 });
    const line = await screen.findByText(/^Jäljellä [^·]+ · korko 3,5/, {}, T);
    expect(reloads).toBe(1);
    // the focus moves from the form that is gone to the line it closed into
    await waitFor(() => expect(document.activeElement).toBe(line), T);
    // the totals are what the queue read again tells
    view.rerender(createElement(Review, { meta: metaOf(), queue: { data: { items: [listOf(debts.slice(1), 31_000_000, 0)] }, error: null, reload: () => {} } }));
    expect(totals()).toBe(plain("Velat yhteensä 310 000,00 €Ilman saldoa 0"));
    expect(screen.getByText(/^Jäljellä [^·]+ · korko 3,5/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Seuraava" })).toBeNull();
  });

  it("sets a saved loan's row aside with the mark of the item", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [savedLoan({})], fixings: {} }, "PUT /api/marks": {} });
    show([listOf([debtOf({ id: "loan-7", source: "loan", name: "Asuntolaina", loanId: "loan-7", gaps: ["interval"], subject: "question:loan-terms:loan-7" })])]);
    fireEvent.click(await screen.findByRole("button", { name: "Älä muistuta tästä enää" }, T));
    await waitFor(() => expect(seen.some((s) => s.path === "/api/marks")).toBe(true), T);
    expect(seen.find((s) => s.path === "/api/marks")!.body).toEqual({ subject: "question:loan-terms:loan-7", mark: "dismissed" });
    await screen.findByText("Ei muistuteta enää", {}, T);
  });

  it("gives a connected card with no saved loan the form of a new loan linked to it, and a card with a loan that loan's form", async () => {
    queryClient.clear();
    const card = { id: "card-1", name: "Luottokortti", type: "credit_card", balanceCents: -50_000, balanceAt: "2026-10-08", creditLimitCents: 200_000 };
    const linked = { ...savedLoan({ id: "loan-9", name: "Kortti", kind: "card", balanceCents: 40_000, repayment: null, intervalMonths: null, paymentCents: null, limitCents: 200_000 }), accountId: "card-2" };
    const seen = stubApi({ "GET /api/loans": { loans: [linked], fixings: {} }, "POST /api/loans": { loan: { ...linked, id: "loan-10", accountId: "card-1", rateBp: 1_900 } }, "PUT /api/loans/loan-9": { loan: { ...linked, rateBp: 1_500 } } });
    const debts = [
      debtOf({ id: "account:card-1", source: "card", name: "Luottokortti", accountId: "card-1", kind: "card", owedCents: 50_000, gaps: ["rate"] }),
      debtOf({ id: "loan-9", source: "card", name: "Kortti", loanId: "loan-9", accountId: "card-2", kind: "card", owedCents: 40_000, gaps: ["rate"] }),
    ];
    show([listOf(debts, 90_000, 0)], metaOf([card, { ...card, id: "card-2", name: "Toinen kortti" }]));
    fireEvent.change(await within(openRow(0)).findByLabelText(/^Korko/, {}, T), { target: { value: "19" } });
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "POST" && s.path === "/api/loans")).toBe(true), T);
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ name: "Luottokortti", kind: "card", accountId: "card-1", balanceCents: 50_000, limitCents: 200_000, rateBp: 1_900 });
    await screen.findByText(/korko 19/, {}, T);
    fireEvent.change(within(openRow(0)).getByLabelText(/^Korko/), { target: { value: "15" } });
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "PUT" && s.path === "/api/loans/loan-9")).toBe(true), T);
    expect(seen.find((s) => s.method === "PUT")!.body).toMatchObject({ kind: "card", accountId: "card-2", rateBp: 1_500 });
  });

  it("saves a proposed loan on a euribor from its margin and review day, ends with what was saved and no total, and moves on with Seuraava", async () => {
    queryClient.clear();
    const terms = { paymentCents: 31_250, dueDate: "2026-10-05", intervalMonths: 1, repayment: "annuity", reference: "euribor_12", nextReview: "2027-03-14" } as LoanTermsDebt["terms"];
    const saved = savedLoan({ id: "loan-1", lender: "Esimerkkipankki", balanceCents: 10_000_000, balanceDate: "2026-10-05", rateBp: 296, reference: "euribor_12", marginBp: 65, rateReviewDate: "2027-03-14", paymentCents: 31_250, seriesKey: "k" });
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: { euribor_12: [["2026-03-13", 2310], ["2026-09-30", 2500]] } }, "POST /api/loans": { loan: saved } });
    const debt = debtOf({ id: "proposal:k", source: "proposal", name: "Esimerkkipankki", key: "k", kind: "mortgage", monthlyCents: 31_250, latestCents: 31_250, lastDate: "2026-10-05", terms });
    const items = [listOf([debt], null, 1), { id: "m", kind: "mortgage", cents: 0 } as ReviewItem];
    const meta = metaOf([], "2026-10-12");
    const view = show(items, meta);
    const heading = () => screen.getByRole("heading", { level: 2 });
    // the review day comes from the cycle the payments step at; with it and a stored fixing the margin stands in for the rate
    expect(((await screen.findByLabelText(/^Koron tarkistuspäivä/, {}, T)) as HTMLInputElement).value).toBe("2027-03-14");
    expect(screen.queryByLabelText(/^Korko/)).toBeNull();
    // the balance is asked as of the latest payment's due day
    fireEvent.change(screen.getByLabelText("Jäljellä 5.10. (€)"), { target: { value: "100 000" } });
    fireEvent.change(screen.getByLabelText(/^Marginaali/), { target: { value: "0,65" } });
    fireEvent.click(screen.getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "POST" && s.path === "/api/loans")).toBe(true), T);
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ kind: "mortgage", reference: "euribor_12", marginBp: 65, rateReviewDate: "2027-03-14", rateBp: null, balanceCents: 10_000_000, seriesKey: "k" });
    // the saved loan's balance and its rate counted now (2,31 % on 13.3.2026 and the margin)
    await screen.findByText(/^Jäljellä 100\s000,00\s€ · korko 2,96/, {}, T);
    // the end: what was saved and how many lack a balance, no total of the page's own
    expect(totals()).toBe("Ilman saldoa 0");
    expect(screen.queryByLabelText(/^Marginaali/)).toBeNull();
    // the queue read again after the save no longer has the item: it stays until Seuraava
    view.rerender(createElement(Review, { meta, queue: { data: { items: items.slice(1) }, error: null, reload: () => {} } }));
    expect(screen.getByText(/korko 2,96/)).toBeTruthy();
    expect(heading().textContent).toContain("Kysymys 1 / 2");
    const next = screen.getByRole("button", { name: "Seuraava" });
    await waitFor(() => expect(document.activeElement).toBe(next), T);
    fireEvent.click(next);
    await waitFor(() => expect(heading().textContent).toContain("Kysymys 2 / 2"), T);
  });

  it("asks a proposed loan its kind, the rows' guess picked, and saves the kind picked with the loan; Ei ole laina keeps the series from asking", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: {} }, "POST /api/loans": { loan: savedLoan({ id: "loan-2", kind: "car", balanceCents: 200_000, paymentCents: 25_000, seriesKey: "k" }) }, "PUT /api/marks": {} });
    const debt = debtOf({ id: "proposal:k", source: "proposal", name: "Esimerkkirahoitus", key: "k", kind: "consumer", placed: false, monthlyCents: 25_000, latestCents: 25_000, lastDate: "2026-09-05" });
    show([listOf([debt, { ...debt, id: "proposal:j", key: "j", name: "Toinen rahoitus" }])]);
    const kinds = await within(openRow(0)).findByRole("group", { name: "Laji" }, T);
    expect(kinds.querySelector("button[aria-pressed='true']")!.textContent).toMatch(/^Kulutusluotto/);
    fireEvent.click([...kinds.querySelectorAll("button")].find((b) => /^Autolaina/.test(b.textContent ?? ""))!);
    fireEvent.change(await within(openRow(0)).findByLabelText(/^Jäljellä/, {}, T), { target: { value: "2 000" } });
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "POST" && s.path === "/api/loans")).toBe(true), T);
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ kind: "car", seriesKey: "k", balanceCents: 200_000 });
    expect(seen.some((s) => s.path === "/api/marks")).toBe(false);
    await screen.findByText(/^Jäljellä 2\s000,00\s€/, {}, T);
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Ei ole laina" }));
    await waitFor(() => expect(seen.some((s) => s.path === "/api/marks")).toBe(true), T);
    expect(seen.find((s) => s.path === "/api/marks")!.body).toEqual(notLoanMark({ key: "j" }));
  });

  it("gives the one connected loan account with no loan to a proposed loan only when no other row could take it", async () => {
    queryClient.clear();
    stubApi({ "GET /api/loans": { loans: [], fixings: {} } });
    const account = { id: "loan-acc", name: "Laina", type: "loan", balanceCents: -500_000, balanceAt: "2026-10-08", creditLimitCents: null };
    const debt = debtOf({ id: "proposal:k", source: "proposal", name: "Esimerkkirahoitus", key: "k", kind: "consumer", monthlyCents: 25_000, latestCents: 25_000, lastDate: "2026-09-05" });
    // two rows: each asks its own balance, empty, so one account's balance is never saved with two loans
    const two = show([listOf([debt, { ...debt, id: "proposal:j", key: "j", name: "Toinen rahoitus" }])], metaOf([account]));
    for (const n of [0, 1]) expect((await within(openRow(n)).findByLabelText<HTMLInputElement>(/^Jäljellä/, {}, T)).value).toBe("");
    two.unmount();
    // one row: the account's balance is its own, so the row does not ask it
    queryClient.clear();
    show([listOf([debt])], metaOf([account]));
    await within(openRow(0)).findByRole("button", { name: "Tallenna" }, T);
    expect(within(openRow(0)).queryByLabelText(/^Jäljellä/)).toBeNull();
  });

  it("shows the error of the other forms when the loans cannot be read", async () => {
    queryClient.clear();
    stubApi({ "GET /api/loans": failing(500, { error: "Lainoja ei voitu lukea." }) });
    show([listOf([debtOf({ id: "loan-7", source: "loan", name: "Asuntolaina", loanId: "loan-7", gaps: ["payment"] })])]);
    expect((await screen.findByRole("alert", {}, T)).textContent).toContain("Lainoja ei voitu lukea.");
  });
});

describe("a card in the list that is not connected", () => {
  const debt = debtOf({ id: "card_bill:out:chk:Esimerkkikortti", source: "card_bill", name: "Esimerkkikortti", key: "out:chk:Esimerkkikortti", kind: "card", monthlyCents: 46_000, latestCents: 46_000, lastDate: "2026-09-12" });
  const saved = (id: string, name: string): Loan => savedLoan({ id, name, kind: "card", balanceCents: 120_000, repayment: null, intervalMonths: null, paymentCents: null, limitCents: 300_000 });

  it("offers to connect the card or to enter what it owes, and the second opens the loan form asking the balance", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: {} } });
    show([listOf([debt])]);
    expect((await screen.findByRole("link", { name: "Yhdistä kortti" }, T)).getAttribute("href")).toContain("settings/banks");
    expect(screen.queryByRole("button", { name: "Kortti on jo kirjattu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kirjaa kortin velka" }));
    await screen.findByLabelText(/^Jäljellä/, {}, T);
    // nothing is saved until the form is
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /api/loans"]);
  });

  it("links the one saved card to the series of its bills, writes no mark, and links to the saved card", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [saved("l1", "Esimerkkikortti")], fixings: {} }, "PUT /api/loans/l1": { loan: saved("l1", "Esimerkkikortti") } });
    let reloads = 0;
    show([listOf([{ ...debt, savedCards: [{ id: "l1", name: "Esimerkkikortti" }] }])], metaOf(), () => void reloads++);
    expect((await screen.findByRole("link", { name: "Avaa kirjattu kortti" }, T)).getAttribute("href")).toContain("linkLoan=l1");
    fireEvent.click(screen.getByRole("button", { name: "Kortti on jo kirjattu" }));
    await waitFor(() => expect(reloads).toBe(1), T);
    const put = seen.find((s) => s.method === "PUT" && s.path === "/api/loans/l1")!;
    expect(put.body).toMatchObject({ name: "Esimerkkikortti", kind: "card", balanceCents: 120_000, limitCents: 300_000, seriesKey: debt.key });
    expect(seen.some((s) => s.path === "/api/marks")).toBe(false);
  });

  it("asks which saved card it is when there are several, and links the one picked", async () => {
    queryClient.clear();
    const loans = [saved("l1", "Esimerkkikortti"), saved("l2", "Toinen kortti")];
    const seen = stubApi({ "GET /api/loans": { loans, fixings: {} }, "PUT /api/loans/l2": { loan: loans[1] } });
    let reloads = 0;
    show([listOf([{ ...debt, savedCards: loans.map((l) => ({ id: l.id, name: l.name })) }])], metaOf(), () => void reloads++);
    fireEvent.click(await screen.findByRole("button", { name: "Kortti on jo kirjattu" }, T));
    expect(screen.queryByRole("link", { name: "Avaa kirjattu kortti" })).toBeNull();
    expect(seen.filter((s) => s.method !== "GET")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Toinen kortti" }));
    await waitFor(() => expect(reloads).toBe(1), T);
    expect(seen.find((s) => s.method === "PUT")!.body).toMatchObject({ name: "Toinen kortti", seriesKey: debt.key });
  });
});

describe("a plan in the list", () => {
  it("saves the end of an instalment plan as the mark of its series and closes the row into its last month", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: {} }, "PUT /api/marks": {} });
    show([listOf([debtOf({ id: "plan:k", source: "plan", name: "Esimerkkiosamaksu", key: "k", kind: "instalment", monthlyCents: 4_990, latestCents: 4_990, lastDate: "2026-09-12" })])]);
    fireEvent.change(await screen.findByLabelText("Maksuja jäljellä", {}, T), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.path === "/api/marks")).toBe(true), T);
    expect(seen.find((s) => s.path === "/api/marks")!.body).toMatchObject({ mark: "in_use" });
    await screen.findByText(/^viimeinen erä/, {}, T);
  });
});
