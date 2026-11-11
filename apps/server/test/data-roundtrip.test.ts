/** "Tuo tiedot": the file of "Vie kaikki tiedot" read back, and every hostile file refused with nothing changed. */
import { describe, expect, it } from "vitest";
import { CATEGORY_SOURCES, PAYER_ROLES } from "@banking/core";
import type { Db } from "../src/db/types.ts";
import { IMPORT_BY_KEY, IMPORT_LIMITS, importStores } from "../src/services/data-import-stores.ts";
import { exportStores, storeColumns } from "../src/services/data-export-stores.ts";
import { perfHousehold } from "./perf-household.ts";
import { setupApp } from "./helpers.ts";
import { check, commit, exportOf, HEAD_KEYS, importFile, upload, type File, type Setup, type Who } from "./data-import-kit.ts";

const AT = "2026-10-01T00:00:00Z";

/** Every table but the ones a request itself writes, as text: two snapshots are equal when nothing was changed. */
async function snapshot(db: Db): Promise<string> {
  const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('sessions', 'security_events', 'sqlite_sequence') ORDER BY name")).map((t) => t.name);
  const out: Record<string, unknown> = {};
  for (const t of tables) out[t] = (await db.all(`SELECT * FROM ${t}`)).map((r) => JSON.stringify(r)).sort();
  return JSON.stringify(out);
}

/** A file with the ids of users and the autoincrement ids of rules taken out, the people named by their username. */
function plain(file: File): File {
  const names = new Map<string, string>((file.users as { id: string; username: string }[]).flatMap((u) => [[u.id, `user:${u.username}`], [`u:${u.id}`, `u:user:${u.username}`]]));
  const out: File = {};
  for (const [key, rows] of Object.entries(file)) {
    if (HEAD_KEYS.includes(key) || key === "users" || !Array.isArray(rows)) continue;
    out[key] = rows.map((r: Record<string, unknown>) => {
      const o: Record<string, unknown> = {};
      // a statement's detached mark is derived: the reprocess after an import works it out again for the new instance
      for (const [k, v] of Object.entries(r)) if (!(key === "rules" && k === "id") && !(key === "statementBills" && k.startsWith("detached_"))) o[k] = typeof v === "string" && names.has(v) ? names.get(v) : v;
      return o;
    });
  }
  return out;
}

/** What a member keeps, one value in each store: written into the tables, as the export reads them. */
async function keep(db: Db, userId: string, tag: string, other?: string) {
  const [acc, tx1, tx2] = [`${tag}-acc`, `${tag}-tx1`, `${tag}-tx2`];
  await db.run("INSERT INTO accounts (id, user_id, provider, identity, name, iban, currency, type, created_at, balance_cents, balance_at) VALUES (?, ?, 'csv', ?, ?, ?, 'EUR', 'checking', ?, 12345, ?)", [acc, userId, `${tag}-ident`, `${tag} tili`, `FI000000000000${tag.length}`, AT, AT]);
  for (const [id, cents, who] of [[tx1, -1250, "ESIMERKKI OY"], [tx2, 90000, "ESIMERKKI TYONANTAJA"]] as const) {
    await db.run(
      `INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, counterparty, merchant, category, category_source, is_transfer, source, imported_at, search_text)
       VALUES (?, ?, ?, '2026-09-30', ?, 'EUR', 'booked', ?, ?, 'groceries', 'user', 0, 'csv', ?, ?)`,
      [id, userId, acc, cents, who, who, AT, who.toLowerCase()],
    );
  }
  const run = (sql: string, ...p: (string | number | null)[]) => db.run(sql, p);
  await run("INSERT INTO category_rules (user_id, field, pattern, category, priority, created_at) VALUES (?, 'merchant', ?, 'groceries', 10, ?)", userId, `${tag}-RULE`, AT);
  await run("INSERT INTO user_marks (user_id, subject, mark, marked_at) VALUES (?, ?, 'in_use', ?)", userId, `${tag}-MARK`, AT);
  await run("INSERT INTO optimise_inputs (user_id, key, value, as_of) VALUES (?, ?, '1', '2026-10-01')", userId, `${tag}-INPUT`);
  await run("INSERT INTO optimise_states (user_id, finding_id, status, decided_at) VALUES (?, ?, 'done', ?)", userId, `${tag}-STATE`, AT);
  await run("INSERT INTO optimise_snapshots (user_id, month, data, created_at) VALUES (?, '2026-09', '{}', ?)", userId, AT);
  await run("INSERT INTO contract_terms (user_id, series_key, answered_at, notice_days) VALUES (?, ?, ?, 30)", userId, `${tag}-TERMS`, AT);
  await run("INSERT INTO payer_role (scope, user_id, counterparty_key, role, answered_by, answered_at) VALUES ('member', ?, ?, 'sales', ?, ?)", userId, `${tag}-PAYER`, userId, AT);
  await run("INSERT INTO expected_bills (id, user_id, name, amount_cents, due_date, cadence, created_at) VALUES (?, ?, ?, 100, '2026-11-01', 'once', ?)", `${tag}-bill`, userId, `${tag} lasku`, AT);
  await run("INSERT INTO spending_goal (user_id, monthly_cents, updated_at) VALUES (?, 250000, ?)", userId, AT);
  await run("INSERT INTO category_goal (user_id, category, monthly_cents, updated_at) VALUES (?, 'groceries', 60000, ?)", userId, AT);
  await run("INSERT INTO owner_answer (account_key, kind, key, owner, said_by, said_at) VALUES (?, 'in', ?, ?, ?, ?)", `${tag}-ident`, `${tag}-ANSWER`, `u:${userId}`, userId, AT);
  await run("INSERT INTO account_balances (account_key, day, type, cents, fetched_at, source) VALUES (?, '2026-09-30', 'closingBooked', 5, ?, 'csv')", `${tag}-ident`, AT);
  await run("INSERT INTO account_use (account_key, user_id, weight, said_by, said_at) VALUES (?, ?, 1, ?, ?)", `${tag}-ident`, userId, userId, AT);
  await run("INSERT INTO account_split (account_key, mode, set_by, set_at) VALUES (?, 'source', ?, ?)", `${tag}-ident`, userId, AT);
  await run("INSERT INTO account_agreement (account_key, valid_from, kind, value, set_by, set_at) VALUES (?, '2026-01-01', 'equal', ?, ?, ?)", `${tag}-ident`, JSON.stringify({ who: [`u:${tag}`] }), userId, AT);
  await run("INSERT INTO foreign_rows (account_key, raw_key, booking_date, amount_minor, scale, currency, text, seen_at) VALUES (?, 'r1', '2026-09-30', -500, 2, 'SEK', 'ESIMERKKI AB', ?)", `${tag}-ident`, AT);
  await run("INSERT INTO tx_part (tx_id, owner, kind, grp, cents, passed) VALUES (?, ?, 'spend', 'groceries', 1250, 0)", tx1, `u:${userId}`);
  await run("INSERT INTO loans (id, user_id, name, kind, balance_cents, balance_date, rate_bp, created_at, updated_at) VALUES (?, ?, ?, 'consumer', 100000, '2026-09-01', 500, ?, ?)", `${tag}-loan`, userId, `${tag} laina`, AT, AT);
  await run("INSERT INTO statement_bill (bill_tx_id, user_id, account_key, period_from, period_to, statement_cents, saved_at) VALUES (?, ?, ?, '2026-08-01', '2026-08-31', 5000, ?)", tx1, userId, `${tag}-ident`, AT);
  await run("INSERT INTO statement_rows (id, bill_tx_id, account_key, user_id, day, cents, text, row_key, imported_at) VALUES (?, ?, ?, ?, '2026-08-05', -500, 'ESIMERKKI KAUPPA', 'k1', ?)", `${tag}-srow`, tx1, `${tag}-ident`, userId, AT);
  await run("INSERT INTO account_history (account_id, asked_from, first_row_day, source, recorded_at) VALUES (?, '2026-01-01', '2026-02-01', 'csv', ?)", acc, AT);
  await run("INSERT INTO household_member (id, name, weight, created_at) VALUES (?, ?, 1, ?)", `${tag}-hm`, `${tag} jasen`, AT);
  await run("INSERT INTO valued_asset (id, kind, name, day, cents) VALUES (?, 'home', ?, '2026-09-01', 20000000)", `${tag}-asset`, `${tag} asunto`);
  if (other) await run("INSERT INTO account_shares (account_id, user_id, created_at) VALUES (?, ?, ?)", acc, other, AT);
}

