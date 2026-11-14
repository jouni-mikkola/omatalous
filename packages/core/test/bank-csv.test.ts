import { describe, expect, it } from "vitest";
import { splitRowsByDay } from "../src/card-file.ts";
import { type BankCsvLayout, bankCsvKey, guessBankCsvLayout, isBankCsvLayout, mentionsAccount, parseBankCsv, readBankCsvRows } from "../src/bank-csv.ts";

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
      { day: "2026-09-03", cents: -2340, text: "PRISMA TIKKURILA", message: "Ostos" },
      { day: "2026-09-05", cents: 250000, text: "ACME OY", message: "Palkka; syyskuu" },
      { day: "2026-09-07", cents: -123456, text: "KIINTEISTÖ OY KOTI", message: "Vuokra" },
    ]);
  });

  it("keeps the payment message of a row beside its text, and leaves it out when it adds nothing", () => {
    const head = "Kirjauspäivä;Määrä;Saaja/Maksaja;Viesti";
    const r = readBankCsv([head, "03.09.2026;2500,00;ACME OY;PALKKA", "04.09.2026;-10,00;KAUPPA;kauppa", "05.09.2026;-5,00;KIOSKI;FI21 1234 5600 0007 85", "06.09.2026;-6,00;TORI;", "07.09.2026;-7,00;TORI;12345678"].join("\n"));
    expect(r).toMatchObject({ ok: true, layout: { text: 2, message: 3 } });
    expect((r as { rows: unknown[] }).rows).toEqual([
      { day: "2026-09-03", cents: 250000, text: "ACME OY", message: "PALKKA" },
      { day: "2026-09-04", cents: -1000, text: "KAUPPA" },
      { day: "2026-09-05", cents: -500, text: "KIOSKI" },
      { day: "2026-09-06", cents: -600, text: "TORI" },
      { day: "2026-09-07", cents: -700, text: "TORI" },
    ]);
  });

  it("reads no message when the only text column is the message, or the household chose none", () => {
    const only = readBankCsv(["Päivä;Summa;Viesti", "03.09.2026;-23,40;Ostos"].join("\n"));
    expect(only).toMatchObject({ ok: true, rows: [{ day: "2026-09-03", cents: -2340, text: "Ostos" }] });
    expect((only as { rows: object[] }).rows[0]).not.toHaveProperty("message");
    const none = readBankCsv(BANK_A, { ...(guessBankCsvLayout(parseBankCsv(BANK_A)!) as BankCsvLayout), message: null });
    expect((none as { rows: object[] }).rows[0]).toEqual({ day: "2026-09-03", cents: -2340, text: "PRISMA TIKKURILA" });
    expect(isBankCsvLayout({ ...(guessBankCsvLayout(parseBankCsv(BANK_A)!) as BankCsvLayout), message: 9 }, 6)).toBe(false);
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

  it("guesses a name column, not the IBAN column, for a Nordea header", () => {
    const table = parseBankCsv("Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta\n03.09.2026;-1,00;FI2112345600000785;FI4550009420111122;Kauppa;x;;EUR")!;
    expect([4, 5]).toContain(guessBankCsvLayout(table)!.text);
  });

  it("names a row by the next text column when the chosen cell is empty or only an account number", () => {
    const text = ["Pvm;Summa;Nimi;Otsikko", "03.09.2026;-1,00;;Kahvi", "04.09.2026;-2,00;FI2112345600000785;Leipä", "05.09.2026;-3,00;Kauppa;Muu"].join("\n");
    const r = readBankCsv(text) as { rows: { text: string }[]; unread: string[] };
    expect(r.rows.map((x) => x.text)).toEqual(["Kahvi", "Leipä", "Kauppa"]);
    expect(r.unread).toEqual([]);
  });

  it("names money out by Saajan nimi and money in by Maksaja", () => {
    const text = ["Pvm;Summa;Maksaja;Saajan nimi", "03.09.2026;-5,00;Koti Oy;PRISMA", "04.09.2026;100,00;ACME OY;Koti Oy"].join("\n");
    const r = readBankCsv(text) as { rows: { text: string }[] };
    expect(r.rows.map((x) => x.text)).toEqual(["PRISMA", "ACME OY"]);
  });

  it("keeps a name that starts like an IBAN", () => {
    const r = readBankCsv(["Pvm;Summa;Nimi;Otsikko", "03.09.2026;-1,00;AB12 KAUPPA OY;x"].join("\n")) as { rows: { text: string }[] };
    expect(r.rows.map((x) => x.text)).toEqual(["AB12 KAUPPA OY"]);
  });

  it("keys a layout by the header, whatever its case and spacing", () => {
    expect(bankCsvKey(["Date ", "Description"])).toBe(bankCsvKey(["date", " description"]));
  });
});

