import type { HousingCharge, HousingLoan } from "@banking/core";
import { describe, expect, it } from "vitest";
import { DASH, housingView, LOAN_COLUMNS } from "../src/components/housing/housing.ts";
import type { DashboardData } from "../src/types.ts";

type Answer = NonNullable<DashboardData["housing"]>;

/** Spaces and no-break spaces as a reader sees them. */
const flat = (text: string): string => text.replace(/[\s  ]+/g, " ");
const answer = (over: Partial<Answer> = {}): Answer => ({ loans: [], charges: [], loansMonthlyCents: 0, chargesMonthlyCents: 0, totalMonthlyCents: 0, partial: false, atPart: false, ask: false, ...over });
/** A loan's row as the table draws it: the cells in the order of the columns, then the link that ends the row. */
const rowOf = (loan: HousingLoan) => housingView(answer({ loans: [loan] })).loans[0]!;
const cells = (loan: HousingLoan) => {
  const row = rowOf(loan);
  return LOAN_COLUMNS.map((c) => flat(row.cells[c.key]));
};

/** A saved mortgage with every term typed: the full state. */
const saved = (over: Partial<HousingLoan> = {}): HousingLoan => ({
  id: "loan-1",
  name: "Kodin laina",
  lender: "ESIMERKKIPANKKI OYJ",
  seriesId: null,
  monthlyCents: 91_240,
  next: { cents: 91_240, interestCents: 38_293, amortisationCents: 52_947, intervalMonths: 1, date: "2026-10-15", unknown: null },
  rateBp: 310,
  reference: "euribor_12",
  marginBp: 65,
  referenceBp: 245,
  reviewDate: "2027-03-14",
  reviewPassed: false,
  typedByOther: false,
  ...over,
});

/** Payments in the rows that no saved loan is behind. */
const paid = (over: Partial<HousingLoan> = {}): HousingLoan => ({
  id: null,
  name: null,
  lender: "ESIMERKKIPANKKI OYJ",
  seriesId: "out:acc-1:ESIMERKKIPANKKI OYJ#60000",
  monthlyCents: 60_000,
  next: null,
  rateBp: null,
  reference: null,
  marginBp: null,
  referenceBp: null,
  reviewDate: null,
  reviewPassed: false,
  typedByOther: false,
  ...over,
});

const charge = (seriesId: string, label: string | null, payee: string, monthlyCents: number): HousingCharge => ({ seriesId, label, payee, monthlyCents });
/** The viewer's 60 % of a joint account. */
const part = { from: 0, to: 3, of: 5 };
/** A next payment the plan cannot tell: the loan lacks a field. */
const untold = { cents: null, interestCents: null, amortisationCents: null, intervalMonths: 1, date: null, unknown: "rate" as const };

describe("the columns of the table Lainat", () => {
  it("are the heads of the statement, the three of the next payment under their group", () => {
    expect(LOAN_COLUMNS.map((c) => c.head)).toEqual(["Korko", "Viitekorko ja marginaali", "Koron tarkistuspäivä", "Eräpäivä", "Lyhennys", "Korko", "Kuukaudessa"]);
    expect(LOAN_COLUMNS.filter((c) => c.next).map((c) => c.key)).toEqual(["due", "amortisation", "interest"]);
  });
});

