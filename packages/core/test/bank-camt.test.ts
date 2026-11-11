import { describe, expect, it } from "vitest";
import { readBankCamt } from "../src/bank-camt.ts";

// A made-up statement: names, IBAN and sums are invented. Opening 1 000,00, rows -23,40 + 2 500,00 - 41,20, closing 3 435,40.
const entry = (amt: string, ind: string, day: string, party: string, extra = "") =>
  `<Ntry><Amt Ccy="EUR">${amt}</Amt><CdtDbtInd>${ind}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${day}</Dt></BookgDt>${extra}` +
  `<NtryDtls><TxDtls><RltdPties>${party}</RltdPties><RmtInf><Ustrd>viesti &amp; muuta</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`;
const bal = (code: string, amt: string, ind: string) =>
  `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${amt}</Amt><CdtDbtInd>${ind}</CdtDbtInd><Dt><Dt>2026-09-01</Dt></Dt></Bal>`;
const file = (closing: string, entries: string[], head = "") =>
  `<?xml version="1.0" encoding="UTF-8"?>${head}<Document xmlns="urn:iso:std:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>1</MsgId></GrpHdr><Stmt><Id>S1</Id>` +
  `<Acct><Id><IBAN>FI2112345600000785</IBAN></Id></Acct>${bal("OPBD", "1000.00", "CRDT")}${bal("CLBD", closing, "CRDT")}${entries.join("")}</Stmt></BkToCstmrStmt></Document>`;

const ENTRIES = [
  entry("23.40", "DBIT", "2026-09-03", "<Cdtr><Nm>PRISMA TIKKURILA</Nm></Cdtr>"),
  entry("2500.00", "CRDT", "2026-09-05", "<Dbtr><Nm>ACME OY</Nm></Dbtr>"),
  entry("41.2", "DBIT", "2026-09-06", "<Cdtr><Nm>SHELL &amp; CO</Nm></Cdtr>"),
];