/** Two instances with the same usernames; the first holds the data. */
async function pair() {
  const a = await setupApp();
  const ka = await a.member("kaisa");
  const b = await setupApp();
  const kb = await b.member("kaisa");
  await keep(a.db, a.adminId, "aino");
  await keep(a.db, ka.id, "kaisa");
  return { a, ka, b, kb };
}

describe("what the import knows of each store", () => {
  it("names every store of the export and every column of it", async () => {
    const setup = await setupApp();
    expect(importStores().map((s) => s.key)).toEqual(exportStores().map((s) => s.key));
    for (const store of exportStores()) {
      const known = IMPORT_BY_KEY.get(store.key)!;
      expect(known.table, store.key).toBe(store.table);
      const written = [...(await storeColumns(setup.s, store)), ...(store.owner ? ["owner_username"] : []), ...(store.key === "transactions" ? ["signature"] : [])].sort();
      expect([...Object.keys(known.cols), ...(known.extra ?? [])].sort(), store.key).toEqual(written);
    }
  });
});

describe("a file read back", () => {
  it("each user imports their own file into an empty instance with the same usernames: every array equal after", async () => {
    const { a, ka, b, kb } = await pair();
    await a.admin.call("POST", "/api/demo");
    const [fileAino, fileKaisa] = [await exportOf(a.admin), await exportOf(ka)];
    expect(fileAino.transactions.length).toBeGreaterThan(50);
    const aino = await importFile(b.admin, fileAino);
    expect(aino.done.committed).toBe(true);
    await importFile(kb, fileKaisa);
    expect(plain(await exportOf(b.admin))).toEqual(plain(fileAino));
    expect(plain(await exportOf(kb))).toEqual(plain(fileKaisa));
    // nothing but the household's rows was made: the users are the two that were there
    expect(await b.db.all("SELECT username FROM users ORDER BY username")).toEqual([{ username: "aino" }, { username: "kaisa" }]);
  });

  it("twice adds nothing, and into the instance it came from adds nothing", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    await importFile(b.admin, file);
    const before = await snapshot(b.db);
    const again = await importFile(b.admin, file);
    expect(again.dry.total.add).toBe(0);
    expect(again.done.total).toEqual({ add: 0, exists: expect.any(Number), skipped: expect.any(Number) });
    expect(await snapshot(b.db)).toBe(before);
    const origin = await snapshot(a.db);
    const home = await importFile(a.admin, file);
    expect(home.done.total.add).toBe(0);
    expect(await snapshot(a.db)).toBe(origin);
    expect(home.done.stores.find((s: { key: string }) => s.key === "transactions")).toMatchObject({ add: 0, exists: 2 });
  });

  it("answers per store what it adds, keeps and skips, and writes nothing in the dry run", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const before = await snapshot(b.db);
    const up = await upload(b.admin, { ...file, mystery: [{ x: 1 }, { x: 2 }], accounts: file.accounts.map((r: object) => ({ ...r, surprise: 1 })) });
    const dry = (await check(b.admin, up.id!)).body;
    expect(await snapshot(b.db)).toBe(before);
    expect(dry.stores.find((s: { key: string }) => s.key === "accounts")).toEqual({ key: "accounts", add: 1, exists: 0, skipped: [] });
    expect(dry.stores.find((s: { key: string }) => s.key === "transactions")).toEqual({ key: "transactions", add: 2, exists: 0, skipped: [] });
    expect(dry.ignored).toEqual({ stores: [{ key: "mystery", rows: 2 }], keys: 1 });
    expect(dry.head).toMatchObject({ version: 1, appVersion: a.s.build.version });
    expect(dry.committed).toBe(false);
    expect(dry.stores.find((s: { key: string }) => s.key === "accountShares")).toBeUndefined();
  });

  it("a row in another currency is skipped with the reason currency, with its parts; the euro rows, a foreign account and foreignRows are taken", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const usd = { ...file.transactions[0], id: "usd-tx", currency: "USD", amount_cents: -5000 };
    const usdPart = { ...file.parts[0], tx_id: "usd-tx", cents: 5000 };
    const sek = { ...file.accounts[0], currency: "SEK" };
    const bad = { ...file, transactions: [...file.transactions, usd], parts: [...file.parts, usdPart], accounts: [sek, ...file.accounts.slice(1)] };
    const before = await snapshot(b.db);
    const up = await upload(b.admin, bad);
    const dry = (await check(b.admin, up.id!)).body;
    expect(await snapshot(b.db)).toBe(before);
    expect(dry.stores.find((s: { key: string }) => s.key === "transactions")).toMatchObject({ add: 2, skipped: [{ reason: "currency", n: 1 }] });
    expect(dry.stores.find((s: { key: string }) => s.key === "parts")).toMatchObject({ skipped: [{ reason: "currency", n: 1 }] });
    expect(dry.stores.find((s: { key: string }) => s.key === "accounts")).toMatchObject({ add: 1, skipped: [] });
    await commit(b.admin, up.id!);
    expect(await b.db.first("SELECT COUNT(*) AS n FROM transactions WHERE currency != 'EUR'")).toEqual({ n: 0 });
    expect(await b.db.first("SELECT COUNT(*) AS n FROM transactions")).toEqual({ n: 2 });
    expect(await b.db.first("SELECT COUNT(*) AS n FROM tx_part WHERE tx_id = 'usd-tx'")).toEqual({ n: 0 });
    expect(await b.db.first("SELECT currency FROM accounts")).toEqual({ currency: "SEK" });
    expect(await b.db.first("SELECT COUNT(*) AS n FROM foreign_rows")).toEqual({ n: 1 });
  });

  it("the sync's match: a row the bank gave under another id is kept as it is, and an account is matched by its identity or IBAN", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    // the same real account here under another id, with the same two rows booked under ids of the bank's own
    await b.db.run("INSERT INTO accounts (id, user_id, provider, identity, name, iban, currency, type, created_at) VALUES ('eb-1', ?, 'enablebanking', 'aino-ident', 'Käyttötili', 'FI0000000000004', 'EUR', 'checking', ?)", [b.adminId, AT]);
    for (const [id, cents, who] of [["bank-1", -1250, "ESIMERKKI OY"], ["bank-2", 90000, "ESIMERKKI TYONANTAJA"]] as const) {
      await b.db.run(
        `INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, counterparty, merchant, category, category_source, is_transfer, source, imported_at, search_text)
         VALUES (?, ?, 'eb-1', '2026-09-30', ?, 'EUR', 'booked', ?, ?, 'groceries', 'rule', 0, 'enablebanking', ?, '')`,
        [id, b.adminId, cents, who, who, AT],
      );
    }
    const done = (await importFile(b.admin, file)).done;
    expect(done.stores.find((s: { key: string }) => s.key === "accounts")).toMatchObject({ add: 0, exists: 1 });
    expect(done.stores.find((s: { key: string }) => s.key === "transactions")).toMatchObject({ add: 0, exists: 2 });
    expect(await b.db.all("SELECT id FROM transactions ORDER BY id")).toEqual([{ id: "bank-1" }, { id: "bank-2" }]);
    expect((await b.db.all<{ id: string }>("SELECT id FROM accounts")).map((r) => r.id)).toEqual(["eb-1"]);
    // the rows kept the bank's id and source: nothing of the file overwrote them
    expect(await b.db.all("SELECT source, imported_at FROM transactions WHERE id = 'bank-1'")).toEqual([{ source: "enablebanking", imported_at: AT }]);
    // the answers hang on the real account's key, which is the same one here
    expect((await b.db.all<{ key: string }>("SELECT key FROM owner_answer")).map((r) => r.key)).toEqual(["aino-ANSWER"]);
  });

  it("a new account has no bank link, an id taken by another user's row gets a fresh one, and a signature is used once", async () => {
    const { a, b, kb } = await pair();
    const file = await exportOf(a.admin);
    // kaisa's account here already has the id the file gives aino's account, and one of its transactions
    await b.db.run("INSERT INTO accounts (id, user_id, provider, name, currency, type, created_at) VALUES ('aino-acc', ?, 'csv', 'Kaisan', 'EUR', 'checking', ?)", [kb.id, AT]);
    await b.db.run("INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, merchant, category, category_source, is_transfer, source, imported_at) VALUES ('aino-tx1', ?, 'aino-acc', '2020-01-01', 1, 'EUR', 'booked', 'X', 'other', 'default', 0, 'csv', ?)", [kb.id, AT]);
    // two identical rows in the file: both are added, as they are two rows of the bank
    const twin = { ...file.transactions[0], id: "aino-tx1-twin" };
    const kaisaBefore = await b.db.all("SELECT * FROM accounts WHERE user_id = ?", [kb.id]);
    await importFile(b.admin, { ...file, transactions: [...file.transactions, twin] });
    const mine = await b.db.all<Record<string, string | null>>("SELECT * FROM accounts WHERE user_id = ?", [b.adminId]);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ connection_id: null, external_id: null, provider: "csv", identity: "aino-ident" });
    expect(String(mine[0]!.id)).not.toBe("aino-acc");
    expect(await b.db.all("SELECT * FROM accounts WHERE user_id = ?", [kb.id])).toEqual(kaisaBefore);
    expect(await b.db.first("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?", [b.adminId])).toEqual({ n: 3 });
    expect(await b.db.first("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND account_id = ?", [b.adminId, String(mine[0]!.id)])).toEqual({ n: 3 });
    expect(await b.db.first("SELECT merchant FROM transactions WHERE id = 'aino-tx1'")).toEqual({ merchant: "X" });
  });
});

