/**
 * The loan form in the reader's language: a payment under the interest shows its warning and the button that clears it
 * in the catalogue's English, and no Finnish sentence of the form is left in the page.
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { emptyForm } from "../src/components/loans/form.ts";
import { LoanEditor, LoanLinks } from "../src/components/loans/LoanEditor.tsx";
import { setLanguage } from "../src/format.ts";
import type { Account } from "../src/types.ts";

const day = "2026-10-12";
const card = { id: "card", name: "Example card", type: "credit_card" } as Account;
const FINNISH = ["Maksuerä on pienempi", "tyhjennä maksuerä", "Tyhjennä", "Näytä kaikki kentät", "Sama velka pankin tilillä", "Kun yhdistät", "Velkana on", "Pelkkä lyhennys", "Koko erä", "Päivä, jona", "Tyhjänä nimeksi", "Ei liitetty", "Kertalyhenteisen"];

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

  it("has the warning, the button and the help in English and no Finnish sentence", () => {
    const { container, getByRole } = open("en");
    const text = container.textContent ?? "";
    expect(container.querySelector(".loan-interest p")?.textContent).toMatch(/^The payment is smaller than the interest \(.*\)\. The loan does not shrink\./);
    expect(getByRole("button", { name: "Clear payment" })).toBeTruthy();
    expect(text).toContain("Same debt as an account at the bank");
    for (const word of FINNISH) expect(text).not.toContain(word);
  });

  it("keeps the Finnish texts", () => {
    const { container, getByRole } = open("fi");
    expect(container.querySelector(".loan-interest p")?.textContent).toContain("Maksuerä on pienempi kuin korko (");
    expect(getByRole("button", { name: "Tyhjennä maksuerä" })).toBeTruthy();
    expect(container.textContent).toContain("Sama velka pankin tilillä");
  });
});
