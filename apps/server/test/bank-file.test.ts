/**
 * Rows of a bank's CSV export (ADR 0025): the route takes rows and no file, the same export twice stores each row once,
 * and a card account of the statement files does not take them.
 */
import { guessBankCsvLayout, parseBankCsv, readBankCamt, readBankCsvRows } from "@banking/core";
import { describe, expect, it } from "vitest";
import { ingestTransactions } from "../src/services/ingest.ts";
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

  const raw = (bookingDate: string, amountCents: number, counterparty: string) => ({
    externalId: null, bookingDate, valueDate: null, amountCents, currency: "EUR", status: "booked" as const, counterparty, counterpartyIban: null, description: null, reference: null, mcc: null,
  });
  const connect = async (app: Awaited<ReturnType<typeof setupApp>>, id: string, rows: ReturnType<typeof raw>[]) => {
    const repo = app.s.finance(app.adminId);
    await repo.upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: null, identity: `idn-${id}`, name: "Pankkitili", iban: null, currency: "EUR", type: "checking" });
    await ingestTransactions(repo, id, rows, "enablebanking");
    return repo;
  };

  it("fills a connected checking account, skipping what the bank holds, and a later sync skips the file", async () => {
    const app = await setupApp();
    const repo = await connect(app, "eb1", [raw("2026-09-03", -2340, "PRISMA TIKKURILA")]);
    const r = await app.admin.call("POST", "/api/bank-file", body(BANK_A, { accountId: "eb1" }));
    expect(r.body).toMatchObject({ accountId: "eb1", fetched: 2, inserted: 1, skipped: 1 });
    expect((await repo.transactionKeys("eb1", "2026-09-01", "2026-09-30")).filter((t) => t.source === "bankfile")).toHaveLength(1);
    const sync = await ingestTransactions(repo, "eb1", [raw("2026-09-03", -2340, "PRISMA TIKKURILA"), raw("2026-09-05", 250000, "ACME OY")], "enablebanking");
    expect(sync).toMatchObject({ inserted: 0, skipped: 1 });
  });

  it("refuse a card, a loan and another member's account", async () => {
    const app = await setupApp();
    const eero = await app.member("eero", "Eero");
    await app.s.finance(app.adminId).upsertAccount({ id: "loan1", connectionId: null, provider: "enablebanking", externalId: null, identity: "idn-loan", name: "Laina", iban: null, currency: "EUR", type: "loan" });
    await app.s.finance(eero.id).upsertAccount({ id: "eero1", connectionId: null, provider: "enablebanking", externalId: null, identity: "idn-e", name: "Eero", iban: null, currency: "EUR", type: "checking" });
    const card = await app.admin.call("POST", "/api/card-file", { name: "Visa", rows: [{ day: "2026-09-03", cents: -2340, text: "PRISMA" }] });
    for (const accountId of [card.body.accountId, "loan1", "eero1"]) {
      const r = await app.admin.call("POST", "/api/bank-file", body(BANK_A, { accountId }));
      expect(r.status).toBe(400);
      expect(r.body.messageCode).toBe("card_file.bad_account");
    }
  });

  it("refuse a new account for rows that mostly sit on a connected account, naming it", async () => {
    const app = await setupApp();
    await connect(app, "eb2", [raw("2026-09-03", -2340, "A"), raw("2026-09-04", -4120, "B"), raw("2026-09-06", 250000, "C")]);
    const csv = ["Date,Description,Debit,Credit", "2026-09-03,A,23.40,", "2026-09-04,B,41.20,", "2026-09-06,C,,2500.00", "2026-09-07,D,5.00,"].join("\n");
    const r = await app.admin.call("POST", "/api/bank-file", body(csv));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ messageCode: "card_file.on_account", params: { account: "Pankkitili" } });
    // a card file is not sent to a bank account
    const card = await app.admin.call("POST", "/api/card-file", { name: "Visa", rows: [0, 1, 2].map((i) => ({ day: ["2026-09-03", "2026-09-04", "2026-09-06"][i], cents: [-2340, -4120, 250000][i], text: "ABC"[i] })) });
    expect(card.status).toBe(200);
  });
});