describe("another user's rows", () => {
  it("are counted as someone else's and never written: the file of a household member imported by the other", async () => {
    const { a, ka, b } = await pair();
    // kaisa shares her account with aino: aino's file holds kaisa's account, its rows and her answers about it
    await a.db.run("INSERT INTO account_shares (account_id, user_id, created_at) VALUES ('kaisa-acc', ?, ?)", [a.adminId, AT]);
    const file = await exportOf(a.admin);
    expect(file.accounts.map((r: { owner_username: string }) => r.owner_username).sort()).toEqual(["aino", "kaisa"]);
    const before = await snapshot(b.db);
    const up = await upload(b.admin, file);
    const dry = (await check(b.admin, up.id!)).body;
    const accounts = dry.stores.find((s: { key: string }) => s.key === "accounts");
    expect(accounts).toMatchObject({ add: 1, skipped: [{ reason: "other_user", n: 1 }] });
    expect(dry.stores.find((s: { key: string }) => s.key === "transactions")).toMatchObject({ add: 2, skipped: [{ reason: "other_user", n: 2 }] });
    expect(dry.stores.find((s: { key: string }) => s.key === "answers")).toMatchObject({ add: 1, skipped: [{ reason: "other_user", n: 1 }] });
    expect(dry.stores.find((s: { key: string }) => s.key === "accountShares")).toMatchObject({ add: 0, skipped: [{ reason: "sharing", n: expect.any(Number) }] });
    expect(dry.otherUsers).toEqual([{ username: "kaisa", rows: expect.any(Number) }]);
    expect(dry.otherUsers[0].rows).toBeGreaterThan(5);
    expect(await snapshot(b.db)).toBe(before);
    await commit(b.admin, up.id!);
    expect(await b.db.all("SELECT id FROM accounts")).toEqual([{ id: "aino-acc" }]);
    expect(await b.db.first("SELECT COUNT(*) AS n FROM user_marks WHERE user_id != ?", [b.adminId])).toEqual({ n: 0 });
    expect(await b.db.first("SELECT COUNT(*) AS n FROM account_shares")).toEqual({ n: 0 });
    expect(ka.id).toBeTruthy();
  });
});

