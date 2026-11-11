import type { Loan } from "@banking/core";
import { describe, expect, it } from "vitest";
import "@banking/core/english";
import "@banking/core/late";
import { setLanguage } from "../src/format.ts";
import { defaultName, emptyForm, formOfLoan, interestOverPayment, linkChoices, readForm, setKind, setValue, shownFields } from "../src/components/loans/form.ts";
import type { Account } from "../src/types.ts";

const TODAY = "2026-10-12";

// A made-up loan as the household types it into the form.
const TYPED = { lender: "Esimerkkipankki Oyj", grantedCents: "150 000,00", balanceCents: "120 000,00", balanceDate: "2026-09-30", rateBp: "3,39", reference: "euribor_12", marginBp: "0,65", repayment: "annuity", intervalMonths: "1", paymentCents: "689,20", endDate: "2046-10-31" } as const;

const typedForm = () => {
  let form = emptyForm(TODAY);
  for (const [key, text] of Object.entries(TYPED)) form = setValue(form, key as keyof typeof TYPED, text);
  return form;
};

describe("a form as the loan the server takes", () => {
  it("sends every field of a loan and no other, with the kind's name when the loan has none", () => {
    const form = setKind(typedForm(), "mortgage");
    expect(readForm(form)).toEqual({
      errors: {},
      body: {
        name: "Asuntolaina, Esimerkkipankki Oyj",
        kind: "mortgage",
        lender: "Esimerkkipankki Oyj",
        grantedCents: 15_000_000,
        balanceCents: 12_000_000,
        balanceDate: "2026-09-30",
        rateBp: 339,
        reference: "euribor_12",
        marginBp: 65,
        rateReviewDate: null,
        repayment: "annuity",
        intervalMonths: 1,
        paymentCents: 68_920,
        endDate: "2046-10-31",
        limitCents: null,
        seriesKey: null,
      },
    });
    expect(readForm({ ...form, name: "  Kodin laina " }).body?.name).toBe("Kodin laina");
    expect(defaultName("car", "")).toBe("Autolaina");
    expect(defaultName("other", "x".repeat(80))).toHaveLength(80);
  });

  it("reads amounts and rates the Finnish way, rounds a rate to hundredths and reads zero as empty", () => {
    let form = setKind(emptyForm(TODAY), "consumer");
    form = setValue(form, "balanceCents", "8 000");
    form = setValue(form, "rateBp", "5,555 %");
    form = setValue(form, "marginBp", "0.5");
    form = setValue(form, "paymentCents", "0");
    form = setValue(form, "grantedCents", "10000,5 €");
    const { body, errors } = readForm(form);
    expect(errors).toEqual({});
    expect(body).toMatchObject({ balanceCents: 800_000, rateBp: 556, marginBp: 50, paymentCents: null, grantedCents: 1_000_050, balanceDate: TODAY, name: "Kulutusluotto" });
  });

  it("names what is missing or cannot be read", () => {
    let form = emptyForm(TODAY);
    expect(readForm(form)).toEqual({ body: null, errors: { kind: "Valitse laji.", balanceCents: "Anna, paljonko lainaa on jäljellä." } });
    form = setKind(form, "other");
    form = setValue(form, "balanceCents", "paljon");
    form = setValue(form, "rateBp", "-1");
    form = setValue(form, "balanceDate", "");
    expect(readForm(form).errors).toEqual({
      balanceCents: "Anna summa euroina, esimerkiksi 12 500,00.",
      rateBp: "Anna korko prosentteina, esimerkiksi 3,25.",
      balanceDate: "Valitse päivä.",
    });
  });

  it("names the errors of an empty form in the language chosen", () => {
    try {
      setLanguage("en");
      expect(readForm(emptyForm(TODAY)).errors).toEqual({ kind: "Choose a kind.", balanceCents: "Enter how much of the loan is left." });
      setLanguage("fi");
      expect(readForm(emptyForm(TODAY)).errors).toEqual({ kind: "Valitse laji.", balanceCents: "Anna, paljonko lainaa on jäljellä." });
    } finally {
      setLanguage("fi");
    }
  });

  it("a card or a credit line has a limit and no repayment plan; other loans have no limit", () => {
    let form = setKind(typedForm(), "credit_line");
    form = setValue(form, "limitCents", "5 000");
    expect(shownFields(form)).not.toContain("repayment");
    expect(readForm(form).body).toMatchObject({ repayment: null, intervalMonths: null, paymentCents: null, endDate: null, grantedCents: null, limitCents: 500_000 });
    form = setKind(form, "consumer");
    expect(shownFields(form)).not.toContain("limitCents");
    expect(readForm(form).body).toMatchObject({ repayment: "annuity", paymentCents: 68_920, limitCents: null, grantedCents: 15_000_000 });
  });

  it("a loan paid back at once has no payment", () => {
    const form = setValue(setKind(typedForm(), "other"), "repayment", "bullet");
    expect(shownFields(form)).not.toContain("paymentCents");
    expect(readForm(form).body).toMatchObject({ repayment: "bullet", paymentCents: null, intervalMonths: 1 });
  });

  it("an edited loan goes back whole, the series it is linked to included", () => {
    const loan: Loan = {
      id: "a1", name: "Mökkilaina", lender: null, kind: "other", grantedCents: null, balanceCents: 4_200_000, balanceDate: "2026-08-31", rateBp: 410, reference: "fixed", marginBp: null,
      repayment: "equal_principal", intervalMonths: 3, paymentCents: 150_000, endDate: null, limitCents: null, seriesKey: "debt:made-up",
    };
    const form = formOfLoan(loan);
    const { id, ...body } = loan;
    expect(form.id).toBe(id);
    // a loan with no review day goes back with null: PUT replaces every field
    expect(readForm(form)).toEqual({ errors: {}, body: { ...body, rateReviewDate: null } });
  });
});

