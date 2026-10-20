import { describe, expect, it } from "vitest";
import { parseLoanText } from "../../src/index.ts";
import { read, text, warned } from "./helpers.ts";

// A bank's "Lainan tiedot" dialog and a flexible credit's page, as text recognition gives them, artefacts included: the
// close button as "X", a copy icon as "[", an info icon as "O" after "Velkoja", "®" after the lender, and two values that
// stand on the line above their label. Every name, number and sum here is made up.
const DIALOG = text(
  "Lainan tiedot X",
  "Lainan numero 123456-7890123 [ Kopioi",
  "Myönnetty 185 000,00",
  "Pääomaa maksamatta 171 240,55",
  "Pääomaa maksettu 13 759,45",
  "Nostettu yhteensä 185 000,00",
  "Nostamaton määrä yhteensä 0,00",
  "Ensimmäinen nostopäivä 14.3.2022",
  "",
  "MEIKÄLÄINEN MATTI OLAVI",
  "Velallinen / yhteisvastuullinen velallinen ESIMERKKI ELISA MARIA",
  "Valuutta EUR",
  "Nordea Kiinnitysluottopankki®",
  "Velkoja O",
  "Maksuohjelma",
  "Lyhennys 301,77",
  "Käytettävissä oleva LyhennysJousto 9 120,00",
  "Lyhennysväli 1 kuukausi",
  "Koronmaksuväli 1 kuukausi",
  "Lyhennystyyppi Annuiteetti",
  "Seuraava koron erääntymispäivä 16.10.2026",
  "Seuraava maksupäivä 16.10.2026",
  "Viimeinen lyhennys 14.3.2052",
  "Maksuerien lukumäärä 360",
);

// the page behind the dialog: a figure over its caption, the card of the next payment, the rate, the table of earlier payments
const PAGE_ABOVE = text("Asuntolaina", "13 759,45", "Maksettu yhteensä", "171 240,55", "Maksamatta", "Seuraava maksu 742,10", "16.10.2026", "Korko 440,33", "Korko 3,085%");
const PAGE_BELOW = text("Aiemmat maksut", "Päivämäärä Lyhennys Yhteensä", "16.9.2026 300,12 742,10 Tiedot", "16.8.2026 298,70 742,10 Tiedot", "Hallinnoi lainaa");

const CREDIT = text(
  "Joustoluotto",
  "7 300,00",
  "Maksettu yhteensä",
  "2 700,00",
  "Maksamatta",
  "Seuraava maksu 250,00",
  "16.10.2026",
  "Korko 19,40",
  "Korko 8,400%",
  "Tiedot",
  "Lainan numero 654321-12345678 Kopioi",
  "Pääomaa maksamatta 2 700,00",
  "Pääomaa maksettu 7 300,00",
  "Nostettu yhteensä 10 000,00",
  "Nostamaton määrä yhteensä 0,00",
  "Velallinen / yhteisvastuullinen velallinen MEIKÄLÄINEN MATTI OLAVI",
  "Valuutta EUR",
  "Maksuohjelma",
  "Lyhennys 230,60",
  "Lyhennys vähintään 2,00%",
  "Lyhennysväli 1 kuukausi",
  "Koronmaksuväli 1 kuukausi",
  "Lyhennystyyppi Tasalyhennys",
  "Seuraava koron erääntymispäivä 16.10.2026",
  "Seuraava maksupäivä 16.10.2026",
);

const DIALOG_FIELDS = {
  grantedCents: "18500000 sure",
  balanceCents: "17124055 sure",
  lender: "Nordea Kiinnitysluottopankki check",
  intervalMonths: "1 sure",
  repayment: "annuity sure",
  endDate: "2052-03-14 sure",
  // no "Seuraava maksu": the amortisation alone is what the text gives of the payment
  paymentCents: "30177 check",
};
const ASOF = { asOf: "2026-10-12" } as const;

