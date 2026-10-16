import { spendRows } from "@banking/core";
import { describe, expect, it } from "vitest";
import { accountKey } from "../src/db/household-repo.ts";
import { reprocess } from "../src/services/enrich.ts";
import { syncStatementState } from "../src/services/statements.ts";
import { setupApp } from "./helpers.ts";

const WHOLE_YEAR = { fromDay: 0, toDay: 10 ** 7 };
const rows = (...r: [string, number, string][]) => r.map(([day, cents, text]) => ({ day, cents, text }));
const CASE_A = rows(["2026-02-03", 6150, "K-MARKET ESIMERKKI"], ["2026-02-09", 8000, "ESIMERKKI POLTTOAINE"], ["2026-02-20", 15000, "VERKKOKAUPPA ESIMERKKI"]);
const put = (c: { call: (m: string, p: string, b?: unknown) => Promise<any> }, bill: string, body: object) => c.call("PUT", `/api/statements/${bill}`, body);
const period = (rowList = CASE_A, extra: object = {}) => ({ periodFrom: "2026-02-01", periodTo: "2026-02-28", statementCents: 42000, rows: rowList, ...extra });

/** What a write of the rows does after it: the data version moves and the statements are set aside or read again. */
const settle = async (s: { settings: { bumpUserDataVersion(id: string): Promise<unknown> } }, userId: string) => {
  await s.settings.bumpUserDataVersion(userId);
  await syncStatementState(s as never, userId);
};
/** The stored mark of the statements: what a read must never write. */
const detachedOf = async (db: { all<T>(sql: string): Promise<T[]> }) =>
  (await db.all<{ bill_tx_id: string; detached_at: string | null; detached_reason: string | null }>("SELECT bill_tx_id, detached_at, detached_reason FROM statement_bill ORDER BY bill_tx_id")).map((r) => [r.bill_tx_id, r.detached_at !== null, r.detached_reason]);

/** Aino has a current account, a card and a loan; Eero has a current account. Bills are made-up and booked in March. */
async function household() {
  const app = await setupApp();
  const { db, s, admin, adminId } = app;
  const eero = await app.member("eero", "Eero");
  const account = (id: string, userId: string, type: string, name = id) =>
    s.finance(userId).upsertAccount({ id, connectionId: null, provider: "csv", externalId: null, identity: null, name, bankName: name, holder: "Matti Meikalainen", iban: null, currency: "EUR", type } as never);
  await account("a-chk", adminId, "checking");
  await account("a-card", adminId, "credit_card", "Esimerkki Kortti");
  await account("a-loan", adminId, "loan");
  await account("e-chk", eero.id, "checking");
  const tx = (id: string, userId: string, accountId: string, date: string, cents: number, o: { status?: string; category?: string; transfer?: boolean; currency?: string; merchant?: string } = {}) =>
    db.run(
      `INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, counterparty, merchant, category, category_source, is_transfer, source, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rule', ?, 'csv', '2026-10-09T10:00:00Z')`,
      [id, userId, accountId, date, cents, o.currency ?? "EUR", o.status ?? "booked", o.merchant ?? "ESIMERKKI KORTTI", o.merchant ?? "ESIMERKKI KORTTI", o.category ?? "card_bill", o.transfer ? 1 : 0],
    );
  await tx("bill1", adminId, "a-chk", "2026-03-10", -42000);
  await tx("bill2", adminId, "a-chk", "2026-04-10", -20000);
  await tx("pending", adminId, "a-chk", "2026-03-12", -1000, { status: "pending" });
  await tx("paired", adminId, "a-chk", "2026-03-13", -30000, { category: "transfer", transfer: true });
  await tx("loanrow", adminId, "a-loan", "2026-03-14", -30000, { category: "debt" });
  await tx("usd", adminId, "a-chk", "2026-03-15", -1000, { currency: "USD" });
  await tx("ebill", eero.id, "e-chk", "2026-03-10", -42000);
  const view = async () => (await s.analysis.get(s, adminId, "own")).ctx;
  return { ...app, eero, tx, view };
}

