import { type Loan, parseLoanText } from "@banking/core";
import { describe, expect, it } from "vitest";
import "@banking/core/english";
import "@banking/core/late";
import { checksLeft, emptyForm, formOfDraft, formOfLoan, markOf, matchedLoan, readForm, setKind, setValue, toggleConfirmed } from "../src/components/loans/form.ts";

const TODAY = "2026-10-12";

// A made-up listing: one loan with a payment, a lender on a line of its own, no margin.
const LISTING = ["Esimerkkipankki Oyj", "Luoton tyyppi: Kertaluotto", "Myönnetty määrä: 150 000,00 €", "Luoton saldo: 120 000,00 € (30.9.2026)", "Kokonaiskorko: 3,39 %", "Lyhennystapa: Annuiteetti", "Lyhennysväli: 1 kk", "Kuukausierä: 689,20 €", "Viimeinen eräpäivä: 31.10.2046"].join("\n");
const draft = (text = LISTING) => parseLoanText(text, { asOf: TODAY })[0]!;

const saved = (over: Partial<Loan> = {}): Loan =>
  ({ id: "l1", name: "Kodin laina", kind: "mortgage", lender: "Esimerkkipankki Oyj", grantedCents: 15_000_000, balanceCents: 11_000_000, balanceDate: "2026-08-31", rateBp: 300, reference: null, marginBp: null, rateReviewDate: null, repayment: "annuity", intervalMonths: 1, paymentCents: 60_000, endDate: "2046-10-31", limitCents: null, seriesKey: null, accountId: null, ...over }) as Loan;

describe("a read draft as a form", () => {
  it("puts the read instalment in the loan's payment and keeps the line each value came from", () => {
    const form = formOfDraft(draft(), TODAY);
    expect(form.values.paymentCents).toBe("689,20");
    expect(form.values.grantedCents).toBe("150 000,00");
    expect(form.values.balanceDate).toBe("2026-09-30");
    expect(form.source?.lines.paymentCents).toBe("Kuukausierä: 689,20 €");
  });

  it("leaves a field the text lacks empty and marked missing, never zero", () => {
    const form = formOfDraft(draft("Luoton saldo: 120 000,00 €"), TODAY);
    expect(form.values.grantedCents).toBe("");
    expect(form.values.marginBp).toBe("");
    expect(markOf(form, "marginBp")).toBe("missing");
    expect(markOf(form, "balanceCents")).toBe("sure");
    // no date beside the balance: today, marked missing so the household sets it
    expect(form.values.balanceDate).toBe(TODAY);
    expect(markOf(form, "balanceDate")).toBe("missing");
  });

  it("blocks the save while a field is to check, and lets it through once each is confirmed or changed", () => {
    let form = setKind(formOfDraft(draft(), TODAY), "mortgage");
    const left = checksLeft(form);
    expect(left).toContain("lender");
    for (const key of left.filter((k) => k !== "lender")) form = toggleConfirmed(form, key, true);
    expect(checksLeft(form)).toEqual(["lender"]);
    form = setValue(form, "lender", "Esimerkkipankki Oyj");
    expect(checksLeft(form)).toEqual([]);
  });

  it("sends the read payment as the loan's payment", () => {
    const form = setKind(formOfDraft(draft(), TODAY), "mortgage");
    expect(readForm(form).body).toMatchObject({ paymentCents: 68_920, grantedCents: 15_000_000, balanceCents: 12_000_000, repayment: "annuity" });
  });

  it("reads into a saved loan's form: its name, series and account stay, a field the text lacks keeps its value, a field it has wins", () => {
    const base = formOfLoan(saved({ seriesKey: "series:x", accountId: "a1", marginBp: 65, name: "Oma nimi" }));
    const form = formOfDraft(draft("Luoton saldo: 120 000,00 €"), TODAY, base);
    expect(form.name).toBe("Oma nimi");
    expect(form.seriesKey).toBe("series:x");
    expect(form.accountId).toBe("a1");
    expect(form.values.marginBp).toBe("0,65");
    expect(form.values.balanceCents).toBe("120 000,00");
    expect(markOf(form, "marginBp")).toBeNull();
  });
});

describe("the saved loan a read loan is the same debt as", () => {
  it("is the one of the same lender words and granted amount, whatever the case and punctuation", () => {
    const form = formOfDraft(draft(), TODAY);
    expect(matchedLoan(form, [saved({ lender: "ESIMERKKIPANKKI Oyj." })])?.id).toBe("l1");
    expect(matchedLoan(form, [saved({ grantedCents: 10_000_000 })])).toBeNull();
    expect(matchedLoan(form, [saved(), saved({ id: "l2" })])).toBeNull();
    expect(matchedLoan(emptyForm(TODAY), [saved()])).toBeNull();
  });
});
