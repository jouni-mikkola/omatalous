/**
 * The drill of a loan in Raportit > Lainat: what is left, the rate, and the one line a new payment or an extra repayment
 * answers with. Every expected figure is counted by hand in cents from the loan's own terms. Loans are made up.
 */
import type { Loan, LoanRow, LoansReport } from "@banking/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { LoanDrill, PlanDrill } from "../src/components/loans/LoanDrill.tsx";
import { PageAddressContext } from "../src/page-address.ts";
import { section as loansSection } from "../src/pages/reports/sections/Loans.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import { queryClient } from "../src/query-client.ts";
import { DRILL_PARAM, tableId, writeTableState } from "../src/table-state.ts";
import { t } from "../src/text.ts";
import { stubApi } from "./dom-kit.ts";

const START = "2026-01-15";
/** A loan with a balance and its terms: each test adds what its plan needs. */
const loan = (over: Partial<Loan> = {}): Loan => ({
  id: "l1", name: "Laina", lender: null, kind: "consumer", grantedCents: null, balanceCents: 100_000, balanceDate: START, rateBp: null, reference: null, marginBp: null,
  repayment: null, intervalMonths: 1, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, ...over,
});
/** 1 200 € at 6 %, 300 € of principal a month: five months of interest 6 + 4,50 + 3 + 1,50 = 15 €, the last payment on 15 May. */
const EQUAL = loan({ balanceCents: 120_000, rateBp: 600, repayment: "equal_principal", paymentCents: 30_000 });
/** 1 000 € at 18 % on a card, 50 € a month: 24 payments, 197,84 € of interest, the last payment on 15 January 2028. */
const CARD = loan({ kind: "card", rateBp: 1800, paymentCents: 5000 });
/** 1 000 € at 12 % over twelve months, the payment 88,85 €: 66,19 € of interest. */
const ANNUITY = loan({ rateBp: 1200, repayment: "annuity", paymentCents: 8885, endDate: "2027-01-15" });

beforeEach(() => queryClient.clear());

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");

async function open(l: Loan, today = START, fixings: object = {}) {
  stubApi({ "GET /api/loans": { loans: [l], fixings } });
  render(createElement(LoanDrill, { l: { id: l.id, cost: null } as LoanRow, today, whatIf: true }));
  await screen.findByText("Jäljellä");
}
const figures = () => [...document.querySelectorAll(".loan-figures > div")].map((d) => `${flat(d.querySelector("dt")?.textContent)} ${flat(d.querySelector("dd")?.textContent)}`);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const result = () => flat(screen.getByRole("status").textContent);