describe("a hostile file is refused and changes nothing", () => {
  const refusedWith = async (setup: Setup, who: Who, file: File, sentence: RegExp, over?: Parameters<typeof upload>[2]) => {
    const before = await snapshot(setup.db);
    const up = await upload(who, file, over);
    let res = up.refused;
    if (!res) res = await check(who, up.id!);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(sentence);
    // the session is gone: the commit of the same id has nothing to commit
    if (up.id) expect((await commit(who, up.id)).status).toBe(400);
    expect(await snapshot(setup.db)).toBe(before);
  };

  it("another version, another format, no head", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    await refusedWith(b, b.admin, file, /version/, { head: { format: "omatalous-export", version: 2 } });
    await refusedWith(b, b.admin, file, /version/, { head: { format: "omatalous-export", version: "1" } });
    await refusedWith(b, b.admin, file, /tietotiedosto/, { head: { format: "muu", version: 1 } });
    await refusedWith(b, b.admin, file, /tietotiedosto/, { head: {} });
  });

  it("the bank's text keeps 20 000 characters and a control character; one more, or a control character elsewhere, is refused", async () => {
    const { a, b } = await pair();
    const long = "x".repeat(19999) + "\u0007";
    const fields = ["description", "counterparty", "reference", "merchant"];
    // the long text is stored in the exporting database itself, so the export holds its real signature
    await a.db.run("UPDATE transactions SET description = ?, counterparty = ?, reference = ?, merchant = ? WHERE id = 'aino-tx1'", [long, long, long, long]);
    const full = await exportOf(a.admin);
    const tx = full.transactions.find((t: { id: string }) => t.id === "aino-tx1")!;
    for (const f of fields) expect(tx[f]).toBe(long);
    const ok = await importFile(b.admin, full);
    expect(ok.done.committed).toBe(true);
    const row = (await b.db.all("SELECT description, counterparty, reference, merchant FROM transactions WHERE id = 'aino-tx1'"))[0] as Record<string, string>;
    for (const f of fields) expect(row[f]).toBe(long);
    const again = await exportOf(b.admin);
    expect(again.transactions.find((t: { id: string }) => t.id === "aino-tx1")!.signature).toBe(tx.signature);
    const file = await exportOf(a.admin);
    for (const f of fields) await refusedWith(b, b.admin, { ...file, transactions: [{ ...tx, id: "other-" + f, [f]: long + "y" }] }, /transactions rivi 1 on virheellinen/);
    await refusedWith(b, b.admin, { ...file, transactions: [{ ...tx, category: "a\u0007b" }] }, /transactions rivi 1 on virheellinen \(category\)/);
    await refusedWith(b, b.admin, { ...file, rules: [{ ...file.rules[0], pattern: "a\u0007b" }] }, /rules rivi 1/);
    await refusedWith(b, b.admin, { ...file, users: [{ ...file.users[0], username: "a\u0007b" }] }, /users rivi 1/);
  });

  it("bad types, lengths and lists, and a control character", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const tx = file.transactions[0];
    for (const bad of [{ amount_cents: "12" }, { amount_cents: 1.5 }, { amount_cents: 1e20 }, { booking_date: "2026-02-30" }, { status: "other" }, { description: "x".repeat(20001) }, { id: "a\u0000b" }, { currency: "euro" }, { is_transfer: 2 }, { id: null }, { category_source: "hacked" }]) {
      await refusedWith(b, b.admin, { ...file, transactions: [{ ...tx, ...bad }] }, /transactions rivi 1 on virheellinen/);
    }
    await refusedWith(b, b.admin, { ...file, transactions: [{ ...tx, amount_cents: undefined }] }, /amount_cents/);
    await refusedWith(b, b.admin, { ...file, rules: [{ ...file.rules[0], field: "regex" }] }, /rules rivi 1/);
    const started = await b.admin.call("POST", "/api/data/import", { format: "omatalous-export", version: 1 });
    const notList = await b.admin.call("POST", `/api/data/import/${started.body.session}/chunk`, { seq: 0, stores: { accounts: "not a list" } });
    expect(notList.body.error).toMatch(/väärän muotoinen/);
    await refusedWith(b, b.admin, { ...file, loans: [{ ...file.loans[0], balance_cents: -5 }] }, /loans rivi 1/);
    await refusedWith(b, b.admin, { ...file, loans: [{ ...file.loans[0], kind: "payday" }] }, /loans rivi 1/);
    await refusedWith(b, b.admin, { ...file, transactions: ["text"] }, /rivi 1/);
    // a member's answer belongs to a person, a household's to nobody: the two must not be mixed
    const role = { scope: "member", user_id: null, counterparty_key: "ESIMERKKI", role: "sales", answered_by: null, answered_at: AT };
    await refusedWith(b, b.admin, { ...file, payerRoles: [role] }, /payerRoles rivi 1 viittaa riviin \(scope\)/);
    // a role the app does not know is refused like any other bad row; the five it knows pass
    const bad = { ...role, scope: "household", role: "boss" };
    await refusedWith(b, b.admin, { ...file, payerRoles: [bad] }, /payerRoles rivi 1 on virheellinen \(role\)/);
    await importFile(b.admin, { ...file, payerRoles: PAYER_ROLES.map((r, i) => ({ ...bad, counterparty_key: `ESIMERKKI${i}`, role: r })) });
    expect(await b.db.all("SELECT role FROM payer_role WHERE counterparty_key LIKE 'ESIMERKKI%' ORDER BY counterparty_key")).toEqual(PAYER_ROLES.map((r) => ({ role: r })));
  });

  it("takes back every category source the app writes", async () => {
    // the import once knew five of them, so a household's own file with a row the register named was refused
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const tx = file.transactions[0];
    await importFile(b.admin, { ...file, transactions: [...file.transactions, ...CATEGORY_SOURCES.map((s, i) => ({ ...tx, id: `src-${i}`, category_source: s }))] });
    expect(await b.db.all("SELECT id FROM transactions WHERE id LIKE 'src-%'")).toHaveLength(CATEGORY_SOURCES.length);
  });

  it("an array over its cap and a chunk over its size", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const bill = file.expectedBills[0];
    await refusedWith(b, b.admin, { ...file, expectedBills: Array.from({ length: 101 }, (_, i) => ({ ...bill, id: `x${i}` })) }, /liikaa rivejä/);
    const started = await b.admin.call("POST", "/api/data/import", { format: "omatalous-export", version: 1 });
    const huge = await b.admin.call("POST", `/api/data/import/${started.body.session}/chunk`, { seq: 0, stores: { marks: [{ ...file.marks[0], subject: "x".repeat(IMPORT_LIMITS.chunkBytes) }] } });
    expect(huge.status).toBe(400);
    expect(huge.body.error).toMatch(/liian suuri/);
  });

  // one balance per account, day and type: n rows, kept short (no reference day): the session holds 64 MiB of text, which a row with every column fills at about 480 000 rows
  const balanceRows = (key: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      account_key: key,
      day: new Date(Date.UTC(1990, 0, 1) + (i % 20_000) * 86_400_000).toISOString().slice(0, 10),
      type: `t${Math.floor(i / 20_000)}`,
      cents: i,
      fetched_at: AT,
      source: "c",
    }));

  it("a file of 50 001 balance days is taken whole", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const key = file.accountBalances[0].account_key;
    const before = (await b.db.all("SELECT 1 FROM account_balances")).length;
    await importFile(b.admin, { ...file, accountBalances: balanceRows(key, 50_001) });
    expect(await b.db.all("SELECT 1 FROM account_balances")).toHaveLength(before + 50_001);
  }, 120_000);

  it("500 000 balance rows pass the dry run, within the session's 64 MiB", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const up = await upload(b.admin, { ...file, accountBalances: balanceRows(file.accountBalances[0].account_key, 500_000) });
    expect(up.refused).toBeNull();
    const dry = await check(b.admin, up.id!);
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    const before = (await b.db.all("SELECT 1 FROM account_balances")).length;
    const done = await commit(b.admin, up.id!);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(await b.db.all("SELECT 1 FROM account_balances")).toHaveLength(before + 500_000);
  }, 300_000);

  it("the other stores keep their 50 000 rows: 50 001 valued assets are refused", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const assets = Array.from({ length: 50_001 }, (_, i) => ({ id: `v${i}`, kind: "fund", name: "n", day: "2026-09-30", cents: 1 }));
    await refusedWith(b, b.admin, { ...file, valuedAssets: assets }, /Tiedoston kohdassa valuedAssets on liikaa rivejä/);
  }, 120_000);

  it("one balance row past 500 000 is refused with the sentence of the other caps", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const key = file.accountBalances[0].account_key;
    await refusedWith(b, b.admin, { ...file, accountBalances: balanceRows(key, 500_001) }, /Tiedoston kohdassa accountBalances on liikaa rivejä/);
  }, 300_000);

  it("a reference to nothing, or to another user's row here", async () => {
    const { a, b, kb } = await pair();
    const file = await exportOf(a.admin);
    await keep(b.db, kb.id, "kaisa");
    // a part of a transaction that is kaisa's here and not in the file
    await refusedWith(b, b.admin, { ...file, parts: [{ tx_id: "kaisa-tx1", owner: "u:x", kind: "spend", grp: "g", cents: 1, passed: 0 }] }, /parts rivi 1 viittaa riviin \(tx_id\)/);
    await refusedWith(b, b.admin, { ...file, transactions: [{ ...file.transactions[0], account_id: "kaisa-acc" }] }, /account_id/);
    await refusedWith(b, b.admin, { ...file, answers: [{ ...file.answers[0], account_key: "kaisa-ident" }] }, /account_key/);
    await refusedWith(b, b.admin, { ...file, loans: [{ ...file.loans[0], user_id: "nobody" }] }, /user_id/);
    await refusedWith(b, b.admin, { ...file, statementRows: [{ ...file.statementRows[0], bill_tx_id: "aino-tx2" }] }, /bill_tx_id/);
    // a row that says it is aino's but names kaisa's username as its owner
    await refusedWith(b, b.admin, { ...file, accounts: [{ ...file.accounts[0], owner_username: "kaisa" }] }, /owner_username/);
  });

  it("a chunk of another session, out of order, twice, or after the end", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const started = await b.admin.call("POST", "/api/data/import", { format: "omatalous-export", version: 1 });
    const id = started.body.session;
    const chunk = (who: Who, seq: number, key = "marks") => who.call("POST", `/api/data/import/${id}/chunk`, { seq, stores: { [key]: file[key] } });
    const kaisaBefore = await snapshot(b.db);
    // another user has no session of this id: the same sentence as for one that never was
    const kb = await b.member("liisa");
    const other = await chunk(kb as unknown as Who, 0);
    expect(other.body.error).toMatch(/päättynyt tai vanhentunut/);
    expect((await check(kb as unknown as Who, id)).body.error).toMatch(/päättynyt tai vanhentunut/);
    expect((await commit(kb as unknown as Who, id)).status).toBe(400);
    // the owner's session lives on after another user's attempts
    expect((await chunk(b.admin, 0)).status).toBe(200);
    expect((await chunk(b.admin, 0)).status).toBe(400);
    expect((await chunk(b.admin, 1)).body.error).toMatch(/päättynyt tai vanhentunut/);
    expect(kaisaBefore).toBeTruthy();
  });

  it("a session ends after 15 minutes without a chunk", async () => {
    const clock = { at: new Date("2026-10-09T10:00:00Z") };
    const setup = await setupApp({}, undefined, { now: () => clock.at });
    const file = await exportOf(setup.admin);
    const up = await upload(setup.admin, file);
    clock.at = new Date(clock.at.getTime() + 14 * 60_000);
    expect((await check(setup.admin, up.id!)).status).toBe(200);
    clock.at = new Date(clock.at.getTime() + 16 * 60_000);
    expect((await check(setup.admin, up.id!)).body.error).toMatch(/päättynyt tai vanhentunut/);
  });

  it("makes no user, session, factor or token, and a file with other usernames adds nothing of theirs", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const tables = ["users", "sessions", "user_factor", "access_token", "bank_credentials", "connections"];
    const count = async () => Promise.all(tables.map((t) => b.db.first(`SELECT COUNT(*) AS n FROM ${t}`)));
    const before = await count();
    await importFile(b.admin, { ...file, users: [...file.users, { id: "u-x", username: "mallikas", display_name: "Mallikas", role: "admin", created_at: AT }], accounts: [...file.accounts, { ...file.accounts[0], id: "m-acc", identity: "m-ident", user_id: "u-x", owner_username: "mallikas" }] });
    expect(await count()).toEqual(before);
    expect(await b.db.first("SELECT COUNT(*) AS n FROM accounts WHERE id = 'm-acc'")).toEqual({ n: 0 });
  });
});