describe("the review day of the rate", () => {
  const mortgage = (reference: string) => {
    let form = setKind(emptyForm(TODAY), "mortgage");
    form = setValue(form, "balanceCents", "150 000");
    return setValue(setValue(form, "reference", reference), "rateReviewDate", "2027-03-14");
  };

  it("is a field after the margin, shown unless the rate is fixed", () => {
    for (const reference of ["", "euribor_12", "euribor_6", "euribor_3"]) {
      const shown = shownFields(mortgage(reference));
      expect(shown, reference).toContain("rateReviewDate");
      expect(shown.indexOf("rateReviewDate"), reference).toBe(shown.indexOf("marginBp") + 1);
    }
    expect(shownFields(setKind(emptyForm(TODAY), "mortgage"))).toContain("rateReviewDate");
    expect(shownFields(mortgage("fixed"))).not.toContain("rateReviewDate");
  });

  it("is sent as typed, and an empty field sends null", () => {
    expect(readForm(mortgage("euribor_12")).body).toMatchObject({ reference: "euribor_12", rateReviewDate: "2027-03-14" });
    expect(readForm(mortgage("")).body).toMatchObject({ reference: null, rateReviewDate: "2027-03-14" });
    expect(readForm(setValue(mortgage("euribor_12"), "rateReviewDate", "")).body).toMatchObject({ rateReviewDate: null });
    expect(readForm(setKind(emptyForm(TODAY), "mortgage")).errors).toEqual({ balanceCents: "Anna, paljonko lainaa on jäljellä." });
    expect(readForm(setValue(setKind(emptyForm(TODAY), "mortgage"), "balanceCents", "1 000")).body).toMatchObject({ rateReviewDate: null });
  });

  it("a fixed rate sends null whatever was typed, and the day comes back when the reference changes again", () => {
    const fixed = mortgage("fixed");
    expect(fixed.values.rateReviewDate).toBe("2027-03-14");
    expect(readForm(fixed).body).toMatchObject({ reference: "fixed", rateReviewDate: null });
    const back = setValue(fixed, "reference", "euribor_12");
    expect(readForm(back).body).toMatchObject({ reference: "euribor_12", rateReviewDate: "2027-03-14" });
  });

  it("a saved loan's day is in the form and goes back whole, and a fixed one's goes back as null", () => {
    const loan: Loan = {
      id: "a1", name: "Kotilaina", lender: "Esimerkkipankki Oyj", kind: "mortgage", grantedCents: 15_000_000, balanceCents: 12_000_000, balanceDate: "2026-09-30", rateBp: 339, reference: "euribor_12", marginBp: 65,
      repayment: "annuity", intervalMonths: 1, paymentCents: 68_920, endDate: "2046-10-31", limitCents: null, seriesKey: null, rateReviewDate: "2027-03-14",
    };
    const form = formOfLoan(loan);
    expect(form.values.rateReviewDate).toBe("2027-03-14");
    const { id: _id, ...body } = loan;
    expect(readForm(form)).toEqual({ errors: {}, body });
    expect(formOfLoan({ ...loan, rateReviewDate: null }).values.rateReviewDate).toBe("");
    expect(readForm(formOfLoan({ ...loan, reference: "fixed" })).body).toMatchObject({ reference: "fixed", rateReviewDate: null });
  });
});