describe("the drill of a loan", () => {
  it("shows what is left of an equal principal loan and its rate, and no answer before an input is typed", async () => {
    await open(EQUAL);
    expect(figures()).toEqual(["Jäljellä 1 200,00 €", "Eriä jäljellä 4", "Korkoja jäljellä 15,00 €", "Viimeinen erä 15.5.", "Korko 6,000 %"]);
    // the line is there from the start, empty, so a reader of the screen hears it change
    expect(result()).toBe("");
    // the input is the principal, so it does not share a name with a payment
    expect((screen.getByLabelText("Kuukausilyhennys") as HTMLInputElement).placeholder).toBe("300,00");
    expect(screen.queryByLabelText("Kuukausierä")).toBeNull();
  });

  it("names the reference rate, the margin and the next review in the rate line", async () => {
    // 4 % typed on 5 March 2026; the 12-month Euribor of 5 March 2027 is 3,328 % and the margin 0,65 %
    const euribor = loan({ balanceCents: 1_000_000, balanceDate: "2026-03-05", reference: "euribor_12", rateBp: 400, marginBp: 65, rateReviewDate: "2026-03-05", repayment: "annuity", paymentCents: 20_000, endDate: "2031-03-05" });
    await open(euribor, "2027-03-10", { euribor_12: [["2026-03-05", 3500], ["2027-03-05", 3328]] });
    expect(figures().at(-1)).toBe("Korko 3,978 % = 12 kk euribor 3,328 % + 0,650 %, tarkistus 5.3.2028");
  });

  it("answers a higher payment in one line: the end, the months sooner and the interest saved", async () => {
    await open(EQUAL);
    // 600 € of principal a month: interest 6 + 3 = 9 € against 15 €, the last payment on 15 March
    type("Kuukausilyhennys", "600");
    expect(result()).toBe("Päättyy 3/2026 (2 kk aiemmin) · korkoja 6 € vähemmän");
  });

  it("answers an extra repayment: 300 € off at once leaves interest of 4,50 + 3 + 1,50 = 9 €", async () => {
    await open(EQUAL);
    type("Kertalyhennys", "300");
    expect(result()).toBe("Päättyy 4/2026 (1 kk aiemmin) · korkoja 6 € vähemmän");
  });

  it("holds a payment to ten times the plan's and an extra repayment to the balance", async () => {
    await open(EQUAL);
    type("Kuukausilyhennys", "999999");
    fireEvent.blur(screen.getByLabelText("Kuukausilyhennys"));
    // 3 000 € clears 1 200 € in the first payment: interest 6 € against 15 €, the last payment on 15 February
    expect(flat((screen.getByLabelText("Kuukausilyhennys") as HTMLInputElement).value)).toBe("3 000,00");
    expect(result()).toBe("Päättyy 2/2026 (3 kk aiemmin) · korkoja 9 € vähemmän");
    type("Kuukausilyhennys", "");
    type("Kertalyhennys", "5000");
    fireEvent.blur(screen.getByLabelText("Kertalyhennys"));
    expect(flat((screen.getByLabelText("Kertalyhennys") as HTMLInputElement).value)).toBe("1 200,00");
    // the whole balance at once ends the loan this month and saves all its interest
    expect(result()).toBe("Päättyy 1/2026 · korkoja 15 € vähemmän");
  });

  it("adds the lower payment with the same last day for an annuity with an extra repayment", async () => {
    await open(ANNUITY);
    // 800 € left over twelve payments at 1 % a month: 71,08 €; the payment kept ends after ten (66,19 € - 42,64 € = 23,55 € of interest saved)
    type("Kertalyhennys", "200");
    expect(result()).toBe("Päättyy 11/2026 (2 kk aiemmin) · korkoja 24 € vähemmän · tai erä 71,08 €/kk samalla loppupäivällä");
    // a payment alone has no lower payment to offer
    type("Kertalyhennys", "");
    type("Kuukausierä", "100");
    expect(result()).not.toContain("tai erä");
  });

  it("counts a card's payment each month on the balance", async () => {
    await open(CARD);
    expect(figures()).toEqual(["Jäljellä 1 000,00 €", "Eriä jäljellä 24", "Korkoja jäljellä 197,84 €", "Viimeinen erä 15.1.2028", "Korko 18,000 %"]);
    // 100 € a month: 11 payments, 91,62 € of interest, 106,22 € less
    type("Kuukausierä", "100");
    expect(result()).toBe("Päättyy 12/2026 (1 v 1 kk aiemmin) · korkoja 106 € vähemmän");
  });

  it("takes what is owed from the plan: a card typed at 1 000 € on 15 January owes 819,67 € on 15 June", async () => {
    // 1,5 % a month on the balance, 50 € paid in each of five months: interest 15,00 + 14,48 + 13,94 + 13,40 + 12,85 = 69,67 €, so 1 000 - 250 + 69,67 = 819,67 € owed
    await open(CARD, "2026-06-15");
    expect(figures()).toEqual(["Jäljellä 819,67 €", "Eriä jäljellä 19", "Korkoja jäljellä 128,17 €", "Viimeinen erä 15.1.2028", "Korko 18,000 %"]);
    // 100 € a month from here: 9 payments, 61,60 € of interest against 128,17 €
    type("Kuukausierä", "100");
    expect(result()).toBe("Päättyy 3/2027 (10 kk aiemmin) · korkoja 67 € vähemmän");
    type("Kuukausierä", "");
    // 900 € is more than is owed: it is held to 819,67 € and pays the card off in June
    type("Kertalyhennys", "900");
    fireEvent.blur(screen.getByLabelText("Kertalyhennys"));
    expect(flat((screen.getByLabelText("Kertalyhennys") as HTMLInputElement).value)).toBe("819,67");
    expect(result()).toBe("Päättyy 6/2026 · korkoja 128 € vähemmän");
  });

  it("shows the result line with no payment input when only the last payment is left", async () => {
    // 1 000 € at 12 %, a principal of 2 000 € a month: one payment of 1 000 € and 10 € of interest
    await open(loan({ rateBp: 1200, repayment: "equal_principal", paymentCents: 200_000 }));
    expect(figures().slice(0, 4)).toEqual(["Jäljellä 1 000,00 €", "Eriä jäljellä 1", "Korkoja jäljellä 10,00 €", "Viimeinen erä 15.2."]);
    expect(screen.queryByLabelText("Kuukausilyhennys")).toBeNull();
    expect(result()).toBe("");
    // 500 € at once leaves 500 € and 5 € of interest in the same last payment
    type("Kertalyhennys", "500");
    expect(result()).toBe("Päättyy 2/2026 · korkoja 5 € vähemmän");
  });

  it("names no fixing for the typed rate, only its margin", async () => {
    // typed 4 % on 5 March 2026, read on 10 June: no published fixing stands behind the typed rate
    const euribor = loan({ balanceCents: 1_000_000, balanceDate: "2026-03-05", reference: "euribor_12", rateBp: 400, marginBp: 65, rateReviewDate: "2026-03-05", repayment: "annuity", paymentCents: 20_000, endDate: "2031-03-05" });
    await open(euribor, "2026-06-10", { euribor_12: [["2026-03-05", 3328]] });
    expect(figures().at(-1)).toBe("Korko 4,000 % (marginaali 0,650 %), tarkistus 5.3.2027");
  });

  it("shows a status and no input where the plan lacks a payment, and never a zero", async () => {
    await open(loan({ kind: "credit_line", rateBp: 1800 }));
    expect(figures().slice(1, 4)).toEqual(["Eriä jäljellä –", "Korkoja jäljellä –", "Viimeinen erä –"]);
    expect(screen.getByText("Kuukausierä puuttuu.")).toBeTruthy();
    expect(screen.queryByLabelText("Kuukausierä")).toBeNull();
    expect(screen.queryByLabelText("Kertalyhennys")).toBeNull();
  });

  it("splits the next 12 months into interest and fees, and tells nothing of a split the rows do not give", () => {
    const row = (next12: object | null, unknown: string | null = null) => ({ id: "account:c1", cost: { next12, unknown } }) as unknown as LoanRow;
    const { unmount } = render(createElement(LoanDrill, { l: row({ cents: 24_000, interestCents: 20_000, feeCents: 4_000 }), today: START, whatIf: false }));
    expect(figures()).toEqual(["Korot 12 kk 200 €", "Kulut 12 kk 40 €"]);
    unmount();
    render(createElement(LoanDrill, { l: row({ cents: 24_000, interestCents: null, feeCents: null }), today: START, whatIf: false }));
    expect(figures()).toEqual([]);
  });

  it("says what a debt without a cost waits for, where the what-if cannot", () => {
    render(createElement(LoanDrill, { l: { id: "account:c1", cost: { next12: null, unknown: "rate" } } as unknown as LoanRow, today: START, whatIf: false }));
    expect(screen.getByText("Korko puuttuu.")).toBeTruthy();
  });

  it("names the fee a 0 % plan waits for, never a gap in general", () => {
    render(createElement(LoanDrill, { l: { id: "account:c1", cost: { next12: null, unknown: "fee" } } as unknown as LoanRow, today: START, whatIf: false }));
    expect(screen.getByText("Kulu erää kohden puuttuu.")).toBeTruthy();
    expect(screen.queryByText("Lainan tiedoissa on aukko.")).toBeNull();
  });
});