describe("people the file names", () => {
  it("a person this import cannot name is null where the table allows it, the user where it does not, and their use of an account is skipped", async () => {
    const { a, ka, b } = await pair();
    await a.db.run("INSERT INTO account_shares (account_id, user_id, created_at) VALUES ('kaisa-acc', ?, ?)", [a.adminId, AT]);
    // kaisa answers about aino's account, splits it and uses it
    await a.db.run("UPDATE owner_answer SET said_by = ? WHERE key = 'aino-ANSWER'", [ka.id]);
    await a.db.run("UPDATE account_split SET set_by = ? WHERE account_key = 'aino-ident'", [ka.id]);
    await a.db.run("INSERT INTO account_use (account_key, user_id, weight, said_by, said_at) VALUES ('aino-ident', ?, 1, ?, ?)", [ka.id, ka.id, AT]);
    const file = await exportOf(a.admin);
    expect(file.accountUse.filter((r: { account_key: string }) => r.account_key === "aino-ident")).toHaveLength(2);
    const done = (await importFile(b.admin, file)).done;
    expect(done.stores.find((s: { key: string }) => s.key === "accountUse")).toMatchObject({ add: 1, skipped: [{ reason: "other_user", n: 2 }] });
    expect(await b.db.all("SELECT said_by FROM owner_answer WHERE key = 'aino-ANSWER'")).toEqual([{ said_by: b.adminId }]);
    expect(await b.db.all("SELECT set_by FROM account_split WHERE account_key = 'aino-ident'")).toEqual([{ set_by: null }]);
    expect(await b.db.all("SELECT user_id FROM account_use WHERE account_key = 'aino-ident'")).toEqual([{ user_id: b.adminId }]);
  });

  it("holds at most eight sessions at a time, and a user's new one replaces their old one", async () => {
    const setup = await setupApp();
    const head = { format: "omatalous-export", version: 1 };
    const first = await setup.admin.call("POST", "/api/data/import", head);
    const second = await setup.admin.call("POST", "/api/data/import", head);
    expect((await check(setup.admin, first.body.session)).body.error).toMatch(/päättynyt tai vanhentunut/);
    expect((await check(setup.admin, second.body.session)).status).toBe(200);
    for (let i = 0; i < 7; i++) expect((await (await setup.member(`jasen${i}`)).call("POST", "/api/data/import", head)).status).toBe(200);
    // eight now: the admin's and seven members'
    const ninth = await (await setup.member("jasen8")).call("POST", "/api/data/import", head);
    expect(ninth.status).toBe(400);
    expect(ninth.body.error).toMatch(/liian monta/);
    expect((await setup.admin.call("POST", "/api/data/import", head)).status).toBe(200);
  });
});

