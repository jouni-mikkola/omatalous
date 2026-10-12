import { describe, expect, it } from "vitest";
import { type LoanTextOptions, parseLoanText } from "../../src/index.ts";
import { read, text, warned } from "./helpers.ts";

const one = (lines: string[], options?: LoanTextOptions) => {
  const drafts = parseLoanText(text(...lines), options);
  expect(drafts).toHaveLength(1);
  return drafts[0]!;
};

// A made-up annuity loan: 120 000 € at 3,39 % with 240 monthly payments left comes to about 689 € a month.
const ASOF = { asOf: "2026-10-12" };
const LOAN = ["Luoton saldo 120 000,00 €", "Kokonaiskorko 3,39 %", "Viimeinen eräpäivä 31.10.2046"];

describe("loan intake: cross-checks", () => {
  it("the rate is about the reference plus the margin", () => {
    const rates = (rate: string, reference = "12 kk Euribor 2,74 %") => one([`Kokonaiskorko ${rate}`, `Viitekorko ${reference}`, "Marginaali 0,65 %"]);
    expect(read(rates("3,39 %"))).toEqual({ rateBp: "339 sure", reference: "euribor_12 sure", marginBp: "65 sure" });
    expect(warned(rates("3,39 %"))).toEqual([]);
    // 3,387 = 2,737 + 0,65, each rounded to hundredths
    expect(warned(rates("3,387 %", "12 kk Euribor 2,737 %"))).toEqual([]);
    expect(warned(rates("3,44 %"))).toEqual([]);

    const off = rates("4,39 %");
    expect(read(off)).toEqual({ rateBp: "439 check", reference: "euribor_12 sure", marginBp: "65 check" });
    expect(off.warnings).toEqual([{ id: "rate_sum", text: "Kokonaiskorko ei ole viitekoron ja marginaalin summa. Tarkista korot.", fields: ["rateBp", "marginBp"] }]);
    expect(warned(rates("3,45 %"))).toEqual(["rate_sum"]);
  });

  it("the rate check needs the reference rate's own value, and takes it with or without a name", () => {
    expect(warned(one(["Kokonaiskorko 9,99 %", "Viitekorko 12 kk Euribor", "Marginaali 0,65 %"]))).toEqual([]);
    const unnamed = one(["Kokonaiskorko 4,39 %", "Viitekorko 2,74 %", "Marginaali 0,65 %"]);
    expect(read(unnamed)).toEqual({ rateBp: "439 check", marginBp: "65 check" });
    expect(warned(unnamed)).toEqual(["rate_sum"]);
    // a reference below zero
    expect(warned(one(["Kokonaiskorko 0,40 %", "Viitekorko 12 kk Euribor -0,25 %", "Marginaali 0,65 %"]))).toEqual([]);
    // a fixed rate is no sum
    expect(warned(one(["Kokonaiskorko 3,50 %", "Viitekorko Kiinteä 3,00 %", "Marginaali 0,00 %"]))).toEqual([]);
    // "Euribor + 0,65 %": that percentage is the margin, so there is no reference value to add up
    expect(warned(one(["Kokonaiskorko 3,39 %", "Viitekorko 12 kk Euribor + 0,65 %", "Marginaali 0,65 %"]))).toEqual([]);
  });

  it("a rate above 25 % is more likely a lost comma", () => {
    const high = one(["Kokonaiskorko 45 %"]);
    expect(read(high)).toEqual({ rateBp: "4500 check" });
    expect(high.warnings).toEqual([{ id: "rate_high", text: "Korko on yli 25 %. Tarkista pilkun paikka.", fields: ["rateBp"] }]);
    expect(warned(one(["Kokonaiskorko 25,00 %"]))).toEqual([]);
    expect(warned(one(["Kokonaiskorko 19,9 %"]))).toEqual([]);
  });

  it("a margin above 25 % is a lost comma too", () => {
    const high = one(["Marginaali 65 %"]);
    expect(read(high)).toEqual({ marginBp: "6500 check" });
    expect(high.warnings.map((w) => [w.id, w.fields])).toEqual([["rate_high", ["marginBp"]]]);
    expect(warned(one(["Marginaali 0,65 %"]))).toEqual([]);
  });

  it("the payment is about the annuity of the balance, the rate and the end date", () => {
    const paying = (payment: string) => one([...LOAN, `Kuukausierä ${payment}`], ASOF);
    expect(read(paying("689,20 €"))).toEqual({ balanceCents: "12000000 sure", rateBp: "339 sure", endDate: "2046-10-31 sure", paymentCents: "68920 sure" });
    for (const fine of ["689,20 €", "600,00 €", "780,00 €"]) expect(warned(paying(fine)), fine).toEqual([]);

    const off = paying("68,92 €");
    expect(read(off)).toEqual({ balanceCents: "12000000 check", rateBp: "339 check", endDate: "2046-10-31 check", paymentCents: "6892 check" });
    expect(off.warnings).toEqual([{ id: "payment_annuity", text: "Maksuerä ei vastaa jäljellä olevaa lainaa, korkoa ja viimeistä eräpäivää. Tarkista luvut.", fields: ["paymentCents", "balanceCents", "rateBp", "endDate"] }]);
    for (const wrong of ["6 892,00 €", "500,00 €", "1 000,00 €"]) expect(warned(paying(wrong)), wrong).toEqual(["payment_annuity"]);
  });

  it("the payment check takes its day from the balance's date or from asOf, and is silent without either", () => {
    const lines = [...LOAN, "Kuukausierä 68,92 €"];
    expect(warned(one(lines))).toEqual([]);
    expect(warned(one(lines, ASOF))).toEqual(["payment_annuity"]);
    expect(warned(one(["Luoton saldo 120 000,00 € (12.10.2026)", ...LOAN.slice(1), "Kuukausierä 68,92 €"]))).toEqual(["payment_annuity"]);
    // ten years on, 120 000 € over ten years is far more a month
    expect(warned(one([...LOAN, "Kuukausierä 689,20 €"], { asOf: "2036-10-12" }))).toEqual(["payment_annuity"]);
  });

  it("the payment check follows the way and the interval of paying back", () => {
    const paying = (extra: string[]) => warned(one([...LOAN, ...extra], ASOF));
    // quarterly: three months of interest and principal at a time
    expect(paying(["Lyhennysväli 3 kk", "Kuukausierä 2 071,70 €"])).toEqual([]);
    expect(paying(["Lyhennysväli 3 kk", "Kuukausierä 689,20 €"])).toEqual(["payment_annuity"]);
    // a bullet loan pays the interest only: 120 000 € at 3,39 % is 339 € a month
    expect(paying(["Lyhennystapa Kertalyhenteinen", "Kuukausierä 339,00 €"])).toEqual([]);
    expect(paying(["Lyhennystapa Kertalyhenteinen", "Kuukausierä 689,20 €"])).toEqual(["payment_annuity"]);
    // with no Lyhennystapa an equal-principal payment (500 € and 339 € of interest) explains the figure too
    expect(paying(["Kuukausierä 839,00 €"])).toEqual([]);
    expect(paying(["Lyhennystapa Annuiteetti", "Kuukausierä 839,00 €"])).toEqual(["payment_annuity"]);
  });

  it("an end date that has passed is a date to check", () => {
    const passed = one(["Luoton saldo 120 000,00 €", "Viimeinen eräpäivä 31.10.2016"], ASOF);
    expect(read(passed)).toEqual({ balanceCents: "12000000 sure", endDate: "2016-10-31 check" });
    expect(warned(passed)).toEqual(["end_passed"]);
    expect(warned(one(["Luoton saldo 120 000,00 €", "Viimeinen eräpäivä 31.10.2016"]))).toEqual([]);
  });
});