/** The plan of a household with two dear debts: one ends in March 2029, the other earlier. */
const PLAN: NonNullable<LoansReport["plan"]> = {
  debtFreeDate: "2029-03-01", baseDebtFreeDate: "2030-01-01", savedCents: 41_000, bufferCents: 0, bufferFullDate: null, snowballExtraCents: 0,
  debts: [{ id: "card", order: 1, endDate: "2027-06-01", baseEndDate: "2027-06-01" }, { id: "credit", order: 2, endDate: "2029-03-01", baseEndDate: "2030-01-01" }],
};
const BASIS: NonNullable<LoansReport["consolidation"]> = { debtIds: ["card", "credit"], owedCents: 100_000, nowCents: 50_000 };
const DEBTS = [{ id: "card", name: "Kaupan kortti" }, { id: "credit", name: "Kulutusluotto" }] as unknown as LoanRow[];
const plan = (over: Partial<NonNullable<LoansReport["plan"]>> = {}, basis: LoansReport["consolidation"] = null) =>
  render(createElement(PlanDrill, { plan: { ...PLAN, ...over }, basis, loans: DEBTS, today: START }));

describe("the drill of the plan line", () => {
  it("tells the month the debts end and what it saves, and the month each debt ends in, with its own payments' month where the extra money moves it", () => {
    plan();
    expect(flat(document.querySelector(".loan-plan > summary")?.textContent)).toBe("Velaton 3/2029 · säästät 410 €");
    expect([...document.querySelectorAll(".loan-plan-list li")].map((li) => li.textContent)).toEqual(["Kaupan kortti: 6/2027", "Kulutusluotto: 3/2029, omilla maksuilla 1/2030"]);
  });

  it("has no line when the plan is not known, and no saving when it saves nothing", () => {
    const { container } = render(createElement(PlanDrill, { plan: null, basis: BASIS, loans: DEBTS, today: START }));
    expect(container.innerHTML).toBe("");
    plan({ savedCents: 0 });
    expect(flat(document.querySelector(".loan-plan > summary")?.textContent)).toBe("Velaton 3/2029");
  });

  it("tells the smallest debt first only from the 50 euro gap on", () => {
    const { unmount } = render(createElement(PlanDrill, { plan: { ...PLAN, snowballExtraCents: 4_999 }, basis: null, loans: DEBTS, today: START }));
    expect(document.body.textContent).not.toContain("Pienin velka ensin");
    unmount();
    plan({ snowballExtraCents: 5_000 });
    expect(flat(document.body.textContent)).toContain("Pienin velka ensin maksaisi 50 € enemmän korkoja ja kuluja.");
  });

  it("prices a loan for the dear debts only once its rate and term are typed", () => {
    plan({}, BASIS);
    expect(flat(document.body.textContent)).toContain("Kaupan kortti, Kulutusluotto");
    expect(result()).toBe("");
    type("Uuden lainan korko, %", "0");
    expect(result()).toBe("");
    type("Laina-aika, kuukautta", "60");
    // 0 % and 60 payments of a 5 euro fee: 300 euros against the 500 the debts have left
    type("Kulu kuukausierässä", "5");
    expect(result()).toBe("Uusi laina maksaisi korkoina ja kuluina 300 € · 200 € vähemmän");
    // a rate over what a loan may carry, or a term of nothing, is no offer
    type("Uuden lainan korko, %", "60");
    expect(result()).toBe("");
    type("Uuden lainan korko, %", "0");
    type("Laina-aika, kuukautta", "0");
    expect(result()).toBe("");
  });

  it("names the field whose text is no offer, and clears the error when the text is mended", () => {
    plan({}, BASIS);
    const errorOf = (label: string) => {
      const input = screen.getByLabelText(label);
      const id = input.getAttribute("aria-describedby");
      return { invalid: input.getAttribute("aria-invalid") === "true", text: id === null ? null : flat(document.getElementById(id)?.textContent) };
    };
    // nothing typed is no mistake yet
    expect(document.querySelectorAll(".field-error").length).toBe(0);
    type("Uuden lainan korko, %", "60");
    expect(errorOf("Uuden lainan korko, %")).toEqual({ invalid: true, text: "Anna korko prosentteina, enintään 50 %." });
    // a term still to be typed is not wrong
    expect(errorOf("Laina-aika, kuukautta")).toEqual({ invalid: false, text: null });
    type("Uuden lainan korko, %", "abc");
    expect(errorOf("Uuden lainan korko, %").invalid).toBe(true);
    type("Uuden lainan korko, %", "4");
    expect(errorOf("Uuden lainan korko, %")).toEqual({ invalid: false, text: null });
    type("Laina-aika, kuukautta", "0");
    expect(errorOf("Laina-aika, kuukautta")).toEqual({ invalid: true, text: "Anna laina-aika kokonaisina kuukausina, enintään 600." });
    type("Laina-aika, kuukautta", "601");
    expect(errorOf("Laina-aika, kuukautta").invalid).toBe(true);
    type("Laina-aika, kuukautta", "6,5");
    expect(errorOf("Laina-aika, kuukautta").invalid).toBe(true);
    type("Laina-aika, kuukautta", "60");
    expect(errorOf("Laina-aika, kuukautta")).toEqual({ invalid: false, text: null });
    // rate and term are right and the fee is empty, which is 0: the offer is complete
    expect(result()).not.toBe("");
    type("Kulu kuukausierässä", "5000");
    expect(errorOf("Kulu kuukausierässä")).toEqual({ invalid: true, text: "Anna kulu euroina, enintään 1 000 €." });
    expect(result()).toBe("");
    type("Kulu kuukausierässä", "-5");
    expect(errorOf("Kulu kuukausierässä").invalid).toBe(true);
    type("Kulu kuukausierässä", "");
    expect(errorOf("Kulu kuukausierässä")).toEqual({ invalid: false, text: null });
    expect(result()).not.toBe("");
  });
});

