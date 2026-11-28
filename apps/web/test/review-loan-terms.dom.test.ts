/**
 * Täydennä lainat in Tarkistettavat: one item lists every debt that lacks a balance or a payment, one row each.
 * A row asks one thing of its debt (a loan the rows show: what it owes now; a card: whether it is paid in full each
 * month) and closes into its result line once saved; the queue is read again so the totals are the server's, and
 * Seuraava moves on after the last row. Made-up lenders, cards and sums.
 */
import { type Loan, loanUnknownSubject, notLoanMark } from "@banking/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { queryClient } from "../src/query-client.ts";
import { CONNECT_BANK_HASH, loanEditHash, SETTINGS_ANCHOR, settingsCardHash } from "../src/routes.ts";
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
// the server sends a question a debt; the rows of these tests may hold several, as the page still draws a list
const fromRowsOf = (debts: LoanTermsDebt[]) => debts.filter((d) => d.source === "proposal" || d.source === "ended" || d.source === "card_bill" || (d.source === "card_gap" && d.accountId === null)).length;
const listOf = (debts: LoanTermsDebt[], debtsCents: number | null = null, noBalance = 0) => ({ kind: "loan_terms_list", id: `loan-terms:${debts[0]?.id ?? "none"}`, cents: 0, debts, debtsCents, noBalance, fromRows: fromRowsOf(debts) }) as unknown as ReviewItem;
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
      debtOf({ id: "loan-8", source: "loan", name: "Autolaina", loanId: "loan-8", kind: "car", owedCents: 1_200_000, gaps: ["payment"] }),
    ];
    show([listOf(debts, null, 1)]);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Kerro lainan saldo");
    const names = [...document.querySelectorAll(".review-debt-name")].map((h) => plain(h.textContent));
    // a loan the rows show reads payee, the kind guessed and the monthly payment
    expect(names).toEqual([plain("Esimerkkipankki · Asuntolaina · 861,41 €/kk"), plain("Autolaina · Jäljellä 12 000,00 €")]);
    // the total is unknown while a debt has no balance: a dash, never a sum the page adds itself
    expect(totals()).toBe(plain("Velat yhteensä, tiedossa –Ilman saldoa 1"));
  });

  it("words the total as the front page does: known only while a debt has no balance", () => {
    queryClient.clear();
    stubApi({ "GET /api/loans": { loans: [], fixings: {} } });
    const debts = [debtOf({ id: "loan-8", source: "loan", name: "Autolaina", loanId: "loan-8", kind: "car", owedCents: 1_200_000, gaps: ["payment"] })];
    const view = show([listOf(debts, 12_000_000, 1)]);
    expect(totals()).toBe(plain("Velat yhteensä, tiedossa 120 000,00 €Ilman saldoa 1"));
    view.rerender(createElement(Review, { meta: metaOf(), queue: { data: { items: [listOf(debts, 12_000_000, 0)] }, error: null, reload: () => {} } }));
    expect(totals()).toBe(plain("Velat yhteensä 120 000,00 €Ilman saldoa 0"));
  });

  it("asks a saved loan only the fact it lacks, saves the loan's own form, closes the row into its result line and reads the queue again", async () => {
    queryClient.clear();
    const loan = savedLoan({ rateBp: 350, paymentCents: null });
    const other = savedLoan({ id: "loan-8", name: "Toinen laina" });
    const seen = stubApi({ "GET /api/loans": { loans: [other, loan], fixings: {} }, "PUT /api/loans/loan-7": { loan: { ...loan, paymentCents: 90_000 } } });
    let reloads = 0;
    const debts = [
      debtOf({ id: "loan-7", source: "loan", name: "Asuntolaina", loanId: "loan-7", kind: "mortgage", owedCents: 15_000_000, gaps: ["payment"], subject: "question:loan-terms:loan-7" }),
      debtOf({ id: "loan-8", source: "loan", name: "Toinen laina", loanId: "loan-8", kind: "mortgage", gaps: ["end_date"], subject: "question:loan-terms:loan-8" }),
    ];
    const view = show([listOf(debts, 30_000_000, 0)], metaOf(), () => void reloads++);
    const payment = await within(openRow(0)).findByLabelText(/^Kuukausierä/, {}, T);
    // the missing fact alone is asked, never the rate, whose gap lists no saved loan; the rest of the form is behind one button
    expect(screen.queryAllByLabelText(/^Korko/)).toHaveLength(0);
    expect(screen.queryAllByLabelText("Nimi")).toHaveLength(0);
    expect(within(openRow(1)).getByLabelText(/^Viimeinen eräpäivä/)).toBeTruthy();
    // the payment keeps asking: no dismissal on that row, one on the row that lacks its end
    expect(within(openRow(0)).queryByRole("button", { name: "Älä muistuta tästä enää" })).toBeNull();
    expect(within(openRow(1)).getByRole("button", { name: "Älä muistuta tästä enää" })).toBeTruthy();
    fireEvent.change(payment, { target: { value: "900" } });
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "PUT" && s.path === "/api/loans/loan-7")).toBe(true), T);
    expect(seen.find((s) => s.method === "PUT")!.body).toMatchObject({ name: "Asuntolaina", rateBp: 350, paymentCents: 90_000 });
    const line = await screen.findByText(/^Jäljellä [^·]+ · korko 3,5/, {}, T);
    expect(reloads).toBe(1);
    // the focus moves from the form that is gone to the line it closed into
    await waitFor(() => expect(document.activeElement).toBe(line), T);
    // the question that was answered stays as it was asked, though the queue read again has the other debt's question only
    view.rerender(createElement(Review, { meta: metaOf(), queue: { data: { items: [listOf(debts.slice(1), 31_000_000, 0)] }, error: null, reload: () => {} } }));
    expect(totals()).toBe(plain("Velat yhteensä 300 000,00 €Ilman saldoa 0"));
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
    await screen.findByText("Ei muistutuksia", {}, T);
  });

  it("asks a connected card only whether it is paid in full: yes saves a rate of 0 as a new loan linked to it, no asks the rate alone and saves the card's loan", async () => {
    queryClient.clear();
    const card = { id: "card-1", name: "Luottokortti", type: "credit_card", balanceCents: -50_000, balanceAt: "2026-10-08", creditLimitCents: 200_000 };
    const linked = { ...savedLoan({ id: "loan-9", name: "Kortti", kind: "card", balanceCents: 40_000, repayment: null, intervalMonths: null, paymentCents: null, limitCents: 200_000 }), accountId: "card-2" };
    const seen = stubApi({ "GET /api/loans": { loans: [linked], fixings: {} }, "POST /api/loans": { loan: { ...linked, id: "loan-10", accountId: "card-1", rateBp: 0 } }, "PUT /api/loans/loan-9": { loan: { ...linked, rateBp: 1_500 } } });
    const debts = [
      debtOf({ id: "account:card-1", source: "card", name: "Luottokortti", accountId: "card-1", kind: "card", owedCents: 50_000, gaps: ["rate"] }),
      debtOf({ id: "loan-9", source: "card", name: "Kortti", loanId: "loan-9", accountId: "card-2", kind: "card", owedCents: 40_000, gaps: ["rate"] }),
    ];
    show([listOf(debts, 90_000, 0)], metaOf([card, { ...card, id: "card-2", name: "Toinen kortti" }]));
    expect(await within(openRow(0)).findByText("Maksetaanko kortti kokonaan joka kuukausi?", {}, T)).toBeTruthy();
    // neither the rate nor the reference rate nor the margin is asked before the answer
    expect(screen.queryAllByLabelText(/^Korko|^Marginaali|^Viitekorko|^Luottoraja/)).toHaveLength(0);
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Kyllä" }));
    await waitFor(() => expect(seen.some((s) => s.method === "POST" && s.path === "/api/loans")).toBe(true), T);
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ name: "Luottokortti", kind: "card", accountId: "card-1", balanceCents: 50_000, limitCents: 200_000, rateBp: 0 });
    await screen.findByText(/korko 0/, {}, T);
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Ei" }));
    // the rate is the one field of a card not paid in full
    expect(screen.queryAllByLabelText(/^Marginaali|^Viitekorko|^Luottoraja/)).toHaveLength(0);
    fireEvent.change(within(openRow(0)).getByLabelText("Korko (%)"), { target: { value: "15" } });
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "PUT" && s.path === "/api/loans/loan-9")).toBe(true), T);
    expect(seen.find((s) => s.method === "PUT")!.body).toMatchObject({ kind: "card", accountId: "card-2", rateBp: 1_500 });
  });

  it("saves a proposed loan on a euribor asking only its balance, ends with what was saved and no total, and moves on with Seuraava", async () => {
    queryClient.clear();
    const terms = { paymentCents: 31_250, dueDate: "2026-10-05", intervalMonths: 1, repayment: "annuity", reference: "euribor_12", nextReview: "2027-03-14" } as LoanTermsDebt["terms"];
    const saved = savedLoan({ id: "loan-1", lender: "Esimerkkipankki", balanceCents: 10_000_000, balanceDate: "2026-10-05", rateBp: 296, reference: "euribor_12", marginBp: 65, rateReviewDate: "2027-03-14", paymentCents: 31_250, seriesKey: "k" });
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: { euribor_12: [["2026-03-13", 2310], ["2026-09-30", 2500]] } }, "POST /api/loans": { loan: saved } });
    const debt = debtOf({ id: "proposal:k", source: "proposal", name: "Esimerkkipankki", key: "k", kind: "mortgage", monthlyCents: 31_250, latestCents: 31_250, lastDate: "2026-10-05", terms });
    const items = [listOf([debt], null, 1), { id: "m", kind: "mortgage", cents: 0 } as ReviewItem];
    const meta = metaOf([], "2026-10-12");
    const view = show(items, meta);
    const heading = () => screen.getByRole("heading", { level: 2 });
    fireEvent.change(await screen.findByLabelText("Jäljellä nyt (€)", {}, T), { target: { value: "100 000" } });
    // the rate, the reference rate, the margin and the review day are edited at the loan, not asked here
    expect(screen.queryAllByLabelText(/^Korko|^Marginaali|^Viitekorko|^Koron tarkistuspäivä/)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "En tiedä" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ei ole velan maksu" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "POST" && s.path === "/api/loans")).toBe(true), T);
    // what the rows tell of its terms is saved with it: the reference rate and the cycle's review day
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ kind: "mortgage", reference: "euribor_12", marginBp: null, rateReviewDate: "2027-03-14", rateBp: null, balanceCents: 10_000_000, balanceDate: "2026-10-12", seriesKey: "k" });
    // the saved loan's balance and its rate counted now (2,31 % on 13.3.2026 and the margin)
    await screen.findByText(/^Jäljellä 100\s000,00\s€ · korko 2,96/, {}, T);
    // the end: this debt is answered and the list's figures are not shown, as other debts may still lack a balance
    expect(totals()).toBe("");
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

  it("asks a proposed loan only what it owes now, with the kind the rows guess in its heading, and saves the loan with that kind; En tiedä and Ei ole velan maksu answer through marks", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: {} }, "POST /api/loans": { loan: savedLoan({ id: "loan-2", kind: "consumer", balanceCents: 200_000, paymentCents: 25_000, seriesKey: "k" }) }, "PUT /api/marks": {} });
    const debt = debtOf({ id: "proposal:k", source: "proposal", name: "Esimerkkirahoitus", key: "k", kind: "consumer", placed: false, monthlyCents: 25_000, latestCents: 25_000, lastDate: "2026-09-05" });
    show([listOf([debt, { ...debt, id: "proposal:j", key: "j", name: "Toinen rahoitus" }, { ...debt, id: "proposal:i", key: "i", name: "Kolmas rahoitus" }])]);
    const field = await within(openRow(0)).findByLabelText("Jäljellä nyt (€)", {}, T);
    // the kind is the guess, read from the heading and changed at the loan's home: it is not asked
    expect(within(openRow(0)).queryByRole("group", { name: "Laji" })).toBeNull();
    expect(plain(openRow(0).querySelector(".review-debt-name")!.textContent)).toBe(plain("Esimerkkirahoitus · Kulutusluotto · 250,00 €/kk"));
    expect(within(openRow(0)).queryAllByLabelText(/^Korko|^Maksuerä|^Kuukausierä|^Alkuperäinen/)).toHaveLength(0);
    fireEvent.change(field, { target: { value: "2 000" } });
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "POST" && s.path === "/api/loans")).toBe(true), T);
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ kind: "consumer", seriesKey: "k", balanceCents: 200_000, paymentCents: 25_000 });
    expect(seen.some((s) => s.path === "/api/marks")).toBe(false);
    await screen.findByText(/^Jäljellä 2\s000,00\s€/, {}, T);
    // En tiedä holds while the monthly payment stays what it was said at
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "En tiedä" }));
    await waitFor(() => expect(seen.some((s) => s.path === "/api/marks")).toBe(true), T);
    expect(seen.find((s) => s.path === "/api/marks")!.body).toEqual({ subject: loanUnknownSubject(25_000, "j"), mark: "in_use" });
    await screen.findByText("En tiedä", { selector: ".review-debt-result" }, T);
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Ei ole velan maksu" }));
    await waitFor(() => expect(seen.filter((s) => s.path === "/api/marks")).toHaveLength(2), T);
    expect(seen.filter((s) => s.path === "/api/marks")[1]!.body).toEqual(notLoanMark({ key: "i" }));
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
    // one row: the account's balance is its own, told in the field for the household to confirm
    queryClient.clear();
    show([listOf([debt])], metaOf([account]));
    expect((await within(openRow(0)).findByLabelText<HTMLInputElement>(/^Jäljellä/, {}, T)).value).toMatch(/^5\D?000/);
  });

  it("saves only the loan whose balance is filled in the form of several, and leaves the other asked", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: {} }, "POST /api/loans": { loan: savedLoan({ id: "loan-4", name: "Esimerkkirahoitus", kind: "consumer", balanceCents: 200_000, seriesKey: "k" }) } });
    const debt = debtOf({ id: "proposal:k", source: "proposal", name: "Esimerkkirahoitus", key: "k", kind: "consumer", monthlyCents: 25_000, latestCents: 25_000, lastDate: "2026-09-05" });
    show([{ ...listOf([debt, { ...debt, id: "proposal:j", key: "j", name: "Toinen rahoitus" }]), id: "loan-terms:balances" } as ReviewItem]);
    fireEvent.change(await within(openRow(0)).findByLabelText(/^Jäljellä/, {}, T), { target: { value: "2 000" } });
    fireEvent.click(screen.getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(document.querySelectorAll("li.review-debt.is-done")).toHaveLength(1), T);
    expect(seen.filter((s) => s.method === "POST")).toHaveLength(1);
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ seriesKey: "k", balanceCents: 200_000 });
    // the loan left empty is not closed into a result line and is not saved
    expect(openRow(0).textContent).toContain("Toinen rahoitus");
  });

  it("does not save a loan again when the form is pressed after another loan failed, and shows the error at the failed loan", async () => {
    queryClient.clear();
    let posts = 0;
    const seen = stubApi({
      "GET /api/loans": { loans: [], fixings: {} },
      "POST /api/loans": () => (++posts === 2 ? failing(500, { error: "Lainaa ei voitu tallentaa." }) : { loan: savedLoan({ id: `loan-${posts}`, kind: "consumer", balanceCents: 200_000 }) }),
    });
    const debt = debtOf({ id: "proposal:k", source: "proposal", name: "Esimerkkirahoitus", key: "k", kind: "consumer", monthlyCents: 25_000, latestCents: 25_000, lastDate: "2026-09-05" });
    show([{ ...listOf([debt, { ...debt, id: "proposal:j", key: "j", name: "Toinen rahoitus" }]), id: "loan-terms:balances" } as ReviewItem]);
    for (const n of [0, 1]) fireEvent.change(await within(openRow(n)).findByLabelText(/^Jäljellä/, {}, T), { target: { value: "2 000" } });
    fireEvent.click(screen.getByRole("button", { name: "Tallenna" }));
    await within(openRow(0)).findByText("Lainaa ei voitu tallentaa.", {}, T);
    expect(document.querySelectorAll("li.review-debt.is-done")).toHaveLength(1);
    expect(openRow(0).textContent).toContain("Toinen rahoitus");
    fireEvent.click(screen.getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(document.querySelectorAll("li.review-debt.is-done")).toHaveLength(2), T);
    expect(seen.filter((s) => s.method === "POST").map((s) => (s.body as { seriesKey: string }).seriesKey)).toEqual(["k", "j", "j"]);
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

  it("offers to connect the card, add what it owes or its statement, or En tiedä, and adding the debt opens the loan form asking the balance", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: {} } });
    show([listOf([debt])]);
    expect((await screen.findByRole("link", { name: "Yhdistä kortti" }, T)).getAttribute("href")).toContain("settings/banks");
    expect(screen.getByRole("link", { name: "Lisää tiliote" }).getAttribute("href")).toBe(settingsCardHash(SETTINGS_ANCHOR.statement));
    expect(within(openRow(0)).getByRole("button", { name: "En tiedä" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kortti on jo kirjattu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lisää kortin velka" }));
    await screen.findByLabelText(/^Jäljellä/, {}, T);
    // nothing is saved until the form is
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /api/loans"]);
  });

  it("links the one saved card to the series of its bills, writes no mark, and links to the saved card", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [saved("l1", "Esimerkkikortti")], fixings: {} }, "PUT /api/loans/l1": { loan: saved("l1", "Esimerkkikortti") } });
    let reloads = 0;
    show([listOf([{ ...debt, savedCards: [{ id: "l1", name: "Esimerkkikortti" }] }])], metaOf(), () => void reloads++);
    expect((await screen.findByRole("link", { name: "Avaa kirjattu kortti" }, T)).getAttribute("href")).toBe(loanEditHash("l1"));
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

  it("sets the card aside with En tiedä at its monthly bill", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: {} }, "PUT /api/marks": {} });
    show([listOf([debt])]);
    fireEvent.click(await within(openRow(0)).findByRole("button", { name: "En tiedä" }, T));
    await waitFor(() => expect(seen.some((s) => s.path === "/api/marks")).toBe(true), T);
    expect(seen.find((s) => s.path === "/api/marks")!.body).toEqual({ subject: loanUnknownSubject(46_000, debt.key!), mark: "in_use" });
  });
});

