/**
 * Proposed loans, asked in Tarkistettavat: the form a proposal makes and the words it uses. The page and the buttons
 * are driven by e2e/loan-proposals.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { emptyForm, formOfProposal, readForm, setValue } from "../src/components/loans/form.ts";
import { editorHelp, HELP_BALANCE_AND_RATE, HELP_RATE, PROPOSAL_QUESTION } from "../src/components/loans/proposal-words.ts";
import { eurosText } from "../src/format.ts";
import type { Account, LoanProposalRow } from "../src/types.ts";
import type { Loan } from "@banking/core";

const TODAY = "2026-10-12";
const KEY = "out:chk-1:esimerkkirahoitus oy#25000";

const proposal: LoanProposalRow = { key: KEY, payee: "Esimerkkirahoitus Oy", paymentCents: 25_000, months: 7, firstDate: "2026-04-05", lastDate: "2026-10-05", kind: "consumer" };

describe("the form of a proposal beside the household's loan accounts", () => {
  const account = (id: string, type: Account["type"], balanceCents: number | null, over: Partial<Account> = {}) =>
    ({ id, name: id, bankName: id, customName: null, cardMask: null, type, balanceCents, balanceAt: "2026-10-08T09:30:00.000Z", ...over }) as Account;
  const saved = (accountId: string | null) => ({ id: "s1", name: "Laina", kind: "consumer", balanceCents: 100_000, balanceDate: "2026-10-01", accountId }) as Loan;
  const home = account("home", "loan", -14_912_345);
  const plain = formOfProposal(proposal, TODAY);

  it("with one loan account no saved loan holds, chooses it and fills the balance the bank tells, as owed, on its day", () => {
    const form = formOfProposal(proposal, TODAY, [account("chk", "checking", 200_000), account("card", "credit_card", -80_000), home], []);
    expect(form.accountId).toBe("home");
    expect(form.values).toMatchObject({ balanceCents: eurosText(14_912_345), balanceDate: "2026-10-08", lender: "Esimerkkirahoitus Oy", paymentCents: "250,00" });
    // nothing else of the form moved, and nothing is left to type but the rate
    expect({ ...form, accountId: plain.accountId, values: { ...form.values, balanceCents: "", balanceDate: TODAY } }).toEqual(plain);
    const { body, errors } = readForm(form);
    expect(errors).toEqual({});
    expect(body).toMatchObject({ balanceCents: 14_912_345, balanceDate: "2026-10-08", accountId: "home", seriesKey: KEY });
  });

  it("asks only for what the form leaves empty: the rate when the balance is told, else the balance and the rate", () => {
    expect(editorHelp(formOfProposal(proposal, TODAY, [account("home", "loan", -1_000)], []))).toBe(HELP_RATE);
    expect(editorHelp(formOfProposal(proposal, TODAY, [account("home", "loan", null)], []))).toBe(HELP_BALANCE_AND_RATE);
    expect(editorHelp(formOfProposal(proposal, TODAY))).toBe(HELP_BALANCE_AND_RATE);
  });

  it("with none, or with the only one held by a saved loan, is as it was", () => {
    expect(formOfProposal(proposal, TODAY, [], [])).toEqual(plain);
    expect(formOfProposal(proposal, TODAY, [account("chk", "checking", 200_000), account("card", "credit_card", -80_000)], [])).toEqual(plain);
    expect(formOfProposal(proposal, TODAY, [home], [saved("home")])).toEqual(plain);
    // the one that is free is counted, not the one that is held
    expect(formOfProposal(proposal, TODAY, [home, account("car", "loan", -900_000)], [saved("home")]).accountId).toBe("car");
  });

  it("with several free loan accounts does not choose one", () => {
    expect(formOfProposal(proposal, TODAY, [home, account("car", "loan", -900_000)], [])).toEqual(plain);
  });

  it("with the one free loan account telling no debt (no balance, zero, a plus) chooses nothing and fills nothing", () => {
    for (const balance of [null, 0, 14_912_345]) expect(formOfProposal(proposal, TODAY, [account("home", "loan", balance)], []), String(balance)).toEqual(plain);
  });

  it("dates the balance today when the bank gave no day, and never after today", () => {
    expect(formOfProposal(proposal, TODAY, [account("home", "loan", -1_000, { balanceAt: null })], []).values.balanceDate).toBe(TODAY);
    expect(formOfProposal(proposal, TODAY, [account("home", "loan", -1_000, { balanceAt: "2026-12-31T00:00:00Z" })], []).values.balanceDate).toBe(TODAY);
  });
});

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

describe("the words", () => {
  // built from code points: the repo rule that keeps em dashes out of text files reads the characters in a regex too
  const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  const texts = [PROPOSAL_QUESTION, HELP_RATE, HELP_BALANCE_AND_RATE];

  it("are plain: no dash for a pause, no exclamation mark, no 'ei X vaan Y'", () => {
    for (const text of texts) {
      expect(text).not.toMatch(DASHES);
      expect(text).not.toContain("!");
      expect(text).not.toMatch(/\bei\b[^.]*\bvaan\b/i);
    }
  });

  it("ask the question a neighbour would", () => {
    expect(PROPOSAL_QUESTION).toBe("Onko tämä lainan maksu?");
  });
});