describe("a year's file", () => {
  it("reads 2 500 rows", () => {
    const body = Array.from({ length: 2500 }, (_, i) => `${String(1 + (i % 28)).padStart(2, "0")}.${String(1 + (i % 12)).padStart(2, "0")}.2026;-${1 + (i % 50)},00;KAUPPA ${i % 7}`);
    const r = readBankCsv(["Kirjauspäivä;Määrä EUR;Saaja/Maksaja", ...body].join("\n"));
    expect(r.ok).toBe(true);
    expect((r as { rows: unknown[] }).rows).toHaveLength(2500);
  });
});

describe("splitRowsByDay", () => {
  const day = (d: number) => `2026-01-${String(d).padStart(2, "0")}`;
  it("keeps parts at 1 000 rows and never cuts a day", () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ day: day(1 + Math.floor(i / 100)), cents: -100, text: "A" }));
    const parts = splitRowsByDay(rows);
    expect(parts.flat()).toHaveLength(2500);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    const seen = new Set<string>();
    for (const p of parts) {
      const days = new Set(p.map((r) => r.day));
      for (const d of days) expect(seen.has(d)).toBe(false);
      days.forEach((d) => seen.add(d));
    }
  });
  it("keeps two identical rows of one day in one part", () => {
    const rows = [
      ...Array.from({ length: 999 }, (_, i) => ({ day: "2026-01-01", cents: i + 1, text: "X" })),
      { day: "2026-01-02", cents: -500, text: "SAMA" },
      { day: "2026-01-02", cents: -500, text: "SAMA" },
    ];
    const parts = splitRowsByDay(rows);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual([rows[999], rows[1000]]);
  });
});

describe("mentionsAccount", () => {
  it("finds an IBAN in either letter case and a Finnish account number, and leaves plain messages", () => {
    for (const t of ["FI21 1234 5600 0007 85", "fi21 1234 5600 0007 85", "vuokra fi2112345600000785 syyskuu", "tilille 123456-785"]) expect(mentionsAccount(t)).toBe(true);
    for (const t of ["Ostos", "Maksu 2026", "FI21 teksti"]) expect(mentionsAccount(t)).toBe(false);
  });

  it("finds an IBAN or account number split by double spaces, no-break spaces or other Unicode white space", () => {
    const fromCodes = (...codes: number[]) => String.fromCharCode(...codes);
    // double space, no-break, thin, narrow no-break, ideographic, mixed, zero-width
    const spaces = ["  ", fromCodes(0xa0), fromCodes(0x2009), fromCodes(0x202f), fromCodes(0x3000), ` ${fromCodes(0xa0)} `, fromCodes(0x200b)];
    for (const s of spaces) {
      const iban = ["FI21", "1234", "5600", "0007", "85"].join(s);
      expect(mentionsAccount(`vuokra ${iban} syyskuu`)).toBe(true);
      expect(mentionsAccount(`vuokra ${iban.toLowerCase()}`)).toBe(true);
      expect(mentionsAccount(`tilille 123456${s}-${s}785`)).toBe(true);
    }
    const nbsp = fromCodes(0xa0);
    for (const t of ["fi2112345600000785", "FI2112345600000785", ["maksu", "fi21", "1234", "5600", "0007", "85"].join(nbsp), "tili 123456-785 kiitos", `123456${fromCodes(0x2013)}785`]) expect(mentionsAccount(t)).toBe(true);
    for (const t of [["Ostos", "Maksu", "2026"].join(nbsp), `FI21${nbsp}teksti`, "kortti  1234  5678"]) expect(mentionsAccount(t)).toBe(false);
  });
});
