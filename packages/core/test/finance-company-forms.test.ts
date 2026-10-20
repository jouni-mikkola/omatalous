/**
 * A finance company's steady payment is a loan with no question, whatever words follow its lending word: a country, a
 * region, then the company form. Rows go through the whole enrichment as the server stores them. Made-up names and sums.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { addMonths } from "../src/dates.ts";
import { loanProposals } from "../src/loan-detect.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { isFinanceCompanyName } from "../src/wording-lenders.ts";
import { type Account, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-15";
const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking", holder: "ESIMERKKI ERKKI" };

function row(counterparty: string, description: string, euros: number, date: string): Transaction {
  const t = tx({
    accountId: "chk",
    bookingDate: date,
    amountCents: Math.round(euros * 100),
    counterparty,
    counterpartyIban: "FI4950009420028731",
    description,
    merchant: normalizeMerchant(counterparty, description),
  });
  return { ...t, reference: "00000 77881 23006" } as Transaction;
}

/** One payment a month, the last in October 2026. */
const monthly = (count: number, euros: number, payee: string) => Array.from({ length: count }, (_, i) => row(payee, "SOPIMUS 7788123", euros, `${addMonths("2026-10", i - (count - 1))}-05`));

function loanAsk(rows: Transaction[], inputs: UserInputs = NO_INPUTS) {
  const changed = new Map(enrichTransactions(rows, [checking], []).map((t) => [t.id, t]));
  const final = rows.map((t) => changed.get(t.id) ?? t);
  const ctx = createContext(final, [checking], TODAY);
  const proposals = loanProposals(ctx, inputs);
  const questions = buildQuestions(ctx, { from: "2026-01-01", to: TODAY }, inputs, proposals).items.filter((i) => i.kind === "loan");
  return { proposals, questions };
}

const FORMS = ["Esimerkki Rahoitus Oy", "Esimerkki Rahoitus Suomi Oy", "Esimerkki Finance AB", "Esimerkki Credit Finland Oy", "Esimerkki Finans ASA"];

describe("a finance company named with a country or a form", () => {
  it.each(FORMS.map((n) => n.toUpperCase()))("%s is one by the end of its name", (name) => {
    expect(isFinanceCompanyName(name)).toBe(true);
  });
  it.each(["RAHOITUSNEUVONTA OY", "ESIMERKKI SUOMI OY", "SUOMI RAHOITUS NEUVONTA", "ESIMERKKI FINLAND OY"])("%s is not", (name) => {
    expect(isFinanceCompanyName(name)).toBe(false);
  });
});

describe("a steady payment to a finance company", () => {
  it.each(FORMS)("to %s is a loan and no question is asked", (payee) => {
    const { proposals, questions } = loanAsk(monthly(8, -189.5, payee));
    expect(proposals).not.toEqual([]);
    for (const p of proposals) expect(p.placed).toBe(true);
    expect(questions).toEqual([]);
  });

  it.each(FORMS)("to %s, once answered Ei laina, is asked no more and is no proposal", (payee) => {
    const first = loanAsk(monthly(8, -189.5, payee));
    const marks = first.proposals.map((p) => ({ subject: `loan-proposal:${p.key}`, mark: "dismissed" as const, markedAt: "2026-10-01T08:00:00.000Z" }));
    const again = loanAsk(monthly(8, -189.5, payee), { marks, expectedBills: [] });
    expect(again.proposals).toEqual([]);
    expect(again.questions).toEqual([]);
  });

  it("to a service firm with no lender sign is placed by no name", () => {
    const { proposals } = loanAsk(monthly(8, -189.5, "Esimerkki Rahoitusneuvonta Oy"));
    expect(proposals.filter((p) => p.placed)).toEqual([]);
  });

  it("paid once is no loan at all", () => {
    const { proposals, questions } = loanAsk([row("Esimerkki Rahoitus Suomi Oy", "SOPIMUS 7788123", -189.5, "2026-09-05")]);
    expect(proposals).toEqual([]);
    expect(questions).toEqual([]);
  });
});
