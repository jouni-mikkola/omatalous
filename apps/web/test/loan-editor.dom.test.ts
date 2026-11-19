/**
 * The loan form in the reader's language: a payment under the interest shows its warning and the button that clears it
 * in the catalogue's English, and no Finnish sentence of the form is left in the page.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { emptyForm, type LoanBody } from "../src/components/loans/form.ts";
import { LoanEditor, LoanLinks } from "../src/components/loans/LoanEditor.tsx";
import { setLanguage } from "../src/format.ts";
import type { Account } from "../src/types.ts";

const day = "2026-10-12";
const card = { id: "card", name: "Example card", type: "credit_card" } as Account;
const FINNISH = ["Kuukausierä on pienempi", "tyhjennä kuukausierä", "Tyhjennä", "Näytä kaikki kentät", "Sama velka pankin tilillä", "Kun yhdistät", "Velkana on", "Pelkkä lyhennys", "Koko erä", "Päivä, jona", "Tyhjänä nimeksi", "Ei liitetty", "Kertalyhenteisen"];

function open(language: "fi" | "en") {
  setLanguage(language);
  const initial = emptyForm(day);
  initial.kind = "mortgage";
  initial.values = { ...initial.values, balanceCents: "100000", rateBp: "5,00", repayment: "annuity", intervalMonths: "1", paymentCents: "10" };
  return render(createElement(LoanLinks.Provider, { value: { accounts: [card], loans: [] } }, createElement(LoanEditor, { initial, today: day, cancelLabel: "Cancel", onSave: async () => {}, onCancel: () => {} })));
}

describe("LoanEditor in the reader's language", () => {
  afterEach(() => {
    cleanup();
    setLanguage("fi");
  });

  it("has the warning and the button in English, no line of help and no Finnish sentence", () => {
    const { container, getByRole } = open("en");
    const text = container.textContent ?? "";
    expect(container.querySelector(".loan-interest p")?.textContent).toMatch(/^The monthly payment is smaller than the interest \(.*\)\. The loan does not shrink\./);
    expect(getByRole("button", { name: "Clear monthly payment" })).toBeTruthy();
    expect(text).toContain("Same debt as an account at the bank");
    expect(container.querySelector(".field-help")).toBeNull();
    for (const word of FINNISH) expect(text).not.toContain(word);
  });

  it("has the two fields of a rate step on a loan with a typed rate, labelled in each language", () => {
    const en = open("en");
    expect(en.getByLabelText("Rate change date")).toBeTruthy();
    expect(en.getByLabelText("Rate after the change (%)")).toBeTruthy();
    cleanup();
    const fi = open("fi");
    expect(fi.getByLabelText("Koron muutospäivä")).toBeTruthy();
    expect(fi.getByLabelText("Korko muutoksen jälkeen (%)")).toBeTruthy();
  });

  it("has no step fields on a loan that takes its rate from a euribor", () => {
    setLanguage("en");
    const initial = emptyForm(day);
    initial.kind = "mortgage";
    initial.values = { ...initial.values, balanceCents: "100000", reference: "euribor_12", marginBp: "0,65" };
    const { queryByLabelText } = render(createElement(LoanLinks.Provider, { value: { accounts: [], loans: [] } }, createElement(LoanEditor, { initial, today: day, cancelLabel: "Cancel", onSave: async () => {}, onCancel: () => {} })));
    expect(queryByLabelText("Rate change date")).toBeNull();
    expect(queryByLabelText("Rate after the change (%)")).toBeNull();
  });

  it("saves the day and the rate typed in the step fields, and sends none when they are left empty", async () => {
    setLanguage("en");
    const saved: LoanBody[] = [];
    // a form saves once, so each save has its own form
    const save = async (type: (getByLabelText: (label: string) => HTMLElement) => void) => {
      const initial = emptyForm(day);
      initial.kind = "instalment";
      initial.values = { ...initial.values, balanceCents: "1200", rateBp: "0", repayment: "fixed_instalment", intervalMonths: "1", paymentCents: "200" };
      const { getByLabelText, container } = render(createElement(LoanLinks.Provider, { value: { accounts: [], loans: [] } }, createElement(LoanEditor, { initial, today: day, cancelLabel: "Cancel", onSave: async (body) => void saved.push(body), onCancel: () => {} })));
      type(getByLabelText);
      const before = saved.length;
      fireEvent.submit(container.querySelector("form")!);
      await waitFor(() => expect(saved).toHaveLength(before + 1));
      cleanup();
    };
    await save(() => {});
    expect(saved[0]).toMatchObject({ rateStepDate: null, rateStepBp: null });
    await save((byLabel) => {
      fireEvent.change(byLabel("Rate change date"), { target: { value: "2027-03-01" } });
      fireEvent.change(byLabel("Rate after the change (%)"), { target: { value: "19,90" } });
    });
    expect(saved[1]).toMatchObject({ rateStepDate: "2027-03-01", rateStepBp: 1990 });
  });

  it("keeps the Finnish texts", () => {
    const { container, getByRole } = open("fi");
    expect(container.querySelector(".loan-interest p")?.textContent).toContain("Kuukausierä on pienempi kuin korko (");
    expect(getByRole("button", { name: "Tyhjennä kuukausierä" })).toBeTruthy();
    expect(container.textContent).toContain("Sama velka pankin tilillä");
  });
});
