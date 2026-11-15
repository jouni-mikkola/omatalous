import { describe, expect, it } from "vitest";
import { readCardFile } from "../src/card-file.ts";

// Made-up statements in the three layouts. The sums and shops are invented; the layouts are what each reader is held to.
const OP = [
  "Kortti;**** 1234",
  "Ostopäivä;Kirjauspäivä;Kauppa;Summa",
  "03.09.2026;04.09.2026;PRISMA TIKKURILA;23,40",
  "05.09.2026;06.09.2026;K-MARKET 24;1 234,56",
  "20.09.2026;21.09.2026;VERKKOKAUPPA PALAUTUS;-15,00",
  "28.09.2026;28.09.2026;Maksu kiitos;-500,00",
].join("\n");

const NORDEA = ["Nordea Gold Mastercard\tKortti 1234", "Päivä\tKuvaus\tMäärä", "2026-09-03\tPRISMA TIKKURILA\t-23.40", "2026-09-05\tK-MARKET 24\t-1234.56", "2026-09-20\tVERKKOKAUPPA PALAUTUS\t15.00", "2026-09-28\tMaksu\t500.00"].join("\n");

const LINES = ["S-Pankki Visa", "Korttinumero **** 1234", "Laskutuskausi 01.09.2026 - 30.09.2026", "Tapahtumat", "03.09. PRISMA TIKKURILA 23,40", "05.09. K-MARKET 24 1 234,56", "20.09. VERKKOKAUPPA PALAUTUS 15,00-", "28.09. Maksu kiitos -500,00", "Yhteensä 743,00"].join("\n");

const ROWS = [
  { day: "2026-09-03", cents: -2340, text: "PRISMA TIKKURILA", payment: false },
  { day: "2026-09-05", cents: -123456, text: "K-MARKET 24", payment: false },
  { day: "2026-09-20", cents: 1500, text: "VERKKOKAUPPA PALAUTUS", payment: false },
  { day: "2026-09-28", cents: 50000, text: "Maksu kiitos", payment: true },
];

describe("readCardFile", () => {
  it.each([
    ["op", OP, "2026-09-03", "2026-09-28"],
    ["nordea", NORDEA, "2026-09-03", "2026-09-28"],
    ["spankki", LINES, "2026-09-01", "2026-09-30"],
  ] as const)("reads the %s layout to the exact rows", (layout, text, from, to) => {
    const r = readCardFile(text);
    expect(r).toMatchObject({ ok: true, layout, cardLast4: "1234", periodFrom: from, periodTo: to, unread: [] });
    const rows = (r as { rows: unknown[] }).rows;
    // the payment row is worded by the issuer
    expect(rows).toEqual(layout === "nordea" ? ROWS.map((x) => (x.payment ? { ...x, text: "Maksu" } : x)) : ROWS);
  });

  it("gives the same rows for the same file twice", () => {
    expect(readCardFile(OP)).toEqual(readCardFile(OP));
  });

  it("keeps a line it cannot read apart", () => {
    const r = readCardFile(`${OP}\n32.13.2026;1.1.2026;X;1,00`);
    expect(r).toMatchObject({ ok: true, unread: ["32.13.2026;1.1.2026;X;1,00"] });
  });

  it("refuses a text of no known layout and a layout with no rows", () => {
    expect(readCardFile("Päiväys;Summa\n1.9.2026;5,00")).toEqual({ ok: false, error: "unknown_layout" });
    expect(readCardFile("Ostopäivä;Kirjauspäivä;Kauppa;Summa\n")).toEqual({ ok: false, error: "no_rows" });
  });
});

describe("readCardFile, quoted cells", () => {
  const OP_HEAD = "Ostopäivä;Kirjauspäivä;Kauppa;Summa";
  const NORDEA_HEAD = "Päivä\tKuvaus\tMäärä";

  it("reads a quoted shop with a semicolon in it as one cell of the op layout", () => {
    const r = readCardFile(`${OP_HEAD}\n01.09.2026;02.09.2026;"K-MARKET; HELSINKI";12,50`);
    expect(r).toMatchObject({ ok: true, layout: "op", unread: [] });
    expect((r as { rows: unknown[] }).rows).toEqual([{ day: "2026-09-01", cents: -1250, text: "K-MARKET; HELSINKI", payment: false }]);
  });

  it("drops the quote marks and reads a doubled one as one in the op layout", () => {
    const r = readCardFile(`${OP_HEAD}\n01.09.2026;02.09.2026;"PRISMA";12,50\n03.09.2026;04.09.2026;"BAARI ""KULMA""";8,00`);
    expect(r).toMatchObject({ ok: true, unread: [] });
    expect((r as { rows: { text: string }[] }).rows.map((x) => x.text)).toEqual(["PRISMA", 'BAARI "KULMA"']);
  });

  it("keeps the text after a closing quote in the cell, so the row still reads", () => {
    const r = readCardFile(`${OP_HEAD}\n01.09.2026;02.09.2026;"BAARI" KULMA;8,00`);
    expect(r).toMatchObject({ ok: true, unread: [] });
    expect((r as { rows: unknown[] }).rows).toEqual([{ day: "2026-09-01", cents: -800, text: "BAARI KULMA", payment: false }]);
  });

  it("reads a quoted cell of the nordea layout", () => {
    const r = readCardFile(`${NORDEA_HEAD}\n2026-09-01\t"PRISMA"\t-12.50\n2026-09-03\t"BAARI ""KULMA""\tYLÄ"\t-8.00`);
    expect(r).toMatchObject({ ok: true, layout: "nordea", unread: [] });
    expect((r as { rows: unknown[] }).rows).toEqual([
      { day: "2026-09-01", cents: -1250, text: "PRISMA", payment: false },
      { day: "2026-09-03", cents: -800, text: 'BAARI "KULMA" YLÄ', payment: false },
    ]);
  });

  it("keeps a line whose quote never closes as unread", () => {
    const open = '05.09.2026;06.09.2026;"K-MARKET; HELSINKI;12,50';
    const r = readCardFile(`${OP}\n${open}`);
    expect(r).toMatchObject({ ok: true, unread: [open] });
    expect((r as { rows: unknown[] }).rows).toHaveLength(4);
    const tabbed = '2026-09-05\t"PRISMA\t-12.50';
    expect(readCardFile(`${NORDEA}\n${tabbed}`)).toMatchObject({ ok: true, unread: [tabbed] });
  });
});

describe("readCardFile, rows that do not read", () => {
  it("tells a line that opens like a row but has no readable sum, and a day outside the period", () => {
    const text = ["Laskutuskausi 01.09.2026 - 30.09.2026", "03.09. PRISMA TIKKURILA 23,40", "04.09. KAUPPA 12.5 EUR", "01.10. LIIAN MYÖHÄÄN 9,00"].join("\n");
    const r = readCardFile(text);
    expect(r).toMatchObject({ ok: true, unread: ["04.09. KAUPPA 12.5 EUR", "01.10. LIIAN MYÖHÄÄN 9,00"] });
    expect((r as { rows: unknown[] }).rows).toHaveLength(1);
  });
});