const DAY = "2026-10-11";
/** A saved loan of another member, so its drill has no what-if and shows what the row tells. Made up. */
const theirs = (over: Partial<LoanRow> = {}): LoanRow =>
  ({
    id: "theirs", name: "Kodin laina", lender: "Esimerkkipankki", kind: "mortgage", accountType: null, linkedAccount: null, typedBy: "Aino",
    balance: { cents: 12_000_000, unknown: null }, balanceDate: DAY, rateBp: 325, reference: "euribor_12", repayment: "annuity",
    payment: { cents: 100_000, interestCents: 32_500, amortisationCents: 67_500, intervalMonths: 1, date: null, unknown: null },
    interest: { cents: 380_000, unknown: null }, cost: null, payoff: { date: "2040-02-01", unknown: null, never: false }, scenarios: [], ...over,
  }) as LoanRow;

/** Lainat with the drill of the one row open, as a reader who pressed its chevron sees it. */
function openDrill(row: LoanRow) {
  const data = {
    loans: {
      day: DAY, saved: 1, loans: [row], unsaved: [], total: { cents: 12_000_000, unknown: [] }, totalKnown: true, interest: { cents: 380_000, unknown: [] }, interestKnown: true, withoutRate: 0,
      cost12: { cents: 380_000, interestCents: 380_000, feeCents: 0 }, plan: null, consolidation: null, payments: { monthlyCents: 100_000, counted: 1, unknown: 0, bullets: 0 }, monthly: { cents: 100_000, unknown: 0 }, path: null, maybeTwice: [], overdraftTwice: [],
    },
    balances: { months: ["2026-10"], total: [0], monthChange: [null], missing: [], accountsLessDebt: [null], lowest: null, accounts: [], holdings: { accounts: [], cards: [], loans: [], debtCents: 0, unsavedLoans: null, netCents: null } },
  };
  const ctx = { data, meta: { today: DAY, accounts: [] }, running: "2026-10", scope: "own", exportHref: () => "" } as unknown as ReportContext;
  const search = { [DRILL_PARAM]: writeTableState(undefined, tableId(t("rpt.ln_caption")), row.id) };
  return render(createElement(PageAddressContext.Provider, { value: { search, change: () => {} } }, createElement(loansSection.Component, { ctx })));
}

