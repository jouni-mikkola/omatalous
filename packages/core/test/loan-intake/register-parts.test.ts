import { describe, expect, it } from "vitest";
import { parseLoanText } from "../../src/index.ts";
import { read, text, warned } from "./helpers.ts";

// Made-up loans in the shape of the positive credit register's listing, with the labels that tell how the rate is set,
// the day the contract was made and the parts of the last payment.
const MORTGAGE = [
  "Esimerkkipankki Oyj",
  "Luoton tyyppi: Asuntolaina",
  "Luottosopimus tehty: 15.3.2021",
  "Myönnetty määrä: 150 000,00 €",
  "Luoton saldo: 120 000,00 € (30.9.2026)",
  "Kokonaiskorko: 3,39 %",
  "Koron tyyppi: Vaihtuva",
  "Koronmääräytymisjakso: 12 kk",
  "Marginaali: 0,65 %",
  "Lyhennystapa: Annuiteetti",
  "Lyhennysväli: 1 kk",
  "Kuukausierä: 687,00 €",
  "Viimeinen eräpäivä: 31.10.2046",
];
const LAST = ["Viimeisin maksutapahtuma: 15.9.2026", "Lyhennys: 348,00 €", "Korko: 339,00 €", "Muut luottokulut: 5,00 €"];