describe("loan intake: a bank's Lainan tiedot dialog", () => {
  it("reads the sum left, the granted sum, the lender from the line above Velkoja, the way of repayment and the last day", () => {
    const drafts = parseLoanText(DIALOG, ASOF);
    expect(drafts.map(read)).toEqual([DIALOG_FIELDS]);
    expect(drafts.map(warned)).toEqual([[]]);
    const [draft] = drafts;
    expect(draft!.paymentKind).toBe("amortisation");
    // the kind comes from the lender's name: it lends against homes
    expect(draft!.kind).toBe("mortgage");
    // the lender's line is shown with its label, and the mark of the trade name is no part of the name
    expect(draft!.lender!.line).toBe("Nordea Kiinnitysluottopankki® Velkoja O");
    expect(draft!.balanceCents!.line).toBe("Pääomaa maksamatta 171 240,55");
  });

  it("with the page lines before and after it, the page gives the heading's kind, the rate and the whole payment", () => {
    const [draft, ...others] = parseLoanText(text(PAGE_ABOVE, DIALOG, PAGE_BELOW), ASOF);
    expect(others).toEqual([]);
    expect(read(draft!)).toEqual({ ...DIALOG_FIELDS, rateBp: "309 check", paymentCents: "74210 sure" });
    expect(draft!.paymentKind).toBe("whole");
    expect(draft!.kind).toBe("mortgage");
    expect(draft!.warnings).toEqual([]);
    // the page lines in the middle of the dialog's, on either side of it
    expect(read(parseLoanText(text(DIALOG, PAGE_BELOW), ASOF)[0]!)).toEqual(DIALOG_FIELDS);
    expect(read(parseLoanText(text(PAGE_ABOVE, DIALOG), ASOF)[0]!)).toEqual({ ...DIALOG_FIELDS, rateBp: "309 check", paymentCents: "74210 sure" });
  });

  it("the lender is read when the recognition makes the mark after its name a glued o (a picture at device scale 1)", () => {
    const drafts = parseLoanText(DIALOG.replace("pankki®", "pankkio"), ASOF);
    expect(drafts.map(read)).toEqual([DIALOG_FIELDS]);
    expect(drafts[0]!.kind).toBe("mortgage");
    // an o that is no mark stays: one of its own, or one that ends no line
    expect(parseLoanText(text("Esimerkkipankki o", "Velkoja", "Lainaa jäljellä 5 000,00"), ASOF)[0]?.lender?.value).toBe("Esimerkkipankki o");
    expect(parseLoanText(text("Esimerkkipankkio Oy", "Velkoja", "Lainaa jäljellä 5 000,00"), ASOF)[0]?.lender?.value).toBe("Esimerkkipankkio Oy");
  });

  it("nothing read from a picture is sure", () => {
    const [draft] = parseLoanText(DIALOG, { ...ASOF, source: "ocr" });
    expect(Object.values(read(draft!)).every((value) => value.endsWith(" check"))).toBe(true);
  });

  it("the sum left comes from the figure over Maksamatta, to check, and the dialog's own label makes it sure", () => {
    expect(parseLoanText(text("171 240,55", "Maksamatta")).map(read)).toEqual([{ balanceCents: "17124055 check" }]);
    expect(parseLoanText(text(PAGE_ABOVE)).map(read)).toEqual([{ balanceCents: "17124055 check", paymentCents: "74210 sure", rateBp: "309 check" }]);
    expect(parseLoanText(text(PAGE_ABOVE, "Pääomaa maksamatta 171 240,55")).map((d) => read(d).balanceCents)).toEqual(["17124055 sure"]);
  });

  it("a figure above its label counts only when the label's own line has no value", () => {
    expect(parseLoanText(text("171 240,55", "Maksamatta 12 000,00")).map(read)).toEqual([{ balanceCents: "1200000 check" }]);
    // a label with a value of another kind on its line: the figure above is not a stand-in
    expect(parseLoanText(text("171 240,55", "Maksamatta 14.3.2052"))).toEqual([]);
    // a figure above a label that is no caption under a figure is no value
    expect(parseLoanText(text("171 240,55", "Lyhennystyyppi Annuiteetti")).map(read)).toEqual([{ repayment: "annuity sure" }]);
    expect(parseLoanText(text("171 240,55", "Myönnetty"))).toEqual([]);
    // nor is a line that is not a figure
    expect(parseLoanText(text("Pääomaa maksettu", "Maksamatta"))).toEqual([]);
  });

  it("the lender is the name over Velkoja, only when the label has no name of its own and the line above is a lender", () => {
    const fields = (lines: string[]) => parseLoanText(text(...lines, "Pääomaa maksamatta 5 000,00")).map(read);
    expect(fields(["Esimerkkipankki Oyj", "Velkoja"])).toEqual([{ lender: "Esimerkkipankki Oyj check", balanceCents: "500000 sure" }]);
    // a lone letter or a sign after the label is an icon, never a value: "®" and "™" go
    for (const icon of ["O", "®", "™", "(i)", "(©)", "6)", "@", "i", ""]) expect(fields(["Esimerkkipankki Oyj®", `Velkoja ${icon}`]), icon).toEqual([{ lender: "Esimerkkipankki Oyj check", balanceCents: "500000 sure" }]);
    // OCR can make the "®" of the name an "&" or a "*"; one inside a name stays
    for (const mark of ["&", "*", "®"]) expect(fields([`Esimerkkipankki Oyj${mark}`, "Velkoja O"]), mark).toEqual([{ lender: "Esimerkkipankki Oyj check", balanceCents: "500000 sure" }]);
    expect(fields(["Esimerkki & Mallirahoitus Oy", "Velkoja O"])).toEqual([{ lender: "Esimerkki & Mallirahoitus Oy check", balanceCents: "500000 sure" }]);
    // the label's own name wins over the line above
    expect(fields(["Esimerkkipankki Oyj", "Velkoja Mallirahoitus Oy"])).toEqual([{ lender: "Mallirahoitus Oy sure", balanceCents: "500000 sure" }]);
    // a line above that is no lender gives none, and an icon alone is no lender
    for (const above of ["Lainan tiedot X", "MEIKÄLÄINEN MATTI OLAVI", "Velallinen / yhteisvastuullinen velallinen ESIMERKKI ELISA MARIA", "Valuutta EUR"]) expect(fields([above, "Velkoja O"]), above).toEqual([{ balanceCents: "500000 sure" }]);
    expect(fields(["Velkoja O"])).toEqual([{ balanceCents: "500000 sure" }]);
    // two letters are a name
    expect(fields(["Esimerkkipankki Oyj", "Velkoja Ab"])).toEqual([{ lender: "Ab sure", balanceCents: "500000 sure" }]);
  });

  it("the lender in the middle of a loan's lines is that loan's, and a second loan's lender starts the next", () => {
    const [first, second, ...rest] = parseLoanText(text("Pääomaa maksamatta 5 000,00", "Esimerkkipankki Oyj", "Velkoja O", "Pääomaa maksamatta 7 000,00", "Mallirahoitus Oy", "Velkoja O"));
    expect(rest).toEqual([]);
    expect(read(first!)).toEqual({ balanceCents: "500000 sure", lender: "Esimerkkipankki Oyj check" });
    expect(read(second!)).toEqual({ balanceCents: "700000 sure", lender: "Mallirahoitus Oy check" });
  });

  it("the kind comes from the heading, and the heading alone is no loan", () => {
    const kinds = (lines: string[]) => parseLoanText(text(...lines)).map((d) => d.kind ?? null);
    expect(kinds(["Asuntolaina", "Pääomaa maksamatta 5 000,00"])).toEqual(["mortgage"]);
    expect(kinds(["Joustoluotto", "Pääomaa maksamatta 5 000,00"])).toEqual(["credit_line"]);
    expect(kinds(["Esimerkki Kiinnitysluottopankki Oyj", "Pääomaa maksamatta 5 000,00"])).toEqual(["mortgage"]);
    expect(kinds(["Esimerkkipankki Oyj", "Pääomaa maksamatta 5 000,00"])).toEqual([null]);
    // a heading is the whole line: a sentence that holds the word is none
    expect(kinds(["Asuntolaina on myönnetty vuonna 2022", "Pääomaa maksamatta 5 000,00"])).toEqual([null]);
    expect(parseLoanText("Asuntolaina")).toEqual([]);
    expect(parseLoanText("Esimerkki Kiinnitysluottopankki Oyj")).toEqual([]);
    // the heading stands for the loan under it, and another heading after figures is the next loan
    expect(kinds(["Asuntolaina", "Pääomaa maksamatta 5 000,00", "Joustoluotto", "Pääomaa maksamatta 700,00"])).toEqual(["mortgage", "credit_line"]);
  });

  it("a lender that names a heading's kind does not change it", () => {
    expect(parseLoanText(text("Joustoluotto", "Esimerkki Kiinnitysluottopankki Oyj", "Velkoja O", "Pääomaa maksamatta 5 000,00")).map((d) => d.kind)).toEqual(["credit_line"]);
  });

  it("Seuraava maksu is the whole payment, and the next day and the first day are no field", () => {
    expect(parseLoanText(text("Seuraava maksu 742,10", "Pääomaa maksamatta 5 000,00")).map(read)).toEqual([{ paymentCents: "74210 sure", balanceCents: "500000 sure" }]);
    // the days of the dialog have no field in the draft
    expect(parseLoanText(text("Seuraava maksupäivä 16.10.2026", "Seuraava koron erääntymispäivä 16.10.2026", "Ensimmäinen nostopäivä 14.3.2022"))).toEqual([]);
  });

  it("the amortisation alone is the payment of a loan paid another way only when the way and the balance were read too", () => {
    const rows = (...lines: string[]) => parseLoanText(text(...lines)).map((d) => [read(d), d.paymentKind]);
    expect(rows("Lyhennystyyppi Annuiteetti", "Pääomaa maksamatta 5 000,00", "Lyhennys 301,77")).toEqual([[{ repayment: "annuity sure", balanceCents: "500000 sure", paymentCents: "30177 check" }, "amortisation"]]);
    // a whole payment in the text is the payment
    expect(rows("Lyhennystyyppi Annuiteetti", "Pääomaa maksamatta 5 000,00", "Lyhennys 301,77", "Seuraava maksu 742,10")).toEqual([[{ repayment: "annuity sure", balanceCents: "500000 sure", paymentCents: "74210 sure" }, "whole"]]);
    // near misses: no balance, no way of paying back
    expect(rows("Lyhennystyyppi Annuiteetti", "Lyhennys 301,77")).toEqual([[{ repayment: "annuity sure" }, undefined]]);
    expect(rows("Pääomaa maksamatta 5 000,00", "Lyhennys 301,77")).toEqual([[{ balanceCents: "500000 sure" }, undefined]]);
  });
});