describe("a card whose purchases are missing in the list", () => {
  const loose = debtOf({ id: "card_gap:out:chk:Toinenkortti", source: "card_gap", name: "Toinenkortti", key: "out:chk:Toinenkortti", kind: "card", lastDate: "2026-08-12", missing: { cents: 30_000, since: null } });
  const connected = debtOf({ id: "card_gap:out:kortti:kortti", source: "card_gap", name: "Kolmaspankki Gold", key: "out:kortti:kortti", accountId: "kortti", kind: "card", missing: { cents: null, since: "2026-06-01" } });
  const answers = (row: HTMLElement) => [...row.querySelectorAll(".review-choices > a, .review-choices > button")].map((a) => plain(a.textContent).trim());

  it("offers the four answers of a card that is not connected, headed by the sum of its bills and no due day", async () => {
    queryClient.clear();
    stubApi({ "GET /api/loans": { loans: [], fixings: {} } });
    show([listOf([loose])]);
    expect((await screen.findByRole("link", { name: "Yhdistä kortti" }, T)).getAttribute("href")).toBe(CONNECT_BANK_HASH);
    expect(answers(openRow(0))).toEqual(["Yhdistä kortti", "Lisää kortin velka", "Lisää tiliote", "En tiedä"]);
    expect(plain(openRow(0).querySelector(".review-debt-name")!.textContent)).toMatch(/^Toinenkortti · laskut 12 kuukaudelta 300,00 €$/);
  });

  it("offers a connected card only its statement and En tiedä, and says no sum it does not know", async () => {
    // the day of metaOf, so the date of this year is written without its year
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-09T12:00:00") });
    onTestFinished(() => void vi.useRealTimers());
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: {} }, "PUT /api/marks": {} });
    show([listOf([connected])]);
    await screen.findByRole("link", { name: "Lisää tiliote" }, T);
    expect(answers(openRow(0))).toEqual(["Lisää tiliote", "En tiedä"]);
    const heading = plain(openRow(0).querySelector(".review-debt-name")!.textContent);
    expect(heading).toBe("Kolmaspankki Gold · ostot 1.6. alkaen");
    expect(heading).not.toMatch(/0,00|laskut|eräpäivä/);
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "En tiedä" }));
    await waitFor(() => expect(seen.some((s) => s.path === "/api/marks")).toBe(true), T);
    expect(seen.find((s) => s.path === "/api/marks")!.body).toEqual({ subject: loanUnknownSubject(null, connected.key!), mark: "in_use" });
  });
});