describe("who may import, and what is recorded", () => {
  it("a signed-in user may, no session gets 401, a temporary password 403; the commit leaves one event with the counts", async () => {
    const setup = await setupApp();
    const nobody = await setup.client().call("POST", "/api/data/import", { format: "omatalous-export", version: 1 });
    expect(nobody.status).toBe(401);
    const created = await setup.admin.call("POST", "/api/users", { username: "tilapainen", displayName: "Tilapäinen" });
    const temporary = setup.client();
    await temporary.call("POST", "/api/auth/login", { username: "tilapainen", password: created.body.temporaryPassword });
    expect((await temporary.call("POST", "/api/data/import", { format: "omatalous-export", version: 1 })).status).toBe(403);
    const kaisa = await setup.member("kaisa");
    expect((await kaisa.call("POST", "/api/data/import", { format: "omatalous-export", version: 1 })).status).toBe(200);
    // a refused file leaves no event, a committed one leaves one
    const events = () => setup.db.all<{ user_id: string; detail: string; notify: number }>("SELECT user_id, detail, notify FROM security_events WHERE kind = 'ops_import'");
    expect(await events()).toEqual([]);
    await keep(setup.db, kaisa.id, "kaisa");
    const file = await exportOf(kaisa);
    await setup.db.run("DELETE FROM accounts WHERE user_id = ?", [kaisa.id]);
    await importFile(kaisa, file);
    expect(await events()).toEqual([{ user_id: kaisa.id, detail: expect.stringMatching(/^tietojen tuonti: lisätty \d+, jo olemassa \d+, ohitettu 3$/), notify: 0 }]);
    // the page's cancel ends a session
    const s2 = await kaisa.call("POST", "/api/data/import", { format: "omatalous-export", version: 1 });
    await kaisa.call("DELETE", `/api/data/import/${s2.body.session}`);
    expect((await check(kaisa, s2.body.session)).status).toBe(400);
  });
});