describe("loan intake: what the dialog and the page print that is no value of the loan", () => {
  const without = (extra: string, field: string) => {
    const [draft] = parseLoanText(text("Pääomaa maksamatta 5 000,00", extra));
    expect(draft, extra).toBeDefined();
    expect(Object.keys(read(draft!)), extra).not.toContain(field);
  };

  it("Korko 440,33 is interest in euros and no rate", () => {
    without("Korko 440,33", "rateBp");
    // the card of the next payment: the interest is no rate, and the rate with its sign is
    expect(parseLoanText(text("Seuraava maksu 742,10", "16.10.2026", "Korko 440,33", "Pääomaa maksamatta 5 000,00")).map((d) => d.rateBp)).toEqual([undefined]);
  });

  it("a number with no percent sign under Korko gives way to the rate with its sign, in either order and as one loan", () => {
    for (const lines of [["Korko 19,40", "Korko 8,400%"], ["Korko 8,400%", "Korko 19,40"]]) {
      const drafts = parseLoanText(text("Pääomaa maksamatta 5 000,00", ...lines));
      expect(drafts.map((d) => [read(d), warned(d)]), lines.join(" / ")).toEqual([[{ balanceCents: "500000 sure", rateBp: "840 check" }, []]]);
    }
    // near miss: a rate with no sign and nothing else is still read, to check
    expect(parseLoanText("Korko 4,11").map(read)).toEqual([{ rateBp: "411 check" }]);
  });

  it("Lyhennys vähintään 2,00% is no rate and no amortisation", () => {
    const [draft] = parseLoanText(text("Lyhennystyyppi Tasalyhennys", "Pääomaa maksamatta 5 000,00", "Lyhennys 230,60", "Lyhennys vähintään 2,00%"));
    expect(read(draft!)).toEqual({ repayment: "equal_principal sure", balanceCents: "500000 sure", paymentCents: "23060 sure" });
    expect(parseLoanText(text("Pääomaa maksamatta 5 000,00", "Lyhennys vähintään 2,00%")).map(read)).toEqual([{ balanceCents: "500000 sure" }]);
  });

  it("Käytettävissä oleva LyhennysJousto is neither a limit nor the sum left", () => {
    expect(parseLoanText("Käytettävissä oleva LyhennysJousto 9 120,00")).toEqual([]);
    without("Käytettävissä oleva LyhennysJousto 9 120,00", "limitCents");
    expect(parseLoanText(text("Käytettävissä oleva LyhennysJousto 9 120,00", "Pääomaa maksamatta 5 000,00")).map(read)).toEqual([{ balanceCents: "500000 sure" }]);
  });

  it("Nostamaton määrä yhteensä and Pääomaa maksettu are not the sum left, and Nostettu yhteensä is the granted sum only as the last resort", () => {
    expect(parseLoanText(text("Nostamaton määrä yhteensä 0,00", "Pääomaa maksettu 13 759,45"))).toEqual([]);
    expect(parseLoanText(text("Nostettu yhteensä 185 000,00", "Nostamaton määrä yhteensä 0,00", "Pääomaa maksettu 13 759,45")).map(read)).toEqual([{ grantedCents: "18500000 check" }]);
    // the granted sum of the loan stays over the drawn total, whichever comes first; the drawn total never doubts it
    const both = (a: string, b: string) => parseLoanText(text(a, b)).map((d) => [read(d), warned(d)]);
    expect(both("Myönnetty 200 000,00", "Nostettu yhteensä 185 000,00")).toEqual([[{ grantedCents: "20000000 sure" }, []]]);
    // read first, it differs from the granted sum that follows: the household is told of two values
    expect(both("Nostettu yhteensä 185 000,00", "Myönnetty 200 000,00")).toEqual([[{ grantedCents: "20000000 check" }, ["two_values"]]]);
  });

  it("Maksuerien lukumäärä 360 is no money, and the number of the loan is no money and no date", () => {
    expect(parseLoanText("Maksuerien lukumäärä 360")).toEqual([]);
    expect(parseLoanText("Lainan numero 123456-7890123 [ Kopioi")).toEqual([]);
    expect(parseLoanText("Lainan numero 654321-12345678 Kopioi")).toEqual([]);
    const values = parseLoanText(DIALOG).flatMap((d) => Object.values(read(d)));
    expect(values.join(" ")).not.toMatch(/360|123456|7890123|^36000/);
  });

  it("a person's name goes into no field, not the debtors' lines and not the loan's name", () => {
    expect(parseLoanText(text("MEIKÄLÄINEN MATTI OLAVI", "Velallinen / yhteisvastuullinen velallinen ESIMERKKI ELISA MARIA"))).toEqual([]);
    for (const view of [DIALOG, CREDIT, text(PAGE_ABOVE, DIALOG, PAGE_BELOW)]) {
      for (const draft of parseLoanText(view, ASOF)) expect(JSON.stringify(draft)).not.toMatch(/MEIKÄLÄINEN|ESIMERKKI|MATTI|ELISA|OLAVI/);
    }
    // not as a lender over Velkoja either
    expect(parseLoanText(text("MEIKÄLÄINEN MATTI OLAVI", "Velkoja O", "Pääomaa maksamatta 5 000,00")).map(read)).toEqual([{ balanceCents: "500000 sure" }]);
  });

  it("a row of the table of earlier payments is not the payment when Seuraava maksu is there", () => {
    const layouts = [
      ["Aiemmat maksut", "Päivämäärä Lyhennys Yhteensä", "16.9.2026 300,12 742,10 Tiedot", "16.8.2026 298,70 742,10 Tiedot"],
      ["Aiemmat maksut", "Päivämäärä", "Lyhennys", "Yhteensä", "16.9.2026 300,12 742,10 Tiedot", "16.8.2026 298,70 742,10 Tiedot"],
      ["Aiemmat maksut", "Päivämäärä", "Lyhennys", "Yhteensä", "16.9.2026", "300,12", "742,10", "Tiedot"],
    ];
    for (const rows of layouts) {
      const drafts = parseLoanText(text("Pääomaa maksamatta 171 240,55", "Seuraava maksu 742,10", ...rows, "Lyhennystyyppi Annuiteetti"));
      expect(drafts.map(read), rows.join(" / ")).toEqual([{ balanceCents: "17124055 sure", paymentCents: "74210 sure", repayment: "annuity sure" }]);
    }
    // and without it the table gives no payment either
    for (const rows of layouts) expect(parseLoanText(text("Pääomaa maksamatta 171 240,55", ...rows)).map(read), rows.join(" / ")).toEqual([{ balanceCents: "17124055 sure" }]);
  });
});