/** What a figure's value holds, its small text and its parts each as a word group of their own. */
const valueWords = (dd: Element | null) =>
  [...(dd?.childNodes ?? [])].flatMap((n) => (n instanceof Element && n.classList.contains("loan-parts") ? [...n.children].map((p) => flat(p.textContent && `${p.querySelector("dt")?.textContent} ${p.querySelector("dd")?.textContent}`)) : [flat(n.textContent)]));

/** The open drill's figures: label and value of each, in order. */
const drillFigures = () => [...document.querySelectorAll(".rt-detail .loan-figures > div")].map((d) => [flat(d.querySelector("dt")?.textContent), ...valueWords(d.querySelector("dd"))].join(" "));

describe("the open drill of a debt in Lainat", () => {
  it("tells a payment with no interval without one, and never with the word null", () => {
    openDrill(theirs({ payment: { cents: 20_000, interestCents: null, amortisationCents: null, intervalMonths: null, date: null, unknown: "interval" } }));
    expect(drillFigures()).toContain("Maksu 200,00 €");
    expect(document.body.textContent).not.toContain("null");
  });

  it("shows the interest and the principal of a payment as parts of its figure, not as a clause", () => {
    openDrill(theirs());
    expect(drillFigures()).toContain("Maksu 1 000,00 €/kk Korko 325,00 € Lyhennys 675,00 €");
    expect(drillFigures()).toContain("Viimeinen maksupäivä 1.2.2040");
    expect(document.body.textContent).not.toMatch(/korkoa 325|lyhennystä/);
  });

  it("shows a dash for the payment and the last payment of a debt that owes nothing", () => {
    const none = { cents: null, interestCents: null, amortisationCents: null, intervalMonths: 1, date: null, unknown: null };
    openDrill(theirs({ balance: { cents: 0, unknown: null }, payment: none, interest: { cents: 0, unknown: null }, payoff: { date: null, unknown: null, never: false } }));
    expect(drillFigures()).toContain("Maksu –");
    expect(drillFigures()).toContain("Viimeinen maksupäivä –");
    expect(document.body.textContent).not.toContain("Maksettu");
  });

  it("tells the day of a balance no plan moved forward", () => {
    openDrill(theirs({ balance: { cents: 124_000, unknown: "repayment" }, balanceDate: "2026-03-01" }));
    expect(drillFigures()).toContain("Velkaa 1 240,00 € jäljellä 1.3.");
  });

  it("tells a known rate and its reference where no what-if opens", () => {
    openDrill(theirs());
    expect(drillFigures()).toContain("Korko 3,25 % 12 kuukauden Euribor");
  });
});