describe("the row of a saved loan", () => {
  it("tells the rate, the reference rate with the margin, the day the rate is set again, the next payment in its parts and the month, and ends with no link", () => {
    expect(cells(saved())).toEqual(["3,10 %", "12 kuukauden Euribor 2,45 % + 0,65 %", "14.3.2027", "15.10.", "529,47 €", "382,93 €", "912,40 €"]);
    expect(rowOf(saved())).toMatchObject({ name: "Kodin laina", lender: "ESIMERKKIPANKKI OYJ", saved: true, part: null, link: null });
  });

  it("names the other reference rates whole", () => {
    expect(cells(saved({ reference: "euribor_6", referenceBp: 250 }))[1]).toBe("6 kuukauden Euribor 2,50 % + 0,65 %");
    expect(cells(saved({ reference: "euribor_3", referenceBp: 200 }))[1]).toBe("3 kuukauden Euribor 2,00 % + 0,65 %");
  });

  it("has a dash for the reference rate and the margin until the loan names all of it, and the link to add the rest", () => {
    for (const lacking of [{ marginBp: null, referenceBp: null }, { reference: null, referenceBp: null }, { referenceBp: null }] as Partial<HousingLoan>[]) {
      const row = rowOf(saved(lacking));
      expect([row.cells.rate, row.cells.reference, row.link]).toEqual(["3,10 %", DASH, "Täydennä"]);
    }
  });

  it("tells a fixed rate as one: no day it is set again, even a day an earlier version kept, and nothing to add", () => {
    const row = rowOf(saved({ reference: "fixed", marginBp: null, referenceBp: null, reviewDate: "2027-03-14" }));
    expect([row.cells.rate, row.cells.reference, row.cells.review, row.link]).toEqual(["3,10 %", "Kiinteä", DASH, null]);
  });

  it("has a dash for a rate that is not known and does not make one up", () => {
    const row = rowOf(saved({ rateBp: null, marginBp: null, referenceBp: null, reference: null, reviewDate: null }));
    expect([row.cells.rate, row.cells.reference, row.cells.review, row.link]).toEqual([DASH, DASH, DASH, "Täydennä"]);
  });

  it("tells a rate of nought as a rate", () => {
    expect(cells(saved({ rateBp: 0, marginBp: 0, referenceBp: 0 })).slice(0, 2)).toEqual(["0,00 %", "12 kuukauden Euribor 0,00 % + 0,00 %"]);
    expect(rowOf(saved({ rateBp: 0, marginBp: 0, referenceBp: 0 })).link).toBeNull();
  });

  it("tells the day the rate is set again only while it is ahead: a day that has come is a dash to mend, and no later day is worked out", () => {
    expect([rowOf(saved({ reviewDate: "2026-10-13" })).cells.review, rowOf(saved({ reviewDate: "2026-10-13" })).link]).toEqual(["13.10.2026", null]);
    for (const reviewDate of ["2026-03-14", "2026-10-12"]) {
      const row = rowOf(saved({ reviewDate, reviewPassed: true }));
      expect([row.cells.review, row.link]).toEqual([DASH, "Täydennä"]);
    }
    expect([rowOf(saved({ reviewDate: null })).cells.review, rowOf(saved({ reviewDate: null })).link]).toEqual([DASH, "Täydennä"]);
  });

  it("tells each part of the next payment the plan has, and a dash to mend for one it lacks", () => {
    expect(cells(saved({ next: untold, monthlyCents: null })).slice(3)).toEqual([DASH, DASH, DASH, DASH]);
    expect(rowOf(saved({ next: untold, monthlyCents: null })).link).toBe("Täydennä");
    expect(cells(saved({ next: { ...untold, date: "2026-10-15" } })).slice(3)).toEqual(["15.10.", DASH, DASH, "912,40 €"]);
    expect(cells(saved({ next: { ...untold, date: "2026-10-15", amortisationCents: 52_947 } })).slice(3, 6)).toEqual(["15.10.", "529,47 €", DASH]);
    // a payment with no due date keeps its sums
    expect(cells(saved({ next: { ...saved().next!, date: null } })).slice(3)).toEqual([DASH, "529,47 €", "382,93 €", "912,40 €"]);
  });

  it("asks for nothing where nothing is due: the dashes of a loan with no next payment are not the viewer's to mend", () => {
    const row = rowOf(saved({ next: { ...untold, unknown: null }, monthlyCents: null }));
    expect([row.cells.due, row.cells.amortisation, row.cells.interest, row.cells.month, row.link]).toEqual([DASH, DASH, DASH, DASH, null]);
  });

  it("has no link on a loan another member typed in, whatever it lacks; the same loan of the viewer's own has one", () => {
    const lacking = { marginBp: null, referenceBp: null, reviewDate: null } as const;
    expect(rowOf(saved({ ...lacking, typedByOther: true })).link).toBeNull();
    expect(rowOf(saved({ ...lacking, typedByOther: true })).cells.reference).toBe(DASH);
    expect(rowOf(saved(lacking)).link).toBe("Täydennä");
  });

  it("says the viewer's part of a joint account under the name, and nothing on a row that is all theirs", () => {
    expect(flat(rowOf(saved({ part })).part!)).toBe("osuutesi 60 %");
    expect(rowOf(saved({ part: { from: 0, to: 1, of: 1 } })).part).toBeNull();
  });
});