describe("the payment and the way of paying back", () => {
  it("tells when a payment that holds the interest is under the interval's interest", () => {
    let form = setKind(emptyForm(TODAY), "mortgage");
    form = setValue(form, "balanceCents", "150 000");
    form = setValue(form, "rateBp", "3,40");
    form = setValue(form, "repayment", "annuity");
    form = setValue(form, "intervalMonths", "1");
    form = setValue(form, "paymentCents", "396,67");
    expect(interestOverPayment(form)).toBe(42_500);
    expect(interestOverPayment(setValue(form, "paymentCents", "425,00"))).toBeNull();
    expect(interestOverPayment(setValue(form, "paymentCents", ""))).toBeNull();
    // the interest of an equal-principal loan comes on top of the payment
    expect(interestOverPayment(setValue(form, "repayment", "equal_principal"))).toBeNull();
    expect(interestOverPayment(setValue(form, "intervalMonths", "3"))).toBe(127_500);
  });
});

describe("the link of a loan to a card or loan account", () => {
  const account = (id: string, name: string, type: Account["type"], over: Partial<Account> = {}): Account =>
    ({ id, userId: "u1", name, bankName: name, customName: null, holder: null, cardMask: null, creditLimitCents: null, iban: null, currency: "EUR", type, provider: "demo", connectionId: null, balanceCents: -100_000, balanceAt: TODAY, lastSyncedAt: null, ...over }) as Account;
  const saved = (id: string, accountId?: string): Loan => ({
    id, name: `Laina ${id}`, lender: "ESIMERKKIRAHOITUS OY", kind: "card", grantedCents: null, balanceCents: 100_000, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null,
    repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: 300_000, seriesKey: null, ...(accountId ? { accountId } : {}),
  });
  const accounts = [account("chk", "Käyttötili", "checking"), account("card", "Esimerkkikortti", "credit_card"), account("home", "Asuntolaina", "loan"), account("sav", "Säästötili", "savings")];

  it("offers the household's cards and loan accounts, and no other account", () => {
    expect(linkChoices(accounts, [], null).map((c) => c.id)).toEqual(["card", "home"]);
    expect(linkChoices([accounts[0]!, accounts[3]!], [], null)).toEqual([]);
  });

  it("does not offer an account another loan holds, but keeps the one the edited loan holds", () => {
    const loans = [saved("a", "card"), saved("b", "home")];
    expect(linkChoices(accounts, loans, null)).toEqual([]);
    expect(linkChoices(accounts, loans, "a").map((c) => c.id)).toEqual(["card"]);
    expect(linkChoices(accounts, loans, "b").map((c) => c.id)).toEqual(["home"]);
  });

  it("tells two accounts of one name apart by their kind and card number", () => {
    const twins = [account("c1", "Gold", "credit_card", { cardMask: "•••• 1234" }), account("c2", "Gold", "credit_card", { cardMask: "•••• 5678" }), account("l1", "Gold", "loan")];
    expect(linkChoices(twins, [], null).map((c) => c.label)).toEqual(["Gold (Luottokortti, •••• 1234)", "Gold (Luottokortti, •••• 5678)", "Gold (Laina)"]);
    expect(linkChoices(accounts, [], null).map((c) => c.label)).toEqual(["Esimerkkikortti", "Asuntolaina"]);
  });

  it("a saved loan's link is in its form and goes back with it, and a loan without one sends none", () => {
    const form = formOfLoan(saved("a", "card"));
    expect(form.accountId).toBe("card");
    expect(readForm(form).body).toMatchObject({ accountId: "card" });
    expect(formOfLoan(saved("b")).accountId).toBe("");
    expect("accountId" in readForm(formOfLoan(saved("b"))).body!).toBe(false);
    // letting go of the link: PUT replaces the loan, so the body leaves the field out
    expect("accountId" in readForm({ ...form, accountId: "" }).body!).toBe(false);
  });

  it("a typed form starts with no link", () => {
    expect(emptyForm(TODAY).accountId).toBe("");
    expect(typedForm().accountId).toBe("");
  });
});