describe("readBankCamt", () => {
  it("gives the exact rows of a statement whose closing balance matches", () => {
    const r = readBankCamt(file("3435.40", ENTRIES));
    expect(r).toMatchObject({ periodFrom: "2026-09-03", periodTo: "2026-09-06", unread: [] });
    expect((r as { rows: unknown[] }).rows).toEqual([
      { day: "2026-09-03", cents: -2340, text: "PRISMA TIKKURILA" },
      { day: "2026-09-05", cents: 250000, text: "ACME OY" },
      { day: "2026-09-06", cents: -4120, text: "SHELL & CO" },
    ]);
  });

  it("refuses a file whose closing balance is not the rows' and gives the difference", () => {
    expect(readBankCamt(file("3400.00", ENTRIES))).toEqual({ error: "mismatch", opening: 100000, closing: 340000, expected: 343540, difference: -3540 });
  });

  it("refuses a booked entry it cannot read, even when the balance would still add up", () => {
    const bad = entry("5.00", "DBIT", "2026-09-07", "<Cdtr><Nm>X</Nm></Cdtr>").replace("<Dt>2026-09-07</Dt>", "<Dt>nope</Dt>");
    expect(readBankCamt(file("3435.40", [...ENTRIES, bad]))).toEqual({ error: "unreadable" });
  });

  it("names every party of a batch entry, keeps a reversal's own direction, skips a pending entry and falls back to the message", () => {
    const batch = entry("30.00", "DBIT", "2026-09-02", "<Cdtr><Nm>Kauppa</Nm></Cdtr>").replace("</TxDtls>", "</TxDtls><TxDtls><RltdPties><Cdtr><Nm>Apteekki</Nm></Cdtr></RltdPties></TxDtls>");
    expect((readBankCamt(file("970.00", [batch])) as { rows: unknown[] }).rows).toEqual([{ day: "2026-09-02", cents: -3000, text: "Kauppa, Apteekki" }]);
    const reversed = entry("10.00", "CRDT", "2026-09-07", "", "<RvslInd>true</RvslInd>");
    const pending = entry("99.00", "DBIT", "2026-09-08", "<Cdtr><Nm>ODOTTAA</Nm></Cdtr>").replace("BOOK", "PDNG");
    const r = readBankCamt(file("1010.00", [reversed, pending]));
    expect(r).toMatchObject({ rows: [{ day: "2026-09-07", cents: 1000, text: "viesti & muuta" }], unread: ["2026-09-08 ODOTTAA"] });
  });

  it("reads an entry with only a reference or only the bank's code, each after the name, the message and the entry's own text", () => {
    const bare = (inner: string, extra = "") =>
      `<Ntry><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-09-07</Dt></BookgDt>${extra}<NtryDtls><TxDtls>${inner}</TxDtls></NtryDtls></Ntry>`;
    const rows = (...entries: string[]) => (readBankCamt(file("995.00", entries)) as { rows?: unknown[] }).rows;
    const ref = "<RmtInf><Strd><CdtrRefInf><Ref>1234561</Ref></CdtrRefInf></Strd></RmtInf>";
    const code = "<BkTxCd><Prtry><Cd>PALVELUMAKSU</Cd></Prtry></BkTxCd>";
    const name = "<RltdPties><Cdtr><Nm>Kauppa</Nm></Cdtr></RltdPties>";
    const row = (text: string) => [{ day: "2026-09-07", cents: -500, text }];

    expect(rows(bare(ref))).toEqual(row("1234561"));
    expect(rows(bare("", code))).toEqual(row("PALVELUMAKSU"));
    expect(rows(bare(code))).toEqual(row("PALVELUMAKSU"));
    // the order: name, message, AddtlNtryInf, reference, code
    expect(rows(bare(ref, code))).toEqual(row("1234561"));
    expect(rows(bare(ref, `${code}<AddtlNtryInf>Lisatieto</AddtlNtryInf>`))).toEqual(row("Lisatieto"));
    expect(rows(bare(`<RmtInf><Ustrd>viesti</Ustrd>${ref.slice(8)}`, `${code}<AddtlNtryInf>Lisatieto</AddtlNtryInf>`))).toEqual(row("viesti"));
    expect(rows(bare(name + `<RmtInf><Ustrd>viesti</Ustrd>${ref.slice(8)}`, `${code}<AddtlNtryInf>Lisatieto</AddtlNtryInf>`))).toEqual(row("Kauppa"));

    // none of the five is still refused, and the closing balance is still checked
    expect(readBankCamt(file("995.00", [bare("")]))).toEqual({ error: "unreadable" });
    expect(readBankCamt(file("990.00", [bare(ref)]))).toEqual({ error: "mismatch", opening: 100000, closing: 99000, expected: 99500, difference: -500 });
    expect(readBankCamt(file("990.00", [bare("", code)]))).toMatchObject({ error: "mismatch", difference: -500 });
  });

  it("refuses what is not a camt.053 file, other currencies, no balance and a DOCTYPE", () => {
    expect(readBankCamt("Kirjauspäivä;Määrä\n1;2")).toEqual({ error: "not_camt" });
    expect(readBankCamt(file("3435.40", ENTRIES).replaceAll('Ccy="EUR"', 'Ccy="USD"'))).toEqual({ error: "currency" });
    expect(readBankCamt(file("3435.40", ENTRIES).replace(/<Bal>.*?<\/Bal>/, ""))).toEqual({ error: "no_balance" });
    expect(readBankCamt(file("3435.40", ENTRIES, '<!DOCTYPE x [<!ENTITY a "b">]>'))).toEqual({ error: "not_camt" });
    expect(readBankCamt(file("1000.00", []))).toEqual({ error: "no_rows" });
  });

  // one row on the 5th: opening 1 000,00 + 2 500,00 = 3 500,00
  const period = (from: string, to: string) => `<FrToDt><FrDtTm>${from}</FrDtTm><ToDtTm>${to}</ToDtTm></FrToDt>`;
  const quiet = (frToDt: string) => file("3500.00", [ENTRIES[1]!]).replace("<Id>S1</Id>", `<Id>S1</Id>${frToDt}`);

  it("gives the period the statement states, not only the days that have a row", () => {
    expect(readBankCamt(quiet(period("2026-09-01T00:00:00", "2026-09-30T23:59:59")))).toMatchObject({ periodFrom: "2026-09-01", periodTo: "2026-09-30" });
  });

  it("gives the earliest start and the latest end over several statements of one account", () => {
    const stmt = (xml: string) => /<Stmt>.*<\/Stmt>/.exec(xml)![0];
    const first = quiet(period("2026-09-01T00:00:00", "2026-09-15T23:59:59"));
    const second = stmt(quiet(period("2026-09-16T00:00:00", "2026-09-30T23:59:59")).replace("<Dt>2026-09-05</Dt>", "<Dt>2026-09-20</Dt>"));
    const both = first.replace("</Stmt>", `</Stmt>${second}`);
    expect(readBankCamt(both)).toMatchObject({ periodFrom: "2026-09-01", periodTo: "2026-09-30" });
    // one statement of the two does not state its period: the row days
    expect(readBankCamt(both.replace(/<FrToDt>.*?<\/FrToDt>/, ""))).toMatchObject({ periodFrom: "2026-09-05", periodTo: "2026-09-20" });
  });

  it("gives the row days when the stated period is absent, is no real day, ends before it starts or leaves a row outside it", () => {
    const rowDays = { periodFrom: "2026-09-05", periodTo: "2026-09-05" };
    expect(readBankCamt(quiet(""))).toMatchObject(rowDays);
    expect(readBankCamt(quiet(period("2026-09-01T00:00:00", "2026-09-31T23:59:59")))).toMatchObject(rowDays);
    expect(readBankCamt(quiet(period("2026-09-30T00:00:00", "2026-09-01T23:59:59")))).toMatchObject(rowDays);
    expect(readBankCamt(quiet(period("2026-09-06T00:00:00", "2026-09-30T23:59:59")))).toMatchObject(rowDays);
    expect(readBankCamt(quiet(period("2026-09-01T00:00:00", "2026-09-04T23:59:59")))).toMatchObject(rowDays);
  });
});

describe("a year's file", () => {
  it("reads 2 500 rows whose balances add up", () => {
    const entries = Array.from({ length: 2500 }, (_, i) => entry("1.00", "CRDT", `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, "<Cdtr><Nm>KAUPPA</Nm></Cdtr>"));
    const r = readBankCamt(file("3500.00", entries));
    expect((r as { rows: unknown[] }).rows).toHaveLength(2500);
  });
});