// the time of the import is in data-roundtrip.perf.test.ts
describe("a household of PB1's size", () => {
  it("imports into an empty instance, and a second time adds nothing", async () => {
    const w = await perfHousehold();
    // the administrator is aino whichever of the two ids sorts first; the empty instance has the same username
    const file = await exportOf(w.admin);
    expect(file.transactions.length).toBeGreaterThan(5000);
    const empty = await setupApp();
    expect((await empty.member("ville", "Ville")).id).toBeTruthy();
    const first = await importFile(empty.admin, file);
    expect(first.done.total.add).toBeGreaterThan(5000);
    const again = await importFile(empty.admin, file);
    expect(again.dry.total.add).toBe(0);
  }, 180_000);
});

describe("exportedBy", () => {
  const head = (f: File, by: string | undefined) => ({ format: f.format, version: f.version, appVersion: f.appVersion, exportedAt: f.exportedAt, exportedBy: by });
  it("names the exporter in the file", async () => {
    const { a, ka } = await pair();
    expect((await exportOf(a.admin)).exportedBy).toBe("aino");
    expect((await exportOf(ka)).exportedBy).toBe("kaisa");
  });
  it("a file of another user is refused with one sentence and nothing is written; a file without the field is read as before", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const before = await snapshot(b.db);
    const other = await upload(b.admin, file, { head: head(file, "kaisa") });
    expect(other.refused!.status).toBe(400);
    expect(other.refused!.body.error).toBe("Tiedosto on toisen käyttäjän. Tuo vain omat tietosi.");
    expect(await snapshot(b.db)).toBe(before);
    const none = await upload(b.admin, file, { head: head(file, undefined) });
    expect(none.refused).toBeNull();
  });
  it("the same user's file twice adds nothing", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    for (const round of [0, 1]) {
      const up = await upload(b.admin, file, { head: head(file, "aino") });
      expect(up.refused).toBeNull();
      const done = (await commit(b.admin, up.id!)).body;
      if (round === 1) expect(done.total.add).toBe(0);
    }
  });
});

