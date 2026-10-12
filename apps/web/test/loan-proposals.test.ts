/**
 * Proposed loans in Asetukset > Lainat: the form a proposal makes, the block that asks about it and the words it
 * uses. The page and the buttons are driven by e2e/loan-proposals.spec.ts.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyForm, formOfProposal, readForm, setValue } from "../src/components/loans/form.ts";
import { EDITOR_HELP, monthlyText, notLoanText, PROPOSAL_QUESTION, PROPOSALS_CHANGE, PROPOSALS_INTRO, PROPOSALS_TITLE, Proposals, sinceText } from "../src/components/loans/Proposals.tsx";
import { money } from "../src/format.ts";
import type { LoanProposalRow } from "../src/types.ts";

const TODAY = "2026-10-12";
const KEY = "out:chk-1:esimerkkirahoitus oy#25000";

const proposal: LoanProposalRow = { key: KEY, payee: "Esimerkkirahoitus Oy", paymentCents: 25_000, months: 7, firstDate: "2026-04-05", lastDate: "2026-10-05", kind: "consumer" };
const person: LoanProposalRow = { key: "out:chk-1:pekka virtanen#40000", payee: "Pekka Virtanen", paymentCents: 40_000, months: 12, firstDate: "2025-11-01", lastDate: "2026-10-01", kind: "consumer" };

const html = (proposals: LoanProposalRow[]) => renderToStaticMarkup(createElement(Proposals, { proposals, today: TODAY, onAnswered: () => undefined }));

describe("the form of a proposal", () => {
  it("holds the lender, the guessed kind, the payment, a one-month interval and the series key", () => {
    const form = formOfProposal(proposal, TODAY);
    expect(form).toMatchObject({ id: null, seriesKey: KEY, name: "", kind: "consumer", source: null, confirmed: [], paymentKind: null });
    expect(form.values).toMatchObject({ lender: "Esimerkkirahoitus Oy", paymentCents: "250,00", intervalMonths: "1", balanceDate: TODAY });
  });

  it("leaves the balance and the rate empty, and asks for the balance before it is saved", () => {
    const form = formOfProposal(proposal, TODAY);
    expect(form.values).toMatchObject({ balanceCents: "", rateBp: "", grantedCents: "", marginBp: "", endDate: "", repayment: "", reference: "" });
    const { body, errors } = readForm(form);
    expect(body).toBeNull();
    expect(Object.keys(errors)).toEqual(["balanceCents"]);
  });

  it("makes the loan the server takes once the balance is typed, linked by the proposal's key", () => {
    const { body, errors } = readForm(setValue(formOfProposal(proposal, TODAY), "balanceCents", "6 400,50"));
    expect(errors).toEqual({});
    expect(body).toEqual({
      name: "Kulutusluotto, Esimerkkirahoitus Oy",
      kind: "consumer",
      lender: "Esimerkkirahoitus Oy",
      grantedCents: null,
      balanceCents: 640_050,
      balanceDate: TODAY,
      rateBp: null,
      reference: null,
      marginBp: null,
      rateReviewDate: null,
      repayment: null,
      intervalMonths: 1,
      paymentCents: 25_000,
      endDate: null,
      limitCents: null,
      seriesKey: KEY,
    });
  });

  it("takes the kind the detector guessed and lets the household change it", () => {
    for (const kind of ["mortgage", "student", "car", "instalment"] as const) expect(formOfProposal({ ...proposal, kind }, TODAY).kind).toBe(kind);
    const { body } = readForm({ ...setValue(formOfProposal(proposal, TODAY), "balanceCents", "1000"), kind: "car" });
    expect(body).toMatchObject({ kind: "car", name: "Autolaina, Esimerkkirahoitus Oy" });
  });

  it("keeps a long payee within the 80 characters the lender field takes, and a form of its own apart from an empty one", () => {
    expect(formOfProposal({ ...proposal, payee: "E".repeat(120) }, TODAY).values.lender).toHaveLength(80);
    expect(emptyForm(TODAY).seriesKey).toBeNull();
    expect(emptyForm(TODAY).values.intervalMonths).toBe("");
  });
});

describe("the block", () => {
  it("shows nothing while there is no proposal", () => {
    expect(html([])).toBe("");
  });

  it("has a row for each proposal with the payee, the payment, since when and the two buttons", () => {
    const out = html([proposal, person]);
    for (const p of [proposal, person]) {
      expect(out).toContain(p.payee);
      expect(out).toContain(money(p.paymentCents));
      expect(out).toContain(sinceText(p));
      expect(out).toContain(`aria-label="Tallenna lainaksi: ${p.payee}"`);
      expect(out).toContain(`aria-label="Ei laina: ${p.payee}"`);
    }
    expect(out.match(/>Tallenna lainaksi</g)).toHaveLength(2);
    expect(out.match(/>Ei laina</g)).toHaveLength(2);
    expect(out).toContain(PROPOSAL_QUESTION);
    expect(out).toContain(PROPOSALS_CHANGE);
    // the form opens on a click: it is not on the page until then
    expect(out).not.toContain("<form");
  });

  it("tells the sum through the shared formatter, as the list of loans does", () => {
    expect(sinceText(proposal)).toBe("Maksettu 5.4.2026 lähtien");
    expect(monthlyText(proposal)).toBe(`${money(25_000)} kuukaudessa`);
    expect(monthlyText(proposal)).toMatch(/^250,00\s€ kuukaudessa$/);
    expect(notLoanText(person)).toBe("Merkitty: Pekka Virtanen ei ole laina.");
  });
});

describe("the words", () => {
  // built from code points: the repo rule that keeps em dashes out of text files reads the characters in a regex too
  const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  const texts = [PROPOSALS_TITLE, PROPOSALS_INTRO, PROPOSAL_QUESTION, PROPOSALS_CHANGE, EDITOR_HELP, sinceText(proposal), monthlyText(proposal), notLoanText(proposal)];

  it("are plain: no dash for a pause, no exclamation mark, no 'ei X vaan Y'", () => {
    for (const text of [...texts, html([proposal, person])]) {
      expect(text).not.toMatch(DASHES);
      expect(text).not.toContain("!");
      expect(text).not.toMatch(/\bei\b[^.]*\bvaan\b/i);
    }
  });

  it("ask the question a neighbour would, and make Ei laina the answer for a payee that is not a lender", () => {
    expect(PROPOSAL_QUESTION).toBe("Onko tämä lainan maksu?");
    expect(PROPOSALS_INTRO).toMatch(/tuttu ihminen/);
    expect(PROPOSALS_INTRO).toMatch(/valitse Ei laina/);
  });

  it("say once that an answer can be changed, and put no count, badge or alert in the block", () => {
    expect(PROPOSALS_CHANGE).toBe("Jos vastasit vahingossa Ei laina, lisää laina itse alempana.");
    const out = html([proposal, person]);
    expect(out.split(PROPOSALS_CHANGE)).toHaveLength(2);
    expect(out).not.toMatch(/badge|role="alert"/);
  });
});