describe("a credit of unknown kind in the list", () => {
  const debt = debtOf({ id: "proposal:out:chk:Esimerkkipankki", source: "proposal", name: "Esimerkkipankki", key: "out:chk:Esimerkkipankki", kind: "consumer", placed: false, kindUnknown: true, monthlyCents: 33_000, latestCents: 41_000, lastDate: "2026-09-12" });
  const kindButtons = (group: HTMLElement) => [...group.querySelectorAll("button")].map((b) => plain(b.textContent).trim());

  it("asks card, credit line or consumer credit with none picked and no guess, then only the balance of the kind picked, with no credit limit", async () => {
    queryClient.clear();
    const credit = savedLoan({ id: "loan-3", name: "Esimerkkipankki", kind: "credit_line", balanceCents: 240_000, repayment: null, intervalMonths: null, paymentCents: null, limitCents: 500_000, seriesKey: debt.key });
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: {} }, "POST /api/loans": { loan: credit } });
    show([listOf([debt])]);
    const kinds = await within(openRow(0)).findByRole("group", { name: "Laji" }, T);
    expect(kindButtons(kinds)).toEqual(["Luottokortti", "Joustoluotto", "Kulutusluotto"]);
    expect(kinds.querySelector("button[aria-pressed='true']")).toBeNull();
    expect(openRow(0).textContent).not.toContain("Ehdotus");
    // nothing to fill in until the kind is told; the two other answers are there
    expect(within(openRow(0)).queryByLabelText(/^Jäljellä/)).toBeNull();
    expect(within(openRow(0)).queryByRole("button", { name: "Tallenna" })).toBeNull();
    expect(within(openRow(0)).getByRole("button", { name: "En tiedä" })).toBeTruthy();
    expect(within(openRow(0)).getByRole("button", { name: "Ei ole velan maksu" })).toBeTruthy();
    fireEvent.click(within(kinds).getByRole("button", { name: "Joustoluotto" }));
    expect(kinds.querySelector("button[aria-pressed='true']")!.textContent).toMatch(/^Joustoluotto/);
    fireEvent.change(await within(openRow(0)).findByLabelText(/^Jäljellä/, {}, T), { target: { value: "2 400" } });
    // a credit line asks no credit limit
    expect(within(openRow(0)).queryAllByLabelText(/^Luottoraja/)).toHaveLength(0);
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "POST" && s.path === "/api/loans")).toBe(true), T);
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ kind: "credit_line", seriesKey: debt.key, balanceCents: 240_000, limitCents: null });
    expect(seen.some((s) => s.path === "/api/marks")).toBe(false);
  });

  it("a card picked asks the balance alone, and Ei ole velan maksu marks the series", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [], fixings: {} }, "PUT /api/marks": {} });
    show([listOf([debt])]);
    const kinds = await within(openRow(0)).findByRole("group", { name: "Laji" }, T);
    fireEvent.click(within(kinds).getByRole("button", { name: "Luottokortti" }));
    await within(openRow(0)).findByLabelText(/^Jäljellä/, {}, T);
    expect(within(openRow(0)).queryAllByLabelText(/^Luottoraja/)).toHaveLength(0);
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Ei ole velan maksu" }));
    await waitFor(() => expect(seen.some((s) => s.path === "/api/marks")).toBe(true), T);
    expect(seen.find((s) => s.path === "/api/marks")!.body).toEqual(notLoanMark({ key: debt.key! }));
  });

  it("links a credit saved with no link to the series, in words that fit a card, a credit line and a loan alike", async () => {
    queryClient.clear();
    const credit = savedLoan({ id: "l1", name: "Esimerkkiluotto", kind: "credit_line", balanceCents: 240_000, repayment: null, intervalMonths: null, paymentCents: null, limitCents: 500_000 });
    const seen = stubApi({ "GET /api/loans": { loans: [credit], fixings: {} }, "PUT /api/loans/l1": { loan: { ...credit, seriesKey: debt.key } } });
    let reloads = 0;
    show([listOf([{ ...debt, savedCards: [{ id: "l1", name: "Esimerkkiluotto" }] }])], metaOf(), () => void reloads++);
    expect((await screen.findByRole("link", { name: "Avaa kirjattu luotto" }, T)).getAttribute("href")).toBe(loanEditHash("l1"));
    expect(openRow(0).textContent).not.toMatch(/Kortti on jo|kirjattu kortti/);
    fireEvent.click(screen.getByRole("button", { name: "Luotto on jo kirjattu" }));
    await waitFor(() => expect(reloads).toBe(1), T);
    expect(seen.find((s) => s.method === "PUT" && s.path === "/api/loans/l1")!.body).toMatchObject({ name: "Esimerkkiluotto", kind: "credit_line", seriesKey: debt.key });
    expect(seen.some((s) => s.path === "/api/marks")).toBe(false);
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

describe("the fee of a plan at 0 %", () => {
  const free = savedLoan({ id: "loan-5", name: "Osamaksu", kind: "instalment", balanceCents: 60_000, rateBp: 0, repayment: "fixed_instalment", paymentCents: 5_000 });
  const row = debtOf({ id: "loan-5", source: "loan", name: "Osamaksu", loanId: "loan-5", kind: "instalment", owedCents: 60_000, gaps: ["fee"], subject: "question:loan-terms:loan-5" });

  it("asks the fee of each payment alone, with a 0 € answer and no dismissal, and saves a fee of nothing in one tap", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [free], fixings: {} }, "PUT /api/loans/loan-5": { loan: { ...free, paymentFeeCents: 0 } } });
    show([listOf([row])]);
    expect(await within(openRow(0)).findByLabelText("Kulu erää kohden (€)", {}, T)).toBeTruthy();
    expect(within(openRow(0)).queryByLabelText(/^Korko/)).toBeNull();
    expect(within(openRow(0)).queryByRole("button", { name: "Älä muistuta tästä enää" })).toBeNull();
    fireEvent.click(within(openRow(0)).getByRole("button", { name: /^0\s€$/ }));
    await waitFor(() => expect(seen.some((s) => s.method === "PUT" && s.path === "/api/loans/loan-5")).toBe(true), T);
    expect(seen.find((s) => s.method === "PUT")!.body).toMatchObject({ name: "Osamaksu", rateBp: 0, paymentFeeCents: 0 });
    await screen.findByText(/kulu erää kohden 0,00/, {}, T);
  });

  it("saves the fee typed and closes the row into it", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [free], fixings: {} }, "PUT /api/loans/loan-5": { loan: { ...free, paymentFeeCents: 395 } } });
    show([listOf([row])]);
    fireEvent.change(await within(openRow(0)).findByLabelText("Kulu erää kohden (€)", {}, T), { target: { value: "3,95" } });
    fireEvent.click(within(openRow(0)).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "PUT")).toBe(true), T);
    expect(seen.find((s) => s.method === "PUT")!.body).toMatchObject({ paymentFeeCents: 395 });
    await screen.findByText(/kulu erää kohden 3,95/, {}, T);
  });
});
