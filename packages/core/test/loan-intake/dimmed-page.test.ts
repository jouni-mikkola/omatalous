import { describe, expect, it } from "vitest";
import { DIMMED_PAGE_LINE, parseLoanText } from "../../src/index.ts";
import { read, text, warned } from "./helpers.ts";

// A picture of a home loan's "Lainan tiedot" dialog over its dimmed page, as the picture reader gives it: the dialog's text,
// the reader's line, and then the page behind, read on its own with the dialog blanked (the table's sums lie under the
// dialog). Taken from the made-up view of e2e/fixtures/loan-views at device scale 2; every name, number and sum is made up.
const DIALOG = text(
  "Lainan tiedot x",
  "Lainan numero 123456-7890123 (kopioi",
  "Myönnetty 185 000,00",
  "Pääomaa maksamatta 171 240,55",
  "Pääomaa maksettu 13 759,45",
  "Nostettu yhteensä 185 000,00",
  "Nostamaton määrä yhteensä 0,00",
  "Ensimmäinen nostopäivä 14.3.2022",
  "MEIKÄLÄINEN MATTI",
  "Velallinen / yhteisvastuullinen OLAVI",
  "velallinen ESIMERKKI ELISA MARIA",
  "Valuutta EUR",
  "Nordea Kiinnitysluottopankki®",
  "Velkoja 6)",
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
const PAGE_TOP = text("Hallinnoi lainaa", "", "Asuntolaina", "13 759,45 171 240,55", "Maksettu yhteensä | Maksamatta", "", "Seuraava maksu 742,10", "", "16.10.2026", "");
const PAGE_RATE = text("Korko 440,33", "Korko 3,085%");
const PAGE_TABLE = text("Aiemmat maksut", "Päivämäärä", "16.9.2026 Tiedot", "16.8.2026 Tiedot", "16.7.2026 Tiedot");
const PICTURE = text(DIALOG, DIMMED_PAGE_LINE, PAGE_TOP, PAGE_RATE, PAGE_TABLE);

const DIALOG_FIELDS = {
  grantedCents: "18500000 sure",
  balanceCents: "17124055 sure",
  lender: "Nordea Kiinnitysluottopankki check",
  intervalMonths: "1 sure",
  repayment: "annuity sure",
  endDate: "2052-03-14 sure",
};
const ASOF = { asOf: "2026-10-12" } as const;

describe("loan intake: a dialog over its dimmed page", () => {
  it("the page behind gives the rate and the whole payment, each to check, and the dialog's fields stay as read", () => {
    const drafts = parseLoanText(PICTURE, ASOF);
    expect(drafts.map(read)).toEqual([{ ...DIALOG_FIELDS, rateBp: "309 check", paymentCents: "74210 check" }]);
    expect(drafts.map(warned)).toEqual([[]]);
    const [draft] = drafts;
    expect(draft!.paymentKind).toBe("whole");
    expect(draft!.kind).toBe("mortgage");
    expect(draft!.rateBp!.line).toBe("Korko 3,085%");
    expect(draft!.paymentCents!.line).toBe("Seuraava maksu 742,10");
  });

  it("read from a picture, every field is to check, as any picture's", () => {
    const [draft] = parseLoanText(PICTURE, { ...ASOF, source: "ocr" });
    expect(Object.values(read(draft!)).every((v) => v.endsWith(" check"))).toBe(true);
    expect(read(draft!).rateBp).toBe("309 check");
  });

  it("the page fills only what the dialog left out: a figure of the dialog is never replaced by the page's", () => {
    const page = text("Asuntolaina", "Pääomaa maksamatta 100 000,00", "Seuraava maksu 742,10", "Korko 3,085%");
    const [draft] = parseLoanText(text(DIALOG, DIMMED_PAGE_LINE, page), ASOF);
    expect(read(draft!).balanceCents).toBe("17124055 sure");
    expect(draft!.warnings).toEqual([]);
  });

  it("a dialog with no page behind is read as the dialog alone: the amortisation stands for the payment and there is no rate", () => {
    for (const view of [DIALOG, text(DIALOG, DIMMED_PAGE_LINE), text(DIALOG, DIMMED_PAGE_LINE, PAGE_TABLE)]) {
      const [draft, ...others] = parseLoanText(view, ASOF);
      expect(others).toEqual([]);
      expect(read(draft!)).toEqual({ ...DIALOG_FIELDS, paymentCents: "30177 check" });
      expect(draft!.paymentKind).toBe("amortisation");
    }
  });

  it("a dimmed page with no rate gives the payment and no rate, and Korko in euros is no rate", () => {
    for (const page of [text(PAGE_TOP, PAGE_TABLE), text(PAGE_TOP, "Korko 440,33", PAGE_TABLE)]) {
      const [draft, ...others] = parseLoanText(text(DIALOG, DIMMED_PAGE_LINE, page), ASOF);
      expect(others).toEqual([]);
      expect(read(draft!)).toEqual({ ...DIALOG_FIELDS, paymentCents: "74210 check" });
    }
  });

  it("the reader's line counts only between the dialog and the page: the same page lines before the dialog are read as one text", () => {
    const [draft] = parseLoanText(text(PAGE_TOP, PAGE_RATE, DIALOG), ASOF);
    expect(read(draft!)).toEqual({ ...DIALOG_FIELDS, rateBp: "309 check", paymentCents: "74210 sure" });
  });

  it("a page behind with two loans is not known to be the dialog's, and gives nothing", () => {
    const page = text("Asuntolaina", "Seuraava maksu 742,10", "Korko 3,085%", "Joustoluotto", "Seuraava maksu 250,00", "Korko 8,400%");
    const drafts = parseLoanText(text(DIALOG, DIMMED_PAGE_LINE, page), ASOF);
    expect(drafts.map(read)).toEqual([{ ...DIALOG_FIELDS, paymentCents: "30177 check" }]);
  });

  it("a dialog with no loan in it leaves the page's loan, every field to check", () => {
    // two figures on one line over two captions are neither caption's
    const drafts = parseLoanText(text("Evästeet", "Hyväksy kaikki", DIMMED_PAGE_LINE, PAGE_TOP, PAGE_RATE), ASOF);
    expect(drafts.map(read)).toEqual([{ paymentCents: "74210 check", rateBp: "309 check" }]);
  });

  it("an equal-principal dialog keeps its amortisation as the payment over the page's whole payment", () => {
    const dialog = DIALOG.replace("Annuiteetti", "Tasalyhennys");
    const [alone] = parseLoanText(dialog, ASOF);
    const [draft] = parseLoanText(text(dialog, DIMMED_PAGE_LINE, PAGE_TOP, PAGE_RATE), ASOF);
    expect(draft!.paymentCents).toEqual(alone!.paymentCents);
    expect(draft!.paymentKind).toBe("amortisation");
    expect(read(draft!).rateBp).toBe("309 check");
  });
});
