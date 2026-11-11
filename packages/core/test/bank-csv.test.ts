import { describe, expect, it } from "vitest";
import { type BankCsvLayout, bankCsvKey, guessBankCsvLayout, isBankCsvLayout, parseBankCsv, readBankCsvRows } from "../src/bank-csv.ts";

/** A file's text under a layout, else under the one its header suggests: what the page does. */
function readBankCsv(text: string, layout?: BankCsvLayout) {
  const table = parseBankCsv(text);
  const use = table && (layout && layout.delimiter === table.delimiter && isBankCsvLayout(layout, table.header.length) ? layout : guessBankCsvLayout(table));
  if (!table || !use) return { ok: false as const, error: "unknown_layout" as const };
  const read = readBankCsvRows(table, use);
  return "error" in read ? { ok: false as const, error: read.error } : { ok: true as const, layout: use, ...read };
}

// Made-up exports of two banks with different columns. The names and sums are invented.
const BANK_A = [
  "Kirjauspäivä;Arvopäivä;Määrä EUR;Saaja/Maksaja;Viesti;Saldo",
  "03.09.2026;03.09.2026;-23,40;PRISMA TIKKURILA;Ostos;1 000,00",
  '05.09.2026;05.09.2026;"2 500,00";ACME OY;"Palkka; syyskuu";3 500,00',
  "07.09.2026;07.09.2026;-1 234,56;KIINTEISTÖ OY KOTI;Vuokra;2 265,44",
].join("\r\n");

const BANK_B = [
  "Date,Description,Debit,Credit",
  '2026-09-03,"SHELL, HELSINKI",41.20,',
  "2026-09-04,SALARY ACME,,2500.00",
  '2026-09-06,"Cafe ""Kulma""",-4.50,',
].join("\n");

describe("readBankCsv", () => {
  it("reads a semicolon export with one signed sum column to the exact rows", () => {
    const r = readBankCsv(BANK_A);
    expect(r).toMatchObject({ ok: true, periodFrom: "2026-09-03", periodTo: "2026-09-07", unread: [] });
    expect((r as { rows: unknown[] }).rows).toEqual([
      { day: "2026-09-03", cents: -2340, text: "PRISMA TIKKURILA" },
      { day: "2026-09-05", cents: 250000, text: "ACME OY" },
      { day: "2026-09-07", cents: -123456, text: "KIINTEISTÖ OY KOTI" },
    ]);
  });

  it("reads a Nordea export with year-first slash dates, and leaves an impossible day unread", () => {
    const head = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
    const r = readBankCsv([head, "2026/09/03;-12,50;A;B;Kauppa;x;;EUR", "2026/09/04;2500,00;A;B;Palkka;x;;EUR", "2026/02/30;-1,00;A;B;Virhe;x;;EUR"].join("\n"));
    expect(r.ok).toBe(true);
    const ok = r as unknown as { rows: { day: string; cents: number }[]; unread: unknown[] };
    expect(ok.rows.map((x) => ({ day: x.day, cents: x.cents }))).toEqual([
      { day: "2026-09-03", cents: -1250 },
      { day: "2026-09-04", cents: 250000 },
    ]);
    expect(ok.unread).toHaveLength(1);
  });

  it("reads a comma export with a debit and a credit column to the exact rows", () => {
    const r = readBankCsv(BANK_B);
    expect(r).toMatchObject({ ok: true, layout: { delimiter: ",", amount: null, debit: 2, credit: 3 }, unread: [] });
    expect((r as { rows: unknown[] }).rows).toEqual([
      { day: "2026-09-03", cents: -4120, text: "SHELL, HELSINKI" },
      { day: "2026-09-04", cents: 250000, text: "SALARY ACME" },
      { day: "2026-09-06", cents: -450, text: 'Cafe "Kulma"' },
    ]);
  });

  it("reads a split export whose unused column holds a zero, and refuses sums with a typo", () => {
    const r = readBankCsv(["Date,Description,Debit,Credit", "2026-09-03,A,41.20,0.00", "2026-09-04,B,0.00,2500.00", "2026-09-05,C,1.2.3,", "2026-09-06,D,1,23.456,"].join("\n"));
    expect((r as { rows: { cents: number }[] }).rows.map((x) => x.cents)).toEqual([-4120, 250000]);
    expect((r as { unread: string[] }).unread).toHaveLength(2);
  });

  it("sends a sum with a lone comma or dot before three digits to unread, never a thousand times too large", () => {
    const r = readBankCsv(["Päivä;Summa;Saaja", "03.09.2026;-23,40;A", "04.09.2026;-12,345;B", "05.09.2026;1.234,56;C", "06.09.2026;1 234,56;D", "07.09.2026;12.345;E", "08.09.2026;1 234.567;F"].join("\n"));
    expect((r as { rows: unknown[] }).rows).toEqual([
      { day: "2026-09-03", cents: -2340, text: "A" },
      { day: "2026-09-05", cents: 123456, text: "C" },
      { day: "2026-09-06", cents: 123456, text: "D" },
    ]);
    expect((r as { unread: string[] }).unread).toEqual(["04.09.2026;-12,345;B", "07.09.2026;12.345;E", "08.09.2026;1 234.567;F"]);
  });

  it("reads a split line whose unused cell holds a placeholder, and refuses one whose other cell holds digits that are no sum", () => {
    const r = readBankCsv(["Date,Description,Debit,Credit", "2026-09-03,A,41.20,-", "2026-09-04,B,n/a,2500.00", "2026-09-05,C,41.20,12.345", "2026-09-06,D,1.2.3,5.00"].join("\n"));
    expect((r as { rows: { cents: number }[] }).rows.map((x) => x.cents)).toEqual([-4120, 250000]);
    expect((r as { unread: string[] }).unread).toEqual(["2026-09-05,C,41.20,12.345", "2026-09-06,D,1.2.3,5.00"]);
  });

  it("gives the same rows for the same file twice, and names a line it cannot read", () => {
    expect(readBankCsv(BANK_A)).toEqual(readBankCsv(BANK_A));
    const r = readBankCsv(`${BANK_A}\n31.02.2026;x;5,00;BAD DAY;;`);
    expect(r).toMatchObject({ ok: true, unread: ["31.02.2026;x;5,00;BAD DAY;;"] });
  });

  it("uses the layout the household settled on, when it fits the file", () => {
    const table = parseBankCsv(BANK_A)!;
    const guess = guessBankCsvLayout(table)!;
    expect(guess).toMatchObject({ date: 0, amount: 2, text: 3 });
    const r = readBankCsv(BANK_A, { ...guess, text: 4 });
    expect((r as { rows: { text: string }[] }).rows.map((x) => x.text)).toEqual(["Ostos", "Palkka; syyskuu", "Vuokra"]);
    // a layout of another file shape is ignored
    expect(readBankCsv(BANK_B, { ...guess, text: 4 })).toMatchObject({ ok: true, layout: { delimiter: ",", text: 1 } });
  });

  it("refuses a file whose columns it cannot match, an empty one and a header alone", () => {
    expect(readBankCsv("a;b;c\n1;2;3")).toEqual({ ok: false, error: "unknown_layout" });
    expect(readBankCsv("Date,Description,Amount")).toEqual({ ok: false, error: "unknown_layout" });
    expect(readBankCsv("Date,Description,Amount\nnot a day,x,1.00")).toEqual({ ok: false, error: "no_rows" });
  });

  it("keys a layout by the header, whatever its case and spacing", () => {
    expect(bankCsvKey(["Date ", "Description"])).toBe(bankCsvKey(["date", " description"]));
  });
});
