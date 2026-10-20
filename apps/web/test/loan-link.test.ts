import type { Loan, LoansReport } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyForm, formOfLoan } from "../src/components/loans/form.ts";
import { LoanEditor, LoanLinks } from "../src/components/loans/LoanEditor.tsx";
import { section as loans } from "../src/pages/reports/sections/Loans.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import type { Account } from "../src/types.ts";

const day = "2026-10-12";
const card = { id: "card", name: "Esimerkkikortti", type: "credit_card" } as Account;
const saved = (id: string, accountId?: string): Loan => ({
  id, name: `Laina ${id}`, lender: "ESIMERKKIRAHOITUS OY", kind: "card", grantedCents: null, balanceCents: 100_000, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null,
  repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: 300_000, seriesKey: null, ...(accountId ? { accountId } : {}),
});

/** The editor as markup, with what the loans card gives it. */
const editor = (initial: ReturnType<typeof formOfLoan>, accounts: Account[], loans: Loan[]) =>
  renderToStaticMarkup(createElement(LoanLinks.Provider, { value: { accounts, loans } }, createElement(LoanEditor, { initial, today: day, cancelLabel: "Peruuta", onSave: async () => {}, onCancel: () => {} })));

/** The markup of the select "Sama velka pankin tilillä". */
const accountSelect = (out: string) => /<select id="[^"]*-account"[\s\S]*?<\/select>/.exec(out)?.[0] ?? "";

describe("the select of the loan form", () => {
  it("is not there without a card or loan account, and not when every such account is another loan's", () => {
    const checking = { id: "chk", name: "Käyttötili", type: "checking" } as Account;
    expect(editor(emptyForm(day), [], [])).not.toContain("Sama velka pankin tilillä");
    expect(editor(emptyForm(day), [checking], [])).not.toContain("Sama velka pankin tilillä");
    expect(editor(emptyForm(day), [card], [saved("a", "card")])).not.toContain("Sama velka pankin tilillä");
  });

  it("offers Ei liitetty and the account by name, with the line that tells what a link does", () => {
    const out = editor(formOfLoan(saved("b")), [card], [saved("a")]);
    expect(out).toContain("Sama velka pankin tilillä");
    expect(accountSelect(out)).toContain('<option value="" selected="">Ei liitetty</option><option value="card">Esimerkkikortti</option>');
    expect(out).toContain("Kun laina on liitetty tiliin, velka lasketaan vain kerran ja saldo tulee pankista.");
    // not linked: the balance field has no line about the bank
    expect(out).not.toContain("Velkana käytetään pankin saldoa");
  });

  it("a linked loan shows its account chosen, and its balance says the bank's counts while the bank tells one", () => {
    const out = editor(formOfLoan(saved("a", "card")), [card], [saved("a", "card")]);
    expect(accountSelect(out)).toContain('<option value="card" selected="">Esimerkkikortti</option>');
    expect(out).toContain("Velkana käytetään pankin saldoa aina, kun pankki ilmoittaa sen. Muulloin käytetään tähän kirjattua saldoa.");
  });

  it("a stored link to an account that is not offered any more is shown as no link", () => {
    const out = editor(formOfLoan(saved("a", "gone")), [card], []);
    expect(accountSelect(out)).toContain('<option value="" selected="">Ei liitetty</option>');
    expect(out).not.toContain("Velkana käytetään pankin saldoa");
  });
});

describe("the Lainat report offers the link", () => {
  const row = { id: "home", name: "Kodin laina", lender: null, kind: "card", accountType: null, linkedAccount: null, balance: { cents: 100_000, unknown: null }, balanceDate: day, rateBp: null, reference: null, repayment: null,
    payment: { cents: null, interestCents: null, amortisationCents: null, intervalMonths: null, date: null, unknown: null }, interest: { cents: null, unknown: null }, payoff: { date: null, unknown: null, never: false }, scenarios: [] };
  const report = (twice: unknown) => ({ day, saved: 1, loans: [row], total: { cents: 100_000, unknown: [] }, interest: { cents: 0, unknown: [] }, interestKnown: true, withoutRate: 0, payments: { monthlyCents: 0, counted: 0, unknown: 0, bullets: 0 }, path: { days: [day], balanceCents: [0], interestCents: [0], tops: [0], payoff: null, moves: [], left: [] }, maybeTwice: [twice], overdraftTwice: [] }) as unknown as LoansReport;
  const html = (r: LoansReport, own: string[], scope = "own") => {
    const balances = { months: [], total: [], accountsLessDebt: [], lowest: null, events: [], accounts: [], debt: { day, cents: 0, savedCents: 0 } };
    const ctx = { data: { loans: r, balances }, meta: { today: day, accounts: own.map((id) => ({ id })) }, running: null, scope, exportHref: () => "" } as unknown as ReportContext;
    return renderToStaticMarkup(createElement(loans.Component, { ctx })).replace(/&amp;/g, "&").replace(/&gt;/g, ">");
  };

  it("ends the sentence with a link to the loan's editor with the account chosen", () => {
    const out = html(report({ loans: [{ id: "home", name: "Kodin laina" }], accounts: [{ id: "card", name: "Esimerkkikortti" }] }), ["card"]);
    expect(out).toContain("Jos kyse on samasta velasta, se lasketaan vain kerran, kun liität lainan tiliin. <a href=\"#/settings?linkLoan=home&linkAccount=card#lainat\">Liitä Kodin laina tiliin Esimerkkikortti</a></li>");
  });

  it("offers each loan beside each own account, and none for an account that is not the household's own", () => {
    const out = html(report({ loans: [{ id: "a", name: "Laina A" }, { id: "b", name: "Laina B" }], accounts: [{ id: "c1", name: "Kortti 1" }, { id: "partner", name: "Puolison kortti" }] }), ["c1"]);
    expect(out).toContain("Liitä Laina A tiliin Kortti 1");
    expect(out).toContain("Liitä Laina B tiliin Kortti 1");
    expect(out).not.toContain("Puolison kortti</a>");
    expect(out.match(/<a href="#\/settings\?linkLoan/g)).toHaveLength(2);
  });

  it("with no account of its own to link to, the sentence keeps the way of removing the saved loan", () => {
    const out = html(report({ loans: [{ id: "home", name: "Kodin laina" }], accounts: [{ id: "partner", name: "Puolison kortti" }] }), [], "household");
    expect(out).toContain("Jos kyse on samasta velasta, poista tallennettu laina kohdassa Asetukset > Lainat, niin se lasketaan vain kerran.");
    expect(out).not.toContain("linkLoan");
  });
});
