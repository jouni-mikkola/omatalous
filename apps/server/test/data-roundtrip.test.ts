/** "Tuo tiedot": the file of "Vie kaikki tiedot" read back, and every hostile file refused with nothing changed. */
import { describe, expect, it } from "vitest";
import type { Db } from "../src/db/types.ts";
import { IMPORT_BY_KEY, IMPORT_LIMITS, IMPORT_STORES } from "../src/services/data-import-stores.ts";
import { STORES, storeColumns } from "../src/services/data-export-stores.ts";
import { perfHousehold } from "./perf-household.ts";
import { setupApp } from "./helpers.ts";

type Setup = Awaited<ReturnType<typeof setupApp>>;
type Who = { call: Setup["admin"]["call"] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type File = Record<string, any>;
const AT = "2026-10-01T00:00:00Z";

const exportOf = async (who: Who): Promise<File> => {
  const res = await (who as Setup["admin"]).call("POST", "/api/data/export", {});
  expect(res.status).toBe(200);
  return typeof res.body === "string" ? JSON.parse(res.body) : res.body;
};
const HEAD_KEYS = ["format", "version", "exportedAt", "appVersion", "exportedBy", "notExported"];

/** The page's part: the head, then the rows of each store in chunks under the size of one, then nothing else. */
async function upload(who: Who, file: File, over: { head?: object; chunk?: (rows: unknown[], key: string) => object } = {}) {
  const started = await who.call("POST", "/api/data/import", over.head ?? { format: file.format, version: file.version, appVersion: file.appVersion, exportedAt: file.exportedAt });
  if (started.status !== 200) return { started, refused: started };
  const id = started.body.session as string;
  let seq = 0;
  for (const [key, rows] of Object.entries(file)) {
    if (HEAD_KEYS.includes(key) || !Array.isArray(rows)) continue;
    for (let at = 0; at < rows.length || (at === 0 && !rows.length); ) {
      let end = at;
      let size = 0;
      while (end < rows.length && (end === at || size + JSON.stringify(rows[end]).length < 120_000)) size += JSON.stringify(rows[end++]).length;
      const res = await who.call("POST", `/api/data/import/${id}/chunk`, { seq: seq++, stores: { [key]: rows.slice(at, end) } });
      if (res.status !== 200) return { started, id, refused: res };
      at = Math.max(end, at + 1);
    }
  }
  return { started, id, refused: null };
}
const check = (who: Who, id: string) => who.call("POST", `/api/data/import/${id}/check`, {});
const commit = (who: Who, id: string) => who.call("POST", `/api/data/import/${id}/commit`, {});
async function importFile(who: Who, file: File) {
  const up = await upload(who, file);
  expect(up.refused, JSON.stringify(up.refused?.body)).toBeNull();
  const dry = await check(who, up.id!);
  expect(dry.status, JSON.stringify(dry.body)).toBe(200);
  const done = await commit(who, up.id!);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return { dry: dry.body, done: done.body };
}

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
  await run("INSERT INTO payer_role (scope, user_id, counterparty_key, role, answered_by, answered_at) VALUES ('member', ?, ?, 'payer', ?, ?)", userId, `${tag}-PAYER`, userId, AT);
  await run("INSERT INTO expected_bills (id, user_id, name, amount_cents, due_date, cadence, created_at) VALUES (?, ?, ?, 100, '2026-11-01', 'once', ?)", `${tag}-bill`, userId, `${tag} lasku`, AT);
  await run("INSERT INTO owner_answer (account_key, kind, key, owner, said_by, said_at) VALUES (?, 'in', ?, ?, ?, ?)", `${tag}-ident`, `${tag}-ANSWER`, `u:${userId}`, userId, AT);
  await run("INSERT INTO account_balances (account_key, day, type, cents, fetched_at, source) VALUES (?, '2026-09-30', 'closingBooked', 5, ?, 'csv')", `${tag}-ident`, AT);
  await run("INSERT INTO account_use (account_key, user_id, weight, said_by, said_at) VALUES (?, ?, 1, ?, ?)", `${tag}-ident`, userId, userId, AT);
  await run("INSERT INTO account_split (account_key, mode, set_by, set_at) VALUES (?, 'source', ?, ?)", `${tag}-ident`, userId, AT);
  await run("INSERT INTO account_agreement (account_key, valid_from, kind, value, set_by, set_at) VALUES (?, '2026-01-01', 'terms', '{}', ?, ?)", `${tag}-ident`, userId, AT);
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
    expect(IMPORT_STORES.map((s) => s.key)).toEqual(STORES.map((s) => s.key));
    for (const store of STORES) {
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

  it("bad types, lengths and lists, and a control character", async () => {
    const { a, b } = await pair();
    const file = await exportOf(a.admin);
    const tx = file.transactions[0];
    for (const bad of [{ amount_cents: "12" }, { amount_cents: 1.5 }, { amount_cents: 1e20 }, { booking_date: "2026-02-30" }, { status: "other" }, { merchant: "x".repeat(501) }, { merchant: "a\u0000b" }, { currency: "euro" }, { is_transfer: 2 }, { id: null }, { category_source: "hacked" }]) {
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
    const role = { scope: "member", user_id: null, counterparty_key: "ESIMERKKI", role: "payer", answered_by: null, answered_at: AT };
    await refusedWith(b, b.admin, { ...file, payerRoles: [role] }, /payerRoles rivi 1 viittaa riviin \(scope\)/);
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

// about 10x the median measured on a busy machine (PB1 notes): one sample in a parallel test run is noisy, so the budget
// catches a slowdown by an order of magnitude, not a few per cent
const IMPORT_BUDGET_MS = 10_000;

describe("a household of PB1's size", () => {
  it("imports into an empty instance under a budget, and a second time adds nothing", async () => {
    const w = await perfHousehold();
    // the administrator is aino whichever of the two ids sorts first; the empty instance has the same username
    const file = await exportOf(w.admin);
    expect(file.transactions.length).toBeGreaterThan(5000);
    const empty = await setupApp();
    const ville = await empty.member("ville", "Ville");
    expect(ville.id).toBeTruthy();
    const t0 = performance.now();
    const first = await importFile(empty.admin, file);
    const took = performance.now() - t0;
    expect(first.done.total.add).toBeGreaterThan(5000);
    expect(took).toBeLessThan(IMPORT_BUDGET_MS);
    const again = await importFile(empty.admin, file);
    expect(again.dry.total.add).toBe(0);
  }, 120_000);
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