describe("loan intake: the payment of an equal-principal loan", () => {
  // The loan's paymentCents is the whole payment, except for tasalyhennys, where it is the amortisation alone.
  it("Lyhennys is the payment when the loan is paid in equal principal parts", () => {
    const draft = one(["Lyhennystapa: Tasalyhennys", "Lyhennys: 500,00 €", "Kuukausierä: 839,00 €"]);
    expect(read(draft)).toEqual({ repayment: "equal_principal sure", paymentCents: "50000 sure" });
    expect(draft.paymentCents!.line).toBe("Lyhennys: 500,00 €");
    expect(warned(draft)).toEqual([]);
    // the order of the rows does not matter
    expect(read(one(["Kuukausierä: 839,00 €", "Lyhennys: 500,00 €", "Lyhennystapa: Tasalyhennys"]))).toEqual({ repayment: "equal_principal sure", paymentCents: "50000 sure" });
  });

  it("a whole payment on an equal-principal loan stays, to check, with a warning", () => {
    const draft = one(["Lyhennystapa: Tasalyhennys", "Kuukausierä: 839,00 €"]);
    expect(read(draft)).toEqual({ repayment: "equal_principal sure", paymentCents: "83900 check" });
    expect(draft.warnings).toEqual([
      { id: "payment_whole", text: "Tasalyhennyslainan maksueräksi merkitään pelkkä lyhennys. Tekstin maksuerässä on korko mukana. Tarkista maksuerä.", fields: ["paymentCents"] },
    ]);
  });

  it("the draft says whether its payment is the whole payment or the amortisation alone", () => {
    expect(one(["Lyhennystapa: Tasalyhennys", "Lyhennys: 500,00 €", "Kuukausierä: 839,00 €"]).paymentKind).toBe("amortisation");
    // a whole payment stays whole on an equal-principal loan: the warning says the loan wants the other
    expect(one(["Lyhennystapa: Tasalyhennys", "Kuukausierä: 839,00 €"]).paymentKind).toBe("whole");
    expect(one(["Lyhennystapa: Annuiteetti", "Lyhennys: 350,10 €", "Kuukausierä: 689,20 €"]).paymentKind).toBe("whole");
    expect(one(["Kuukausierä: 689,20 €"]).paymentKind).toBe("whole");
    // no payment, nothing to say
    expect("paymentKind" in one(["Lyhennystapa: Annuiteetti", "Lyhennys: 350,10 €"])).toBe(false);
  });

  it("Lyhennys is no payment for any other loan", () => {
    expect(read(one(["Lyhennystapa: Annuiteetti", "Lyhennys: 350,10 €", "Kuukausierä: 689,20 €"]))).toEqual({ repayment: "annuity sure", paymentCents: "68920 sure" });
    expect(read(one(["Lyhennystapa: Annuiteetti", "Lyhennys: 350,10 €"]))).toEqual({ repayment: "annuity sure" });
    // the way of paying back is not in the text: Lyhennys may be a part of an annuity payment
    expect(read(one(["Luoton saldo 120 000,00 €", "Lyhennys: 350,10 €"]))).toEqual({ balanceCents: "12000000 sure" });
    expect(parseLoanText("Lyhennys: 350,10 €")).toEqual([]);
  });

  it("the payment is no surer than the way of paying back it rests on", () => {
    const draft = one(["Lyhennystapa: Tasalyhennys, lyhennysvapaa 6 kk", "Lyhennys: 500,00 €"]);
    expect(read(draft)).toEqual({ repayment: "equal_principal check", paymentCents: "50000 check" });
  });

  it("the amortisation is about the balance over the payments left, with no rate in it", () => {
    const paying = (extra: string[]) => one([...LOAN, "Lyhennystapa Tasalyhennys", ...extra], ASOF);
    // 120 000 € over 240 months
    expect(warned(paying(["Lyhennys 500,00 €"]))).toEqual([]);
    const off = paying(["Lyhennys 50,00 €"]);
    expect(read(off)).toEqual({ balanceCents: "12000000 check", rateBp: "339 sure", endDate: "2046-10-31 check", repayment: "equal_principal sure", paymentCents: "5000 check" });
    expect(off.warnings.map((w) => [w.id, w.fields])).toEqual([["payment_annuity", ["paymentCents", "balanceCents", "endDate"]]]);
    // a whole payment is judged as one: 500 € and 339 € of interest
    expect(warned(paying(["Kuukausierä 839,00 €"]))).toEqual(["payment_whole"]);
    expect(warned(paying(["Kuukausierä 83,90 €"]))).toEqual(["payment_whole", "payment_annuity"]);
  });
});