describe("statement rows of one card bill", () => {
  it("saves the rows of a booked card bill and moves nothing else; undo brings the bill back whole", async () => {
    const { admin, s, adminId, view } = await household();
    const before = await view();
    const flows = (c: typeof before) => JSON.stringify([c.txs.map((t) => [t.id, t.amountCents, t.flows, t.category]), c.recurring, [...c.returns]]);
    const res = await put(admin, "bill1", period());
    expect(res.status).toBe(200);
    expect(res.body.statement).toMatchObject({ billId: "bill1", explainedCents: 29150, restCents: 12850, read: true, reason: null, differenceCents: 12850, statementVsBillCents: 0 });
    const after = await view();
    expect(flows(after)).toBe(flows(before));
    expect(after.lowered.get("bill1")).toBe(12850);
    expect(spendRows(after, WHOLE_YEAR).reduce((n, t) => n + t.spend, 0)).toBe(spendRows(before, WHOLE_YEAR).reduce((n, t) => n + t.spend, 0));
    expect(after.explained.map((t) => [t.bookingDate, t.spend])).toEqual([["2026-02-03", 6150], ["2026-02-09", 8000], ["2026-02-20", 15000]]);
    // the stored bill is untouched
    expect(await s.finance(adminId).getTransaction("bill1")).toMatchObject({ amountCents: -42000, category: "card_bill", isTransfer: false });
    // the whole set is replaced, not added to
    expect((await put(admin, "bill1", period(CASE_A.slice(0, 1)))).body.statement).toMatchObject({ explainedCents: 6150 });
    expect((await admin.call("DELETE", "/api/statements/bill1")).body).toEqual({ ok: true });
    expect((await view()).explained).toEqual([]);
    expect((await view()).lowered.size).toBe(0);
    expect((await admin.call("DELETE", "/api/statements/bill1")).status).toBe(404);
  });

  it("refuses by the sum against the bill as stored, a cent over and a cent under", async () => {
    const { admin, view } = await household();
    const over = await put(admin, "bill1", period(rows(["2026-02-03", 42001, "ESIMERKKI KAUPPA"])));
    expect(over).toMatchObject({ status: 422, body: { code: "over_bill", excessCents: 1 } });
    expect(await put(admin, "bill1", period(rows(["2026-02-03", 42000, "ESIMERKKI KAUPPA"], ["2026-02-04", -100, "ESIMERKKI KAUPPA"])))).toMatchObject({ status: 200 });
    const under = await put(admin, "bill1", period(rows(["2026-02-03", 41999, "ESIMERKKI KAUPPA"])));
    expect(under.body.statement).toMatchObject({ restCents: 1 });
    expect((await view()).lowered.get("bill1")).toBe(1);
    expect(await put(admin, "bill1", period(rows(["2026-02-03", 6150, "K-MARKET ESIMERKKI"], ["2026-02-12", -38000, "MAKSU KIITOS"])))).toMatchObject({ status: 422, body: { code: "negative_sum" } });
    expect((await put(admin, "bill1", period(CASE_A, { statementCents: 42001 }))).body.statement).toMatchObject({ statementVsBillCents: 1, restCents: 12850 });
  });

  it("takes only a booked card bill of the member's own: not another member's, a pending one, a transfer, a loan account or another currency", async () => {
    const { admin, eero } = await household();
    expect((await put(admin, "ebill", period())).status).toBe(404);
    expect((await put(admin, "nothing", period())).status).toBe(404);
    expect(await put(admin, "pending", period())).toMatchObject({ status: 409, body: { code: "not_booked" } });
    for (const id of ["paired", "loanrow"]) expect(await put(admin, id, period())).toMatchObject({ status: 409, body: { code: "not_a_card_bill" } });
    expect(await put(admin, "usd", period())).toMatchObject({ status: 422, body: { code: "not_euro" } });
    expect((await put(eero, "ebill", period())).status).toBe(200);
    // the other member's rows are not the first member's to remove
    expect((await admin.call("DELETE", "/api/statements/ebill")).status).toBe(404);
    expect((await admin.call("GET", "/api/statements")).body.statements).toEqual([]);
  });

  it("refuses a day outside the period, a bad period, and a body that names more than a day, a sum and a text", async () => {
    const { admin, view } = await household();
    for (const day of ["2026-03-01", "0000-00-00", "2026-02-30", "2026-01-31"]) expect(await put(admin, "bill1", period(rows([day, 100, "X"])))).toMatchObject({ status: 422, body: { code: "day_out_of_period" } });
    for (const bad of [{ periodFrom: "2025-12-01" }, { periodTo: "2026-03-11" }, { periodFrom: "2026-03-01", periodTo: "2026-02-01" }]) expect(await put(admin, "bill1", period(CASE_A, bad))).toMatchObject({ status: 422, body: { code: "bad_period" } });
    for (const extra of [{ category: "groceries" }, { id: "x" }, { isTransfer: true }, { accountId: "e-chk" }, { userId: "u" }]) {
      expect((await put(admin, "bill1", period([{ day: "2026-02-03", cents: 100, text: "X", ...extra }] as never))).status).toBe(400);
    }
    expect((await put(admin, "bill1", { ...period(), category: "groceries" })).status).toBe(400);
    for (const cents of [0, 1.5, "100", null]) expect((await put(admin, "bill1", period([{ day: "2026-02-03", cents, text: "X" }] as never))).status).toBe(400);
    expect(await put(admin, "bill1", period(rows(["2026-02-03", 100, "x".repeat(121)])))).toMatchObject({ status: 422, body: { code: "bad_row" } });
    expect((await put(admin, "bill1", period(rows(["2026-02-03", 100, "\u0000 \u0007"])))).status).toBe(422);
    expect((await admin.call("GET", "/api/statements")).body.statements).toEqual([]);
    expect((await view()).explained).toEqual([]);
    // control characters are dropped from a text that has others
    expect((await put(admin, "bill1", period(rows(["2026-02-03", 100, "K-\u0000MARKET\u0007"])))).body.statement.rows[0].text).toBe("K-MARKET");
  });

  it("caps the rows of a bill and its bytes, and the writes of a member", async () => {
    const { admin } = await household();
    const many = (n: number, text = "X") => Array.from({ length: n }, (_, i) => ({ day: "2026-02-03", cents: 1, text: `${text}${i}` }));
    expect(await put(admin, "bill1", period(many(201)))).toMatchObject({ status: 422, body: { code: "too_many_rows" } });
    expect((await put(admin, "bill1", period(many(200)))).status).toBe(200);
    expect(await put(admin, "bill1", period(many(200, "€".repeat(100))))).toMatchObject({ status: 422, body: { code: "too_large" } });
    // 3 writes done; the 30th is the last of the minute
    for (let i = 0; i < 27; i++) expect((await put(admin, "bill1", period(many(1)))).status).toBe(200);
    const limited = await put(admin, "bill1", period(many(1)));
    expect(limited).toMatchObject({ status: 429, body: { code: "rate_limited" } });
    expect(limited.res.headers.get("retry-after")).toBeTruthy();
  });

  it("keeps two statements of one account apart: overlap refused, adjacent days accepted, a row held by the other bill asks", async () => {
    const { admin } = await household();
    expect((await put(admin, "bill1", period(rows(["2026-02-28", 5000, "K-MARKET ESIMERKKI"])))).status).toBe(200);
    expect(await put(admin, "bill2", { periodFrom: "2026-02-20", periodTo: "2026-03-20", rows: rows(["2026-03-05", 100, "X"]) })).toMatchObject({ status: 422, body: { code: "period_overlap", billId: "bill1" } });
    const adjacent = await put(admin, "bill2", { periodFrom: "2026-03-01", periodTo: "2026-03-31", rows: rows(["2026-03-05", 7000, "K-MARKET ESIMERKKI"]) });
    expect(adjacent.status).toBe(200);
    // a statement over two bills: a row typed under both is refused with the bill that holds it, never moved
    const both = await put(admin, "bill2", { periodFrom: "2026-02-28", periodTo: "2026-03-31", rows: rows(["2026-02-28", 5000, "K-MARKET ESIMERKKI"]) });
    expect(both).toMatchObject({ status: 409, body: { code: "duplicate_elsewhere", billId: "bill1" } });
    // twin rows inside one statement differ by their place and are both kept
    const twins = await put(admin, "bill1", period(rows(["2026-02-03", 500, "KAHVI"], ["2026-02-03", 500, "KAHVI"])));
    expect(twins.body.statement.rows).toHaveLength(2);
    // undo on the first, and the row can be typed under the second
    await admin.call("DELETE", "/api/statements/bill1");
    expect((await put(admin, "bill2", { periodFrom: "2026-02-28", periodTo: "2026-03-31", rows: rows(["2026-02-28", 5000, "K-MARKET ESIMERKKI"]) })).status).toBe(200);
  });

  it("sets the rows aside when the bank covers the period, deletes nothing, and attaches them when the cause goes", async () => {
    const { admin, db, s, tx, view } = await household();
    await put(admin, "bill1", period());
    const adminId = (await db.all<{ id: string }>("SELECT id FROM users WHERE username = 'aino'"))[0]!.id;
    await tx("card1", adminId, "a-card", "2026-02-15", -900, { category: "groceries", merchant: "K-Market" });
    await settle(s, adminId);
    const [covered] = (await admin.call("GET", "/api/statements")).body.statements;
    expect(covered).toMatchObject({ read: false, reason: "covered", detached: { reason: "covered" }, explainedCents: 29150 });
    expect((await view()).explained).toEqual([]);
    expect((await db.all("SELECT 1 FROM statement_rows")).length).toBe(3);
    await db.run("DELETE FROM transactions WHERE id = 'card1'");
    await settle(s, adminId);
    await settle(s, adminId);
    const [back] = (await admin.call("GET", "/api/statements")).body.statements;
    expect(back).toMatchObject({ read: true, reason: null, detached: null });
    // a bill set to another category by hand is set aside the same way, and brought back by undoing that
    await db.run("UPDATE transactions SET category = 'shopping', category_source = 'user' WHERE id = 'bill1'");
    await settle(s, adminId);
    expect((await admin.call("GET", "/api/statements")).body.statements[0]).toMatchObject({ read: false, reason: "not_card_bill", detached: { reason: "not_card_bill" } });
    await db.run("UPDATE transactions SET category = 'card_bill', category_source = 'rule' WHERE id = 'bill1'");
    await settle(s, adminId);
    expect((await admin.call("GET", "/api/statements")).body.statements[0]).toMatchObject({ read: true, detached: null });
  });

  it("a read writes nothing; a save syncs once; a reprocess sets the rows aside and attaches them again", async () => {
    const { admin, db, s, adminId, tx } = await household();
    // set by hand, so that the reprocess keeps the bill a card bill whatever else the rows say
    await db.run("UPDATE transactions SET category_source = 'user' WHERE id = 'bill1'");
    const counted = { n: 0 };
    const get = s.analysis.get.bind(s.analysis);
    (s.analysis as unknown as { get: unknown }).get = (...a: Parameters<typeof get>) => {
      counted.n++;
      return get(...a);
    };
    // a save reads the context once to sync and once for the answer; the sync is not run again for the answer
    expect((await put(admin, "bill1", period())).status).toBe(200);
    expect(counted.n).toBe(2);
    await tx("card1", adminId, "a-card", "2026-02-15", -900, { category: "groceries", merchant: "K-Market" });
    await s.settings.bumpUserDataVersion(adminId);
    counted.n = 0;
    // the context says the bank covers the period, and the list tells it, but the stored mark is as the save left it
    const [seen] = (await admin.call("GET", "/api/statements")).body.statements;
    expect(seen).toMatchObject({ read: false, reason: "covered", detached: null });
    expect(counted.n).toBe(1);
    expect(await detachedOf(db)).toEqual([["bill1", false, null]]);
    // the reprocess every import, sync and rule change ends in is where the mark is written
    await reprocess(s.finance(adminId), s.settings);
    expect(await detachedOf(db)).toEqual([["bill1", true, "covered"]]);
    expect((await admin.call("GET", "/api/statements")).body.statements[0]).toMatchObject({ read: false, detached: { reason: "covered" } });
    await db.run("DELETE FROM transactions WHERE id = 'card1'");
    await reprocess(s.finance(adminId), s.settings);
    expect(await detachedOf(db)).toEqual([["bill1", false, null]]);
    expect((await admin.call("GET", "/api/statements")).body.statements[0]).toMatchObject({ read: true, detached: null });
  });

  it("covered only by a card whose rows span the period: a lapsed consent and another card leave the rows read", async () => {
    const { admin, db, s, adminId, tx, view } = await household();
    await put(admin, "bill1", period());
    const state = async () => (await view()).statements.get("bill1");
    // the card's rows ended in December and the bill is of March: the statement is all there is of February
    await tx("old", adminId, "a-card", "2025-12-10", -900, { category: "groceries", merchant: "K-Market" });
    await settle(s, adminId);
    expect(await state()).toEqual({ read: true });
    expect((await admin.call("GET", "/api/statements")).body.statements[0]).toMatchObject({ read: true, detached: null });
    // rows of another card in the period do not cover the bill that names this one
    await s.finance(adminId).upsertAccount({ id: "a-card2", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Toinen Pankki Visa", bankName: "Toinen", holder: "Matti Meikalainen", iban: null, currency: "EUR", type: "credit_card" } as never);
    await tx("other", adminId, "a-card2", "2026-02-15", -900, { category: "groceries", merchant: "K-Market" });
    await settle(s, adminId);
    expect(await state()).toEqual({ read: true });
    // the card's own row in the period covers it, with the old December row before it
    await tx("in", adminId, "a-card", "2026-02-15", -900, { category: "groceries", merchant: "K-Market" });
    await settle(s, adminId);
    expect(await state()).toEqual({ read: false, reason: "covered" });
    expect(await detachedOf(db)).toEqual([["bill1", true, "covered"]]);
  });

  it("a bill that pairs after its statement is set aside and counts as the bank says; a bill that stays a card bill is read", async () => {
    const { admin, db, s, adminId, view } = await household();
    await put(admin, "bill1", period());
    expect((await view()).lowered.get("bill1")).toBe(12850);
    await db.run("UPDATE transactions SET category = 'transfer', is_transfer = 1 WHERE id = 'bill1'");
    await settle(s, adminId);
    expect((await view()).statements.get("bill1")).toEqual({ read: false, reason: "not_card_bill" });
    expect((await view()).explained).toEqual([]);
    expect(await detachedOf(db)).toEqual([["bill1", true, "not_card_bill"]]);
    await db.run("UPDATE transactions SET category = 'card_bill', is_transfer = 0 WHERE id = 'bill1'");
    await settle(s, adminId);
    expect((await view()).lowered.get("bill1")).toBe(12850);
    expect(await detachedOf(db)).toEqual([["bill1", false, null]]);
  });

  it("a bill of a joint account is cut once: the members' explained sums and rests add up to the bill's", async () => {
    const { admin, db, s, adminId, eero, tx } = await household();
    // 1.50 paid from the account that Aino and Eero use as 7 to 3, with 1.05 of it explained by rows
    await tx("jbill", adminId, "a-chk", "2026-03-20", -150);
    const account = (await s.finance(adminId).getAccount("a-chk"))!;
    await s.household.setUse(accountKey(account), [{ userId: adminId, weight: 7 }, { userId: eero.id, weight: 3 }], adminId, "2026-03-01T10:00:00Z");
    await db.run("INSERT INTO account_shares (account_id, user_id, created_at) VALUES ('a-chk', ?, '2026-03-01T10:00:00.000Z')", [eero.id]);
    await s.settings.bumpUserDataVersion(adminId);
    const body = { periodFrom: "2026-03-12", periodTo: "2026-03-19", statementCents: null, rows: rows(["2026-03-13", 100, "K-MARKET ESIMERKKI"], ["2026-03-14", 5, "KAHVI"]) };
    expect((await put(admin, "jbill", body)).status).toBe(200);
    const mine = async (id: string) => {
      const ctx = (await s.analysis.get(s, id, "own")).ctx;
      return { explained: ctx.explained.reduce((n, t) => n + t.spend, 0), rest: ctx.lowered.get("jbill"), read: ctx.statements.get("jbill") };
    };
    const [a, e] = [await mine(adminId), await mine(eero.id)];
    expect([a.read, e.read]).toEqual([{ read: true }, { read: true }]);
    expect(a.explained + e.explained).toBe(105);
    expect(a.rest! + e.rest!).toBe(45);
    // each member's own figure is their part of the bill: 1.05 and 0.45
    expect(a.explained + a.rest!).toBe(105);
    expect(e.explained + e.rest!).toBe(45);
    expect(await db.all("SELECT 1 FROM statement_rows WHERE bill_tx_id = 'jbill'")).toHaveLength(2);
  });

  it("drops invisible and bidirectional control characters from a text before it is stored and keyed", async () => {
    const { admin } = await household();
    const res = await put(admin, "bill1", period(rows(["2026-02-28", 5000, "K-‮MARKET​ ⁦ESIMERKKI﻿ "])));
    expect(res.body.statement.rows[0].text).toBe("K-MARKET ESIMERKKI");
    // the same row with other invisible characters is the same row: it cannot be typed under a second bill
    const twin = await put(admin, "bill2", { periodFrom: "2026-02-20", periodTo: "2026-03-20", rows: rows(["2026-02-28", 5000, "K-MARKET‍ ESIMERKKI‬"]) });
    expect(twin).toMatchObject({ status: 409, body: { code: "duplicate_elsewhere", billId: "bill1" } });
    // a text that is only invisible characters is no text
    expect(await put(admin, "bill1", period(rows(["2026-02-28", 100, "​‮"])))).toMatchObject({ status: 422, body: { code: "bad_row" } });
  });

  it("moves the user's data version on a save and on an undo", async () => {
    const { admin, adminId, s } = await household();
    const version = () => s.settings.get(`data_version:${adminId}`);
    const v0 = await version();
    expect((await put(admin, "bill1", period())).status).toBe(200);
    const v1 = await version();
    expect(v1).not.toBe(v0);
    expect((await admin.call("DELETE", "/api/statements/bill1")).status).toBe(200);
    expect(await version()).not.toBe(v1);
  });

  it("keeps a bill's statement rows when its account is merged into another, also when the bill's id changes", async () => {
    const { admin, adminId, s, db, view } = await household();
    await put(admin, "bill1", period());
    await put(admin, "bill2", { periodFrom: "2026-03-01", periodTo: "2026-03-31", rows: rows(["2026-03-02", 100, "X"]) });
    await s.finance(adminId).upsertAccount({ id: "a-bank", connectionId: null, provider: "csv", externalId: null, identity: "idn-1", name: "Pankki", bankName: "Pankki", holder: "Matti Meikalainen", iban: null, currency: "EUR", type: "checking" } as never);
    await s.finance(adminId).mergeAccountInto("a-chk", "a-bank", new Map([["bill2", "bill2-new"]]));
    const held = await db.all<{ bill_tx_id: string }>("SELECT bill_tx_id FROM statement_bill ORDER BY bill_tx_id");
    expect(held.map((h) => h.bill_tx_id)).toEqual(["bill1", "bill2-new"]);
    expect((await db.all("SELECT 1 FROM statement_rows WHERE bill_tx_id IN ('bill1', 'bill2-new')")).length).toBe(4);
    expect((await db.all<{ account_id: string }>("SELECT account_id FROM transactions WHERE id IN ('bill1', 'bill2-new')")).map((r) => r.account_id)).toEqual(["a-bank", "a-bank"]);
    expect((await view()).explained.length).toBeGreaterThan(0);
  });

  it("goes with the bill, the account and the member (cascade)", async () => {
    const { admin, db } = await household();
    await put(admin, "bill1", period());
    await put(admin, "bill2", { periodFrom: "2026-03-01", periodTo: "2026-03-31", rows: rows(["2026-03-02", 100, "X"]) });
    await db.run("DELETE FROM transactions WHERE id = 'bill1'");
    expect((await db.all("SELECT 1 FROM statement_bill")).length).toBe(1);
    expect((await db.all("SELECT 1 FROM statement_rows")).length).toBe(1);
    await db.run("DELETE FROM accounts WHERE id = 'a-chk'");
    expect((await db.all("SELECT 1 FROM statement_bill")).length).toBe(0);
    expect((await db.all("SELECT 1 FROM statement_rows")).length).toBe(0);
  });
});