describe("payments with no saved loan behind them", () => {
  it("are a row by the payee's name with the month, a dash for every term, and the link to add the loan", () => {
    const row = rowOf(paid());
    expect(row).toMatchObject({ name: "ESIMERKKIPANKKI OYJ", lender: null, saved: false, link: "Lisää laina" });
    expect(cells(paid())).toEqual([DASH, DASH, DASH, DASH, DASH, DASH, "600,00 €"]);
  });
});

describe("the rows", () => {
  const both = answer({
    loans: [saved(), paid()],
    charges: [charge("a", "Hoitovastike", "As Oy Esimerkkikatu 5", 28_600), { ...charge("b", null, "ESIMERKKIENERGIA OY", 6_130), part }],
    loansMonthlyCents: 151_240,
    chargesMonthlyCents: 34_730,
    totalMonthlyCents: 185_970,
  });

  it("are the loans and the charges in the order core gave; a charge is its kind, its payee and its month", () => {
    const view = housingView(both);
    expect(view.loans.map((r) => r.name)).toEqual(["Kodin laina", "ESIMERKKIPANKKI OYJ"]);
    expect(view.charges.map((r) => [r.kind, r.payee, r.part && flat(r.part), r.cents])).toEqual([
      ["Hoitovastike", "As Oy Esimerkkikatu 5", null, 28_600],
      // the words of the payment name no kind: a dash, and the payee stands in its own column
      [DASH, "ESIMERKKIENERGIA OY", "osuutesi 60 %", 6_130],
    ]);
  });

  it("has no two rows with one key", () => {
    const view = housingView(both);
    const keys = [...view.loans, ...view.charges].map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the sums", () => {
  const rent = charge("a", "Vuokra", "ESIMERKKI KIINTEISTOT OY", 80_000);

  it("are the answer's own three, not sums added up here", () => {
    const view = housingView(answer({ loans: [saved()], charges: [rent], loansMonthlyCents: 111, chargesMonthlyCents: 222, totalMonthlyCents: 333 }));
    expect(view.sums).toEqual([
      { label: "Lainojen maksuerät", cents: 111, total: false },
      { label: "Asumiskulut", cents: 222, total: false },
      { label: "Asuminen yhteensä kuukaudessa", cents: 333, total: true },
    ]);
    expect(view.missing).toBeNull();
  });

  it("are the total alone where the block has only loans or only charges, and none where it has no row", () => {
    expect(housingView(answer({ charges: [rent], chargesMonthlyCents: 80_000, totalMonthlyCents: 80_000 })).sums).toEqual([{ label: "Asuminen yhteensä kuukaudessa", cents: 80_000, total: true }]);
    expect(housingView(answer({ loans: [saved()], loansMonthlyCents: 91_240, totalMonthlyCents: 91_240 })).sums).toEqual([{ label: "Asuminen yhteensä kuukaudessa", cents: 91_240, total: true }]);
    expect(housingView(answer({ ask: true }))).toMatchObject({ ask: true, loans: [], charges: [], sums: [], missing: null });
  });

  it("say how many loans tell no payment, total what is known, and never show a sum no row tells as a zero", () => {
    const one = housingView(answer({ loans: [saved({ monthlyCents: null })], charges: [rent], chargesMonthlyCents: 80_000, totalMonthlyCents: 80_000, partial: true }));
    expect(one.sums.map((s) => s.cents)).toEqual([null, 80_000, 80_000]);
    expect(one.missing).toBe("Summasta puuttuu 1 lainan maksuerä.");
    const two = housingView(answer({ loans: [saved(), saved({ id: "loan-2", monthlyCents: null }), saved({ id: "loan-3", monthlyCents: null })], loansMonthlyCents: 91_240, totalMonthlyCents: 91_240, partial: true }));
    expect(two.sums).toEqual([{ label: "Asuminen yhteensä kuukaudessa", cents: 91_240, total: true }]);
    expect(two.missing).toBe("Summasta puuttuu 2 lainan maksuerä.");
    // the one loan of the block tells no payment: the total is not known, and is not a zero
    expect(housingView(answer({ loans: [saved({ monthlyCents: null })], partial: true })).sums).toEqual([{ label: "Asuminen yhteensä kuukaudessa", cents: null, total: true }]);
  });
});