describe("the figures after a round trip", () => {
  /** An answer with the user ids named by username: the two instances made their own ids, which are no figure. */
  const read = async (who: Who, path: string, ids: Record<string, string>) => {
    const res = await (who as Setup["admin"]).call("GET", path);
    expect(res.status, path).toBe(200);
    return JSON.parse(Object.entries(ids).reduce((text, [id, name]) => text.replaceAll(id, `user:${name}`), JSON.stringify(res.body)));
  };

  /** A mark that moves a figure: the first forgotten service of the dashboard is said to be in use. */
  async function markOneAlert(who: Who) {
    const subject = /"markSubject":"([^"]+)"/.exec(JSON.stringify(await read(who, "/api/dashboard", {})))?.[1];
    expect(subject, "the demo household has an alert to mark").toBeTruthy();
    expect((await (who as Setup["admin"]).call("PUT", "/api/marks", { subject, mark: "in_use" })).status).toBe(200);
  }

  const paths = ["/api/dashboard", "/api/ahead", "/api/reports"];

  it("the whole dashboard answer, and the answers beside it, are equal to the cent before and after", async () => {
    const { a, ka, b, kb } = await pair();
    await a.admin.call("POST", "/api/demo");
    await markOneAlert(a.admin);
    // what is read per request and is no part of the cached context: marks, bills, loans, goals, Optimoi inputs
    for (const t of ["user_marks", "expected_bills", "loans", "spending_goal", "category_goal", "optimise_inputs", "optimise_states", "category_rules"]) expect((await a.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, [a.adminId]))!.n, t).toBeGreaterThan(0);
    const idsOf = (x: Setup, k: { id: string }) => ({ [x.adminId]: "aino", [k.id]: "kaisa" });
    const before = new Map<string, unknown>();
    for (const [who, name] of [[a.admin, "aino"], [ka, "kaisa"]] as const) for (const p of paths) before.set(`${name} ${p}`, await read(who, p, idsOf(a, ka)));
    await importFile(b.admin, await exportOf(a.admin));
    await importFile(kb, await exportOf(ka));
    for (const [who, name] of [[b.admin, "aino"], [kb, "kaisa"]] as const) for (const p of paths) expect(await read(who, p, idsOf(b, kb)), `${name} ${p}`).toEqual(before.get(`${name} ${p}`));
  });

  it("the comparison sees each per-request input: without one of them in the copy an answer differs", async () => {
    const { a, b } = await pair();
    await a.admin.call("POST", "/api/demo");
    await markOneAlert(a.admin);
    const all = async (x: Setup) => JSON.stringify(await Promise.all(paths.map((p) => read(x.admin, p, { [x.adminId]: "aino" }))));
    const want = await all(a);
    await importFile(b.admin, await exportOf(a.admin));
    expect(await all(b)).toBe(want);
    const still: string[] = [];
    // spending_goal is no input any longer: the row travels in the copy and no answer reads it
    // the Optimoi inputs and decisions are in no answer since the page of tips left the API: "a file read back" compares their rows
    for (const table of ["user_marks", "expected_bills", "loans"]) {
      const rows = await b.db.all(`SELECT * FROM ${table} WHERE user_id = ?`, [b.adminId]);
      await b.db.run(`DELETE FROM ${table} WHERE user_id = ?`, [b.adminId]);
      await b.s.settings.bumpUserDataVersion(b.adminId);
      if ((await all(b)) === want) still.push(table);
      // put it back: the next table is tested against the full copy
      await importFile(b.admin, await exportOf(a.admin));
      expect(await all(b), `${table} back`).toBe(want);
      expect(rows.length, table).toBeGreaterThan(0);
    }
    expect(still).toEqual([]);
  });

  it("an old file, with no exporter, no later store and no later column, is still taken and gives the same dashboard", async () => {
    const { a, b } = await pair();
    await a.admin.call("POST", "/api/demo");
    // the stores below are the later ones: the old file has none of them, and the file is the current exporter's with the later columns taken out (no frozen file of an old release exists)
    const LATER_STORES = ["spendingGoals", "categoryGoals", "optimiseInputs", "optimiseStates", "optimiseSnapshots", "contractTerms", "valuedAssets", "accountAgreements", "settlementClosed", "statementBills", "statementRows"];
    const LATER_COLUMNS = ["bank_type_code", "bank_usage", "bank_product", "psu_status", "type_source", "exportedBy"];
    for (const store of exportStores().filter((st) => LATER_STORES.includes(st.key))) await a.db.run(`DELETE FROM ${store.table}`);
    await a.s.settings.bumpDataVersion();
    const ids = (x: Setup) => ({ [x.adminId]: "aino" });
    const want = await read(a.admin, "/api/dashboard", ids(a));
    const file = await exportOf(a.admin);
    const old: File = { format: file.format, version: file.version, appVersion: "0.48.0", exportedAt: file.exportedAt };
    for (const [key, rows] of Object.entries(file)) {
      if (HEAD_KEYS.includes(key) || !Array.isArray(rows) || LATER_STORES.includes(key)) continue;
      old[key] = rows.map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => !LATER_COLUMNS.includes(k))));
    }
    const done = (await importFile(b.admin, old)).done;
    expect(done.committed).toBe(true);
    expect(done.total.add).toBeGreaterThan(50);
    expect(await read(b.admin, "/api/dashboard", ids(b))).toEqual(want);
  });
});