describe("loan intake: the register's rate, kind and last payment", () => {
  it("reads the kind, the contract day, the reference of a variable rate and the last payment's parts", () => {
    const [draft, ...more] = parseLoanText(text(...MORTGAGE, ...LAST));
    expect(more).toEqual([]);
    expect(draft!.kind).toBe("mortgage");
    expect(read(draft!)).toEqual({
      lender: "Esimerkkipankki Oyj check",
      contractDate: "2021-03-15 sure",
      grantedCents: "15000000 sure",
      balanceCents: "12000000 sure",
      balanceDate: "2026-09-30 check",
      rateBp: "339 sure",
      reference: "euribor_12 sure",
      marginBp: "65 sure",
      repayment: "annuity sure",
      intervalMonths: "1 sure",
      paymentCents: "68700 sure",
      endDate: "2046-10-31 sure",
      lastPayment: "[object Object] sure",
    });
    expect(draft!.lastPayment!.value).toEqual({ date: "2026-09-15", principalCents: 34800, interestCents: 33900, feeCents: 500 });
    expect(draft!.lastPayment!.line).toContain("15.9.2026");
    expect(warned(draft!)).toEqual([]);
  });

  it("reads the same rate parts whatever order the last payment prints them in", () => {
    const [draft] = parseLoanText(text(...MORTGAGE, "Viimeisin maksutapahtuma: 15.9.2026", "Muut luottokulut: 5,00 €", "Korko: 339,00 €", "Lyhennys: 348,00 €"));
    expect(draft!.lastPayment!.value).toEqual({ date: "2026-09-15", principalCents: 34800, interestCents: 33900, feeCents: 500 });
    expect(draft!.rateBp!.value).toBe(339);
  });

  it("takes the last payment's date and parts from the line below their labels", () => {
    const [draft] = parseLoanText(text(...MORTGAGE, "Viimeisin maksutapahtuma", "15.9.2026", "Lyhennys", "348,00 €", "Korko", "339,00 €", "Muut luottokulut", "5,00 €"));
    expect(draft!.lastPayment?.value).toEqual({ date: "2026-09-15", principalCents: 34800, interestCents: 33900, feeCents: 500 });
  });

  it("keeps a last payment with no other costs, at zero and to check", () => {
    const [draft] = parseLoanText(text(...MORTGAGE, ...LAST.slice(0, 3)));
    expect(draft!.lastPayment!.value).toEqual({ date: "2026-09-15", principalCents: 34800, interestCents: 33900, feeCents: 0 });
    expect(draft!.lastPayment!.confidence).toBe("check");
  });

  it("drops a last payment that lacks its date, its principal or its interest", () => {
    expect(parseLoanText(text(...MORTGAGE, "Lyhennys: 348,00 €"))[0]!.lastPayment).toBeUndefined();
    expect(parseLoanText(text(...MORTGAGE, ...LAST.filter((l) => !l.startsWith("Korko"))))[0]!.lastPayment).toBeUndefined();
    expect(parseLoanText(text(...MORTGAGE, ...LAST.slice(1)))[0]!.lastPayment).toBeUndefined();
  });

  it("lowers the payment and the last payment when the parts do not add up to the payment", () => {
    const [draft] = parseLoanText(text(...MORTGAGE.map((l) => (l.startsWith("Kuukausierä") ? "Kuukausierä: 760,00 €" : l)), ...LAST));
    expect(warned(draft!)).toContain("last_payment_sum");
    expect(draft!.paymentCents!.confidence).toBe("check");
    expect(draft!.lastPayment!.confidence).toBe("check");
  });

  it("accepts a payment with the other costs left out or put in", () => {
    const withFee = MORTGAGE.map((l) => (l.startsWith("Kuukausierä") ? "Kuukausierä: 692,00 €" : l));
    expect(warned(parseLoanText(text(...withFee, ...LAST))[0]!)).not.toContain("last_payment_sum");
  });

  it("checks an equal-principal loan's payment against the principal alone", () => {
    const loan = ["Esimerkkipankki Oyj", "Luoton saldo: 12 000,00 € (30.9.2026)", "Kokonaiskorko: 3,00 %", "Lyhennystapa: Tasalyhennys", "Lyhennys: 100,00 €", "Viimeinen eräpäivä: 31.8.2036"];
    // the loan's own Lyhennys comes before the label of the last payment, so the one after it is that payment's principal
    const [same] = parseLoanText(text(...loan, "Viimeisin maksutapahtuma: 15.9.2026", "Lyhennys: 100,00 €", "Korko: 30,00 €", "Muut luottokulut: 0,00 €"));
    expect(same!.paymentCents!.value).toBe(10000);
    expect(same!.lastPayment!.value).toEqual({ date: "2026-09-15", principalCents: 10000, interestCents: 3000, feeCents: 0 });
    expect(warned(same!)).toEqual([]);
    const [other] = parseLoanText(text(...loan, "Viimeisin maksutapahtuma: 15.9.2026", "Lyhennys: 150,00 €", "Korko: 30,00 €", "Muut luottokulut: 0,00 €"));
    expect(warned(other!)).toEqual(["last_payment_sum"]);
  });

  it("reads a fixed rate with no end day as fixed", () => {
    const [draft] = parseLoanText(text("Esimerkkipankki Oyj", "Luoton saldo: 90 000,00 €", "Kokonaiskorko: 4,10 %", "Koron tyyppi: Kiinteä"));
    expect(draft!.reference).toMatchObject({ value: "fixed", confidence: "sure" });
    expect(draft!.rateReviewDate).toBeUndefined();
  });

  it("reads a fixed rate that ends on a day as the period's Euribor, set again on that day", () => {
    const [draft] = parseLoanText(
      text("Esimerkkipankki Oyj", "Luoton saldo: 90 000,00 €", "Kokonaiskorko: 4,10 %", "Koron tyyppi: Kiinteä", "Koronmääräytymisjakso: 12 kk", "Kiinteän koron jakson loppupäivä: 31.12.2028"),
    );
    expect(draft!.reference).toMatchObject({ value: "euribor_12", confidence: "sure" });
    expect(draft!.rateReviewDate).toMatchObject({ value: "2028-12-31", confidence: "sure" });
  });

  it("reads the months of a period as 3, 6 or 12 and nothing else", () => {
    const refs = ["3 kk", "6 kk", "12 kk", "1 kk", "Euribor 6 kk"].map((period) => parseLoanText(text("Esimerkkipankki Oyj", "Luoton saldo: 90 000,00 €", `Koronmääräytymisjakso: ${period}`))[0]!.reference?.value);
    expect(refs).toEqual(["euribor_3", "euribor_6", "euribor_12", undefined, "euribor_6"]);
  });

  it("leaves a reference the text names itself alone", () => {
    const [draft] = parseLoanText(text("Esimerkkipankki Oyj", "Luoton saldo: 90 000,00 €", "Viitekorko: 6 kk Euribor 2,50 %", "Koron tyyppi: Vaihtuva", "Koronmääräytymisjakso: 12 kk"));
    expect(draft!.reference!.value).toBe("euribor_6");
  });

  it("reads the kind from the value of the type label, beside it or below it", () => {
    const kinds = ["Asuntolaina", "Opintolaina", "Kulutusluotto", "Autolaina", "Joustoluotto", "Luottokortti", "Osamaksu"].map((type) => parseLoanText(text("Esimerkkipankki Oyj", `Luoton tyyppi: ${type}`, "Luoton saldo: 1 000,00 €"))[0]!.kind);
    expect(kinds).toEqual(["mortgage", "student", "consumer", "car", "credit_line", "card", "instalment"]);
    expect(parseLoanText(text("Esimerkkipankki Oyj", "Luoton tyyppi", "Kulutusluotto", "Luoton saldo: 1 000,00 €"))[0]!.kind).toBe("consumer");
  });

  it("gives no kind for a type that names none or two", () => {
    const type = (value: string) => parseLoanText(text("Esimerkkipankki Oyj", `Luoton tyyppi: ${value}`, "Luoton saldo: 1 000,00 €"))[0]!.kind;
    expect(type("Kertaluotto")).toBeUndefined();
    expect(type("Asuntolaina ja kulutusluotto")).toBeUndefined();
  });

  it("maps every way of repayment, a balloon to a fixed instalment and an unknown one to nothing", () => {
    const way = (value: string) => parseLoanText(text("Esimerkkipankki Oyj", "Luoton saldo: 1 000,00 €", `Lyhennystapa: ${value}`))[0]!.repayment?.value;
    expect([way("Annuiteetti"), way("Tasalyhennys"), way("Kiinteä tasaerä"), way("Bullet"), way("Balloon"), way("Muu")]).toEqual(["annuity", "equal_principal", "fixed_instalment", "bullet", "fixed_instalment", undefined]);
  });

  it("reads several loans of one paste, each with its own last payment", () => {
    const second = [
      "Mallirahoitus Bank AB",
      "Luoton tyyppi: Kulutusluotto",
      "Luoton saldo: 8 000,00 € (30.9.2026)",
      "Kokonaiskorko: 7,50 %",
      "Koron tyyppi: Kiinteä",
      "Lyhennystapa: Annuiteetti",
      "Viimeisin maksutapahtuma: 1.9.2026",
      "Lyhennys: 150,00 €",
      "Korko: 50,00 €",
      "Muut luottokulut: 0,00 €",
    ];
    const drafts = parseLoanText(text(...MORTGAGE, ...LAST, "", ...second));
    expect(drafts.map((d) => d.kind)).toEqual(["mortgage", "consumer"]);
    expect(drafts.map((d) => d.lender!.value)).toEqual(["Esimerkkipankki Oyj", "Mallirahoitus Bank AB"]);
    expect(drafts[0]!.lastPayment!.value.principalCents).toBe(34800);
    expect(drafts[1]!.lastPayment!.value).toEqual({ date: "2026-09-01", principalCents: 15000, interestCents: 5000, feeCents: 0 });
    expect(drafts[1]!.reference!.value).toBe("fixed");
    expect(drafts[0]!.reference!.value).toBe("euribor_12");
  });

  it("reads Nostettu määrä as the granted sum only when no Myönnetty määrä says it", () => {
    const [alone] = parseLoanText(text("Esimerkkipankki Oyj", "Nostettu määrä: 150 000,00 €", "Luoton saldo: 120 000,00 €"));
    expect(alone!.grantedCents).toMatchObject({ value: 15000000, confidence: "check" });
    const [both] = parseLoanText(text("Esimerkkipankki Oyj", "Myönnetty määrä: 150 000,00 €", "Nostettu määrä: 140 000,00 €", "Luoton saldo: 120 000,00 €"));
    expect(both!.grantedCents).toMatchObject({ value: 15000000, confidence: "sure" });
    expect(warned(both!)).toEqual([]);
  });

  it("marks every field to check for a text read from a picture", () => {
    const [draft] = parseLoanText(text(...MORTGAGE, ...LAST), { source: "ocr" });
    const fields = (Object.values(draft!) as unknown[]).filter((value): value is { confidence: string } => typeof value === "object" && !Array.isArray(value));
    expect(fields.length).toBeGreaterThan(10);
    expect(fields.map((f) => f.confidence)).toEqual(fields.map(() => "check"));
  });
});