describe("loan intake: a flexible credit's page", () => {
  it("reads the sum left, the drawn total as the granted sum, the rate with its sign, the way of repayment and the kind", () => {
    const [draft, ...others] = parseLoanText(CREDIT, ASOF);
    expect(others).toEqual([]);
    expect(read(draft!)).toEqual({
      balanceCents: "270000 sure",
      grantedCents: "1000000 check",
      rateBp: "840 check",
      intervalMonths: "1 sure",
      repayment: "equal_principal sure",
      // an equal-principal loan stores the amortisation, not the whole payment of the card
      paymentCents: "23060 sure",
    });
    expect(draft!.paymentKind).toBe("amortisation");
    expect(draft!.kind).toBe("credit_line");
    expect(draft!.warnings).toEqual([]);
    expect(draft!.balanceCents!.line).toBe("Pääomaa maksamatta 2 700,00");
  });

  it("has no lender, no limit and no end date: the page gives none", () => {
    const [draft] = parseLoanText(CREDIT, ASOF);
    for (const key of ["lender", "limitCents", "endDate", "balanceDate", "reference", "marginBp"]) expect(draft).not.toHaveProperty(key);
  });

  it("only the page's captions: the figure over Maksamatta is the sum left", () => {
    expect(parseLoanText(text("Joustoluotto", "7 300,00", "Maksettu yhteensä", "2 700,00", "Maksamatta")).map((d) => [read(d), d.kind])).toEqual([[{ balanceCents: "270000 check" }, "credit_line"]]);
  });
});
