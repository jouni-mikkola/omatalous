/**
 * Rows of a bank's CSV export (ADR 0025): the route takes rows and no file, the same export twice stores each row once,
 * and a card account of the statement files does not take them.
 */
import { guessBankCsvLayout, parseBankCsv, readBankCamt, readBankCsvRows } from "@banking/core";
import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

// the test clock is 2026-10-09
const BANK_A = ["Kirjauspäivä;Määrä EUR;Saaja/Maksaja", "03.09.2026;-23,40;PRISMA TIKKURILA", "05.09.2026;2 500,00;ACME OY"].join("\n");
const BANK_B = ["Date,Description,Debit,Credit", "2026-09-04,SHELL HELSINKI,41.20,", "2026-09-06,SALARY ACME,,2500.00"].join("\n");

const CAMT = `<?xml version="1.0"?><Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>FI2112345600000785</IBAN></Id></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">86.60</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Ntry><Amt Ccy="EUR">23.40</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-09-03</Dt></BookgDt><NtryDtls><TxDtls><RltdPties><Cdtr><Nm>PRISMA</Nm></Cdtr></RltdPties></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-09-04</Dt></BookgDt><AddtlNtryInf>Palautus</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

const body = (csv: string, extra: object = {}) => {
  const table = parseBankCsv(csv);
  const layout = table && guessBankCsvLayout(table);
  const r = table && layout && readBankCsvRows(table, layout);
  if (!r || "error" in r) throw new Error("unreadable");
  return { name: "Käyttötili", rows: r.rows, ...extra };
};

describe("bank CSV rows", () => {
  it("store the rows of two banks on accounts of their own", async () => {
    const { admin } = await setupApp();
    const a = await admin.call("POST", "/api/bank-file", body(BANK_A));
    const b = await admin.call("POST", "/api/bank-file", body(BANK_B, { name: "Toinen" }));
    expect(a.body).toMatchObject({ fetched: 2, inserted: 2 });
    expect(b.body).toMatchObject({ fetched: 2, inserted: 2 });
    expect(a.body.accountId).not.toBe(b.body.accountId);
    const accounts = (await admin.call("GET", "/api/meta")).body.accounts as { id: string; provider: string; type: string }[];
    expect(accounts.find((x) => x.id === a.body.accountId)).toMatchObject({ provider: "bankfile", type: "checking" });
    const items = (await admin.call("GET", "/api/transactions?from=2026-09-01&to=2026-09-30&limit=50")).body.items as { amountCents: number }[];
    expect(items.map((x) => x.amountCents).sort((x, y) => x - y)).toEqual([-4120, -2340, 250000, 250000]);
  });

  it("store each row once when the same export is read twice", async () => {
    const { admin, db } = await setupApp();
    const first = await admin.call("POST", "/api/bank-file", body(BANK_A));
    const again = await admin.call("POST", "/api/bank-file", body(BANK_A));
    expect(again.body).toMatchObject({ accountId: first.body.accountId, inserted: 0, changed: 0 });
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM transactions"))?.n).toBe(2);
  });

  it("refuse a card account of the statement files, and anything but rows", async () => {
    const { admin } = await setupApp();
    const card = await admin.call("POST", "/api/card-file", { name: "Visa", rows: [{ day: "2026-09-03", cents: -2340, text: "PRISMA" }] });
    expect((await admin.call("POST", "/api/bank-file", body(BANK_A, { accountId: card.body.accountId }))).status).toBe(400);
    expect((await admin.call("POST", "/api/bank-file", { ...body(BANK_A), file: "x.csv" })).status).toBe(400);
  });

  it("store each row of a camt.053 statement once when it is read twice", async () => {
    const { admin, db } = await setupApp();
    const camt = readBankCamt(CAMT);
    if ("error" in camt) throw new Error("unreadable");
    const send = () => admin.call("POST", "/api/bank-file", { name: "Camt-tili", rows: camt.rows });
    expect((await send()).body).toMatchObject({ fetched: 2, inserted: 2 });
    expect((await send()).body).toMatchObject({ inserted: 0, changed: 0 });
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM transactions"))?.n).toBe(2);
  });
});
