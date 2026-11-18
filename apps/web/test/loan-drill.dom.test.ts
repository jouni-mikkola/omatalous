/**
 * The drill of a loan in Raportit > Lainat: what is left, the rate, and the one line a new payment or an extra repayment
 * answers with. Every expected figure is counted by hand in cents from the loan's own terms. Loans are made up.
 */
import type { Loan } from "@banking/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { LoanDrill } from "../src/components/loans/LoanDrill.tsx";
import { queryClient } from "../src/query-client.ts";
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
  render(createElement(LoanDrill, { id: l.id, today }));
  fireEvent.click(screen.getByText("Erittely"));
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
});
