import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openNodeSqlite } from "../src/db/node-sqlite.ts";
import type { Db } from "../src/db/types.ts";
import { EXPORT_VERSION, LEFT_OUT, STORES, storeColumns } from "../src/services/data-export-stores.ts";
import { SETUP_CODE, setupApp } from "./helpers.ts";

const APP_SECRET = "test-secret-that-is-long-enough-0123456789";
const NOW = "2026-10-01T00:00:00Z";
type Setup = Awaited<ReturnType<typeof setupApp>>;
type Who = { cookie: string };

/** Everything the test instance holds that must never reach the file, each one a text nobody could make by accident. */
const PLANTED = ["SECRET-BANK-KEY-ENC", "SECRET-CONSENT-ID", "SECRET-EXTERNAL-UID", "SECRET-TOKEN-HASH", "SECRET-TOTP", "SECRET-SETTING", "RAW-PAYLOAD-NAME", "SECRET-SESSION"];

async function plant(setup: Setup) {
  const { db, adminId } = setup;
  await db.run("INSERT INTO bank_credentials (user_id, app_id, private_key_enc, updated_at) VALUES (?, 'app', 'SECRET-BANK-KEY-ENC', ?)", [adminId, NOW]);
  await db.run("INSERT INTO connections (id, user_id, provider, institution, country, status, created_at) VALUES ('SECRET-CONSENT-ID', ?, 'enablebanking', 'ESIMERKKI PANKKI', 'FI', 'active', ?)", [adminId, NOW]);
  await db.run(
    `INSERT INTO accounts (id, user_id, connection_id, provider, external_id, identity, name, iban, currency, type, created_at)
     VALUES ('acc-1', ?, 'SECRET-CONSENT-ID', 'enablebanking', 'SECRET-EXTERNAL-UID', 'ident-1', 'Käyttötili', 'FI0000000000000001', 'EUR', 'checking', ?)`,
    [adminId, NOW],
  );
  await db.run(
    `INSERT INTO transactions (id, user_id, account_id, booking_date, value_date, amount_cents, currency, status, counterparty, merchant, category, category_source,
       is_transfer, source, raw, imported_at, bank_txn_code)
     VALUES ('tx-1', ?, 'acc-1', '2026-09-30', '2026-09-30', -1250, 'EUR', 'booked', 'ESIMERKKI OY', 'Esimerkki', 'groceries', 'rule', 0, 'enablebanking', '{"name":"RAW-PAYLOAD-NAME"}', ?, 'PMNT')`,
    [adminId, NOW],
  );
  await db.run("INSERT INTO access_token (id, user_id, scope, hash, created_at) VALUES ('tok-1', ?, 'read', 'SECRET-TOKEN-HASH', ?)", [adminId, NOW]);
  await db.run("INSERT INTO user_factor (id, user_id, kind, secret, created_at) VALUES ('fac-1', ?, 'totp', 'SECRET-TOTP', ?)", [adminId, NOW]);
  await db.run("INSERT INTO settings (key, value, updated_at) VALUES ('planted', 'SECRET-SETTING', ?)", [NOW]);
  await db.run("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES ('SECRET-SESSION', ?, ?, '2099-01-01T00:00:00Z', ?)", [adminId, NOW, NOW]);
}

/** The export as the browser asks for it: a POST with the header of the app, as the text (the test client parses a JSON answer). */
async function download(setup: Setup, who: Who = setup.admin, headers: Record<string, string> = {}) {
  const res = await setup.app.request("http://localhost:8080/api/data/export", { method: "POST", headers: { "X-Requested-With": "fetch", Cookie: who.cookie, ...headers } });
  return { res, text: await res.text() };
}

const fileOf = async (setup: Setup, who?: Who) => JSON.parse((await download(setup, who)).text);
const events = (setup: Setup) => setup.db.all<{ kind: string; user_id: string; detail: string; notify: number }>("SELECT kind, user_id, detail, notify FROM security_events WHERE kind = 'ops_export'");

describe("POST /api/data/export", () => {
  it("is for a signed-in user: no session gets 401, a temporary password 403, nothing is sent", async () => {
    const setup = await setupApp();
    const nobody = await setup.client().call("POST", "/api/data/export", {});
    expect(nobody.status).toBe(401);
    expect(JSON.stringify(nobody.body)).not.toContain("omatalous-export");
    const created = await setup.admin.call("POST", "/api/users", { username: "tilapainen", displayName: "Tilapäinen" });
    const temporary = setup.client();
    await temporary.call("POST", "/api/auth/login", { username: "tilapainen", password: created.body.temporaryPassword });
    const refused = await temporary.call("POST", "/api/data/export", {});
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain("omatalous-export");
    expect(await events(setup)).toEqual([]);
    // near miss: the same member with a password of their own gets the file
    const kaisa = await setup.member("kaisa");
    expect((await kaisa.call("POST", "/api/data/export", {})).status).toBe(200);
  });

  it("downloads one versioned file named with the day, never cached", async () => {
    const setup = await setupApp();
    await setup.admin.call("POST", "/api/demo");
    const { res, text } = await download(setup);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="omatalous-2026-10-09.json"');
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const file = JSON.parse(text);
    expect(file).toMatchObject({ format: "omatalous-export", version: EXPORT_VERSION, appVersion: setup.s.build.version });
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBe("2026-10-09T10:00:00.000Z");
    // the administrator owns every row of this instance: each store holds as many rows as its table
    for (const store of STORES) {
      const n = (await setup.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${store.table}`))!.n;
      expect(Array.isArray(file[store.key]), store.key).toBe(true);
      expect(file[store.key], store.key).toHaveLength(n);
    }
    expect(file.transactions.length).toBeGreaterThan(50);
    expect(file.users).toEqual([expect.objectContaining({ username: "aino", role: "admin" })]);
  });

  it("holds the stored fields and the signature of a transaction, and no payload and no bank session", async () => {
    const setup = await setupApp();
    await plant(setup);
    const file = await fileOf(setup);
    const tx = file.transactions[0];
    expect(tx).toMatchObject({ id: "tx-1", account_id: "acc-1", booking_date: "2026-09-30", amount_cents: -1250, counterparty: "ESIMERKKI OY", category: "groceries", source: "enablebanking", bank_txn_code: "PMNT", owner_username: "aino" });
    expect(tx).not.toHaveProperty("raw");
    expect(tx).not.toHaveProperty("search_text");
    expect(JSON.parse(tx.signature)).toEqual(["2026-09-30", "2026-09-30", -1250, "booked", "ESIMERKKI OY", null, null, null, null, "Esimerkki", "PMNT"]);
    expect(file.accounts[0]).toMatchObject({ id: "acc-1", identity: "ident-1", iban: "FI0000000000000001", owner_username: "aino" });
    expect(file.accounts[0]).not.toHaveProperty("external_id");
    expect(file.accounts[0]).not.toHaveProperty("connection_id");
    expect(file.users[0]).not.toHaveProperty("password_hash");
  });

  it("has no secret or token of the instance anywhere in the file", async () => {
    const setup = await setupApp();
    await plant(setup);
    const kaisa = await setup.member("kaisa");
    await setup.admin.call("POST", "/api/demo");
    const { text } = await download(setup);
    expect(text.length).toBeGreaterThan(5000);
    expect(text).toContain("omatalous-export");
    const hashes = (await setup.db.all<{ password_hash: string }>("SELECT password_hash FROM users")).map((r) => r.password_hash);
    expect(hashes.length).toBe(2);
    const cookieValue = (c: { cookie: string }) => c.cookie.split("=")[1] ?? "";
    expect(cookieValue(setup.admin).length).toBeGreaterThan(10);
    const secrets = [...PLANTED, APP_SECRET, SETUP_CODE, "aino-salasana-123", "kaisa-uusi-salasana", ...hashes, cookieValue(setup.admin), cookieValue(kaisa), "pbkdf2"];
    for (const secret of secrets) expect(text, secret).not.toContain(secret);
  });
});

describe("a request that is not the app's own POST", () => {
  it("a GET and a HEAD are refused with 405 and write no event, builds no file", async () => {
    const setup = await setupApp();
    for (const method of ["GET", "HEAD"]) {
      const res = await setup.app.request("http://localhost:8080/api/data/export", { method, headers: { Cookie: setup.admin.cookie } });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow"), method).toBe("POST");
      expect(await res.text(), method).not.toContain("omatalous-export");
    }
    expect(await events(setup)).toEqual([]);
    // near miss: the POST of the app is served and writes its one event
    expect((await download(setup)).res.status).toBe(200);
    expect(await events(setup)).toHaveLength(1);
  });

  it("a cross-site request is refused and writes no event", async () => {
    const setup = await setupApp();
    const site = { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example", Referer: "https://evil.example/page" };
    // a form on another site cannot set the header of the app
    const form = await setup.app.request("http://localhost:8080/api/data/export", { method: "POST", headers: { Cookie: setup.admin.cookie, ...site } });
    expect(form.status).toBe(403);
    expect(await form.text()).not.toContain("omatalous-export");
    // a script of another site can set it, but its origin is not ours
    const forged = await download(setup, setup.admin, site);
    expect(forged.res.status).toBe(403);
    expect(forged.text).not.toContain("omatalous-export");
    expect(await events(setup)).toEqual([]);
    // near miss: the same request from the app's own origin
    expect((await download(setup, setup.admin, { Origin: "http://localhost:8080" })).res.status).toBe(200);
    expect(await events(setup)).toHaveLength(1);
  });
});

/** An account and one row of it, written straight into the tables. */
async function addAccount(db: Db, id: string, userId: string, name: string, identity: string | null = null) {
  await db.run(
    `INSERT INTO accounts (id, user_id, provider, identity, name, iban, currency, type, created_at) VALUES (?, ?, 'csv', ?, ?, ?, 'EUR', 'checking', ?)`,
    [id, userId, identity, name, `FI-${id}`, NOW],
  );
}
async function addRow(db: Db, id: string, userId: string, accountId: string, merchant: string) {
  await db.run(
    `INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, merchant, category, category_source, is_transfer, source, imported_at)
     VALUES (?, ?, ?, '2026-09-30', -100, 'EUR', 'booked', ?, 'groceries', 'rule', 0, 'csv', ?)`,
    [id, userId, accountId, merchant, NOW],
  );
}
/** What a member keeps under their own name, one value in each store of that kind, each one a text nobody could make by accident. */
async function keepPrivately(db: Db, userId: string, tag: string, accountId: string) {
  await addAccount(db, accountId, userId, `${tag}-ACCOUNT`);
  await addRow(db, `${accountId}-row`, userId, accountId, `${tag}-MERCHANT`);
  await db.run("INSERT INTO category_rules (user_id, field, pattern, category, priority, created_at) VALUES (?, 'merchant', ?, 'groceries', 10, ?)", [userId, `${tag}-RULE`, NOW]);
  await db.run("INSERT INTO user_marks (user_id, subject, mark, marked_at) VALUES (?, ?, 'in_use', ?)", [userId, `${tag}-MARK`, NOW]);
  await db.run("INSERT INTO optimise_inputs (user_id, key, value, as_of) VALUES (?, ?, '1', '2026-10-01')", [userId, `${tag}-INPUT`]);
  await db.run("INSERT INTO optimise_states (user_id, finding_id, status, decided_at) VALUES (?, ?, 'done', ?)", [userId, `${tag}-STATE`, NOW]);
  await db.run("INSERT INTO optimise_snapshots (user_id, month, data, created_at) VALUES (?, ?, '{}', ?)", [userId, `${tag}-SNAP`, NOW]);
  await db.run("INSERT INTO contract_terms (user_id, series_key, answered_at) VALUES (?, ?, ?)", [userId, `${tag}-TERMS`, NOW]);
  await db.run("INSERT INTO payer_role (scope, user_id, counterparty_key, role, answered_at) VALUES ('member', ?, ?, 'sales', ?)", [userId, `${tag}-PAYER`, NOW]);
  await db.run("INSERT INTO expected_bills (id, user_id, name, amount_cents, due_date, cadence, created_at) VALUES (?, ?, ?, 100, '2026-11-01', 'once', ?)", [`${tag}-BILL`, userId, `${tag}-BILLNAME`, NOW]);
  await db.run("INSERT INTO owner_answer (account_key, kind, key, owner, said_by, said_at) VALUES (?, 'in', ?, 'u:x', ?, ?)", [accountId, `${tag}-ANSWER`, userId, NOW]);
  await db.run("INSERT INTO account_balances (account_key, day, type, cents, fetched_at, source) VALUES (?, '2026-09-30', ?, 5, ?, 'csv')", [accountId, `${tag}-BALANCE`, NOW]);
  await db.run("INSERT INTO account_use (account_key, user_id, weight, said_by, said_at) VALUES (?, ?, 1, ?, ?)", [accountId, userId, userId, NOW]);
}

describe("the file holds what the user who asks sees, no more", () => {
  it("an administrator's file has nothing of a member's unshared account, and the member's file has all of it", async () => {
    const setup = await setupApp();
    const kaisa = await setup.member("kaisa");
    await keepPrivately(setup.db, kaisa.id, "KAISA", "k-priv");
    await keepPrivately(setup.db, setup.adminId, "AINO", "a-own");

    // the app itself: the administrator's household list does not hold the member's rows
    const listed = async (who: Who & { call: Setup["admin"]["call"] }) => (await who.call("GET", "/api/transactions?scope=household&from=2000-01-01&to=2030-12-31&limit=5000")).body.items.map((t: { id: string }) => t.id).sort();
    expect(await listed(setup.admin)).toEqual(["a-own-row"]);

    const adminFile = await download(setup);
    expect(adminFile.text).not.toContain("KAISA-");
    expect(adminFile.text).not.toContain("k-priv");
    expect(adminFile.text).toContain("AINO-ACCOUNT");
    const admin = JSON.parse(adminFile.text);
    expect(admin.transactions.map((t: { id: string }) => t.id).sort()).toEqual(await listed(setup.admin));
    expect(admin.accounts.map((a: { id: string }) => a.id)).toEqual(["a-own"]);
    for (const key of ["rules", "marks", "optimiseInputs", "optimiseStates", "optimiseSnapshots", "contractTerms", "payerRoles", "expectedBills", "answers", "accountBalances"]) {
      expect(JSON.stringify(admin[key]), key).toContain("AINO");
      expect(JSON.stringify(admin[key]), key).not.toContain("KAISA");
    }
    expect(admin.accountUse.map((u: { account_key: string }) => u.account_key)).toEqual(["a-own"]);
    // the administrator sees every member in Asetukset > Talouden jäsenet, so the list of people holds both
    expect(admin.users.map((u: { username: string }) => u.username).sort()).toEqual(["aino", "kaisa"]);

    // the mirror: the member's file holds their own and none of the administrator's
    const memberFile = await download(setup, kaisa);
    expect(memberFile.text).toContain("KAISA-ACCOUNT");
    expect(memberFile.text).not.toContain("AINO-");
    expect(memberFile.text).not.toContain("a-own");
    const member = JSON.parse(memberFile.text);
    expect(member.transactions.map((t: { id: string }) => t.id)).toEqual(["k-priv-row"]);
    expect(member.transactions.map((t: { id: string }) => t.id).sort()).toEqual(await listed(kaisa));
    for (const key of ["rules", "marks", "optimiseInputs", "optimiseStates", "optimiseSnapshots", "contractTerms", "payerRoles", "expectedBills", "answers", "accountBalances"]) {
      expect(JSON.stringify(member[key]), key).toContain("KAISA");
    }
    expect(member.accountUse.map((u: { account_key: string }) => u.account_key)).toEqual(["k-priv"]);
    expect(member.users).toEqual([expect.objectContaining({ username: "kaisa", role: "member" })]);
    expect(member.users[0]).not.toHaveProperty("password_hash");
  });

  it("an account shared with the user is in their file with the owner's username, and gone when it is not shared", async () => {
    const setup = await setupApp();
    const kaisa = await setup.member("kaisa");
    await keepPrivately(setup.db, kaisa.id, "KAISA", "k-shared");
    await keepPrivately(setup.db, kaisa.id, "KAISB", "k-hidden");
    await addAccount(setup.db, "a-own", setup.adminId, "Aino tili");
    await addRow(setup.db, "a-row", setup.adminId, "a-own", "AINO-MERCHANT");
    expect(await setup.s.household.share(kaisa.id, "k-shared", setup.adminId)).toBe(true);

    const file = await fileOf(setup);
    expect(file.accounts.map((a: { id: string; owner_username: string }) => [a.id, a.owner_username]).sort()).toEqual([["a-own", "aino"], ["k-shared", "kaisa"]]);
    expect(file.transactions.map((t: { id: string; owner_username: string }) => [t.id, t.owner_username]).sort()).toEqual([["a-row", "aino"], ["k-shared-row", "kaisa"]]);
    expect(file.accountShares).toEqual([expect.objectContaining({ account_id: "k-shared", user_id: setup.adminId })]);
    // what is kept under the shared account is visible, what the member keeps under their own name is not
    expect(JSON.stringify(file.answers)).toContain("KAISA-ANSWER");
    expect(JSON.stringify(file.accountBalances)).toContain("KAISA-BALANCE");
    expect(JSON.stringify(file.parts)).toBe("[]");
    for (const key of ["rules", "marks", "optimiseInputs", "contractTerms", "payerRoles", "expectedBills"]) expect(JSON.stringify(file[key]), key).toBe("[]");
    const text = JSON.stringify(file);
    expect(text).not.toContain("KAISB");
    expect(text).not.toContain("k-hidden");
    // the list of the app holds the same rows
    const listed = (await setup.admin.call("GET", "/api/transactions?scope=household&from=2000-01-01&to=2030-12-31&limit=5000")).body.items.map((t: { id: string }) => t.id).sort();
    expect(file.transactions.map((t: { id: string }) => t.id).sort()).toEqual(listed);

    // the owner's file shows who the account is shared with, the person it is shared with does not own it
    const owner = await fileOf(setup, kaisa);
    expect(owner.accountShares).toEqual([expect.objectContaining({ account_id: "k-shared", user_id: setup.adminId })]);
    expect(owner.users.map((u: { username: string }) => u.username).sort()).toEqual(["aino", "kaisa"]);
    expect(JSON.stringify(owner)).not.toContain("AINO-MERCHANT");

    // near miss: the share taken back, and the rows are gone from the file
    await setup.s.household.unshare(kaisa.id, "k-shared", setup.adminId);
    const after = JSON.stringify(await fileOf(setup));
    expect(after).not.toContain("k-shared");
    expect(after).not.toContain("KAISA-");
  });

  it("a member sees the accounts shared with them only as the share, not the sharer's other rows", async () => {
    const setup = await setupApp();
    await keepPrivately(setup.db, setup.adminId, "AINO", "a-shared");
    await keepPrivately(setup.db, setup.adminId, "AINB", "a-hidden");
    const kaisa = await setup.member("kaisa");
    expect(await setup.s.household.share(setup.adminId, "a-shared", kaisa.id)).toBe(true);
    const file = await fileOf(setup, kaisa);
    expect(file.accounts.map((a: { id: string }) => a.id)).toEqual(["a-shared"]);
    expect(file.accountShares).toEqual([expect.objectContaining({ account_id: "a-shared", user_id: kaisa.id })]);
    expect(file.users.map((u: { username: string }) => u.username).sort()).toEqual(["aino", "kaisa"]);
    expect(JSON.stringify(file)).not.toContain("AINB");
    expect(JSON.stringify(file)).not.toContain("a-hidden");
    for (const key of ["rules", "marks", "optimiseInputs", "payerRoles", "expectedBills"]) expect(JSON.stringify(file[key]), key).toBe("[]");
  });
});

describe("what the file holds is decided table by table", () => {
  it("every table of a fresh database is exported or named as left out, with a reason", async () => {
    const { db } = await setupApp();
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
    const exported = STORES.map((st) => st.table);
    const unaccounted = tables.filter((t) => !exported.includes(t) && !(t in LEFT_OUT));
    expect(unaccounted, "a new table: add it to STORES or to LEFT_OUT with the reason").toEqual([]);
    // the lists name no table that is gone, none twice, and every reason says something
    for (const t of [...exported, ...Object.keys(LEFT_OUT)]) expect(tables, t).toContain(t);
    expect(new Set(exported).size).toBe(exported.length);
    expect(new Set(STORES.map((st) => st.key)).size).toBe(STORES.length);
    expect(exported.filter((t) => t in LEFT_OUT)).toEqual([]);
    for (const [t, reason] of Object.entries(LEFT_OUT)) expect(reason.length, t).toBeGreaterThan(10);
  });

  it("the secrets of the schema stay out, and the columns of users, accounts and transactions are pinned", async () => {
    const exported = STORES.map((st) => st.table);
    for (const t of ["sessions", "bank_credentials", "connections", "user_factor", "access_token", "account_fetch", "settings"]) expect(exported, t).not.toContain(t);
    const { s } = await setupApp();
    const columns = (key: string) => storeColumns(s, STORES.find((st) => st.key === key)!);
    const tableColumns = async (table: string) => (await s.db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
    // the exact list of each: a column of the table that is in neither list fails here, so it is decided in the open
    const pinned = {
      users: { table: "users", written: ["id", "username", "display_name", "role", "created_at"], kept: ["password_hash", "must_change_password"] },
      accounts: {
        table: "accounts",
        written: ["id", "user_id", "provider", "identity", "name", "iban", "currency", "type", "balance_cents", "balance_at", "last_synced_at", "created_at", "custom_name", "holder", "card_mask", "credit_limit_cents"],
        kept: ["external_id", "connection_id"],
      },
      transactions: {
        table: "transactions",
        written: [
          "id", "user_id", "account_id", "booking_date", "value_date", "amount_cents", "currency", "status", "counterparty", "counterparty_iban", "description", "reference", "mcc", "merchant",
          "category", "category_source", "is_transfer", "source", "imported_at", "bank_txn_code",
        ],
        kept: ["raw", "search_text"],
      },
    };
    for (const [key, p] of Object.entries(pinned)) {
      expect(await columns(key), key).toEqual(p.written);
      expect([...p.written, ...p.kept].sort(), `${key}: every column of the table is written or kept on purpose`).toEqual((await tableColumns(p.table)).sort());
    }
    expect(await columns("accounts")).toContain("identity");
    // a typo in `omit` would let the real column through
    for (const st of STORES.filter((x) => x.omit)) {
      const all = await tableColumns(st.table);
      for (const o of st.omit ?? []) expect(all, `${st.table}.${o}`).toContain(o);
    }
  });

  it("a column added to users, accounts or transactions later stays out of the file", async () => {
    const setup = await setupApp();
    await plant(setup);
    for (const table of ["users", "accounts", "transactions"]) await setup.db.run(`ALTER TABLE ${table} ADD COLUMN recovery_code TEXT DEFAULT 'LATER-COLUMN-VALUE'`);
    const { text } = await download(setup);
    expect(text).not.toContain("LATER-COLUMN-VALUE");
    expect(text).not.toContain("recovery_code");
    // near miss: a column of a store that has no allow list is written, and is in the file
    await setup.db.run("ALTER TABLE category_rules ADD COLUMN note TEXT DEFAULT 'RULE-COLUMN-VALUE'");
    await setup.db.run("INSERT INTO category_rules (user_id, field, pattern, category, priority, created_at) VALUES (?, 'merchant', 'x', 'groceries', 10, ?)", [setup.adminId, NOW]);
    expect((await download(setup)).text).toContain("RULE-COLUMN-VALUE");
  });

  it("docs/DATA_EXPORT.md names every array and every field of it", async () => {
    const { s } = await setupApp();
    const doc = readFileSync(new URL("../../../docs/DATA_EXPORT.md", import.meta.url), "utf8");
    for (const st of STORES) {
      const from = doc.indexOf(`### ${st.key}\n`);
      expect(from, st.key).toBeGreaterThan(-1);
      const next = doc.indexOf("\n### ", from + 1);
      const section = doc.slice(from, next === -1 ? undefined : next);
      for (const column of [...(await storeColumns(s, st)), ...(st.owner ? ["owner_username"] : [])]) expect(section, `${st.key}.${column}`).toContain(`| \`${column}\` |`);
    }
    expect(doc).toContain("| `signature` |");
    expect(doc).toContain("POST /api/data/export");
  });
});

describe("the transactions CSV", () => {
  it("has a Lähde column: the bank, a file or the example data", async () => {
    const setup = await setupApp();
    await plant(setup);
    await setup.db.run(
      `INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, merchant, category, category_source, is_transfer, source, imported_at)
       VALUES ('tx-2', ?, 'acc-1', '2026-09-29', -500, 'EUR', 'booked', 'Esimerkki', 'groceries', 'rule', 0, 'csv', ?)`,
      [setup.adminId, NOW],
    );
    const res = await setup.admin.call("GET", "/api/export/transactions.csv?from=2026-09-01&to=2026-09-30");
    const lines = String(res.body).replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]!.split(";")[9]).toBe("Lähde");
    expect(lines[1]!.split(";")[9]).toBe("pankki");
    expect(lines[2]!.split(";")[9]).toBe("tiedosto");
    const demo = await setupApp();
    await demo.admin.call("POST", "/api/demo");
    const rows = String((await demo.admin.call("GET", "/api/export/transactions.csv?from=2026-01-01&to=2026-12-31")).body).trimEnd().split("\r\n");
    expect(new Set(rows.slice(1).map((l) => l.split(";")[9]))).toEqual(new Set(["esimerkki"]));
  });
});

describe("the file of a database this release does not fully know", () => {
  it("names an unknown table in notExported and still writes everything else", async () => {
    const setup = await setupApp();
    await setup.db.run("CREATE TABLE zz_later (secret TEXT)");
    await setup.db.run("INSERT INTO zz_later VALUES ('LATER-TABLE-VALUE')");
    const { res, text } = await download(setup);
    expect(res.status).toBe(200);
    const file = JSON.parse(text);
    expect(file.notExported).toEqual(["zz_later"]);
    expect(text).not.toContain("LATER-TABLE-VALUE");
    expect(file.users).toHaveLength(1);
    // near miss: a database with only known tables names none
    expect(JSON.parse((await download(await setupApp())).text).notExported).toEqual([]);
  });

  it("reads every store in one transaction: the file is one snapshot", async () => {
    const setup = await setupApp();
    await plant(setup);
    const seen: string[] = [];
    const real = setup.s.db.readMany.bind(setup.s.db);
    setup.s.db.readMany = async (statements) => {
      seen.push(...statements.map((st) => st.sql));
      return real(statements);
    };
    await download(setup);
    // the select list ends in a quoted column or the owner's name, then the table of the store
    for (const store of STORES) expect(seen.filter((q) => new RegExp(`("|AS \\w+) FROM ${store.table}( |$)`).test(q)), store.table).toHaveLength(1);
    expect(seen.length).toBe(STORES.length + 1);
  });
});

describe("readMany", () => {
  it("rolls back on an error and throws the first one, and the connection is usable after", async () => {
    const db = openNodeSqlite(":memory:");
    db.exec("CREATE TABLE t (n INTEGER)");
    db.exec("INSERT INTO t VALUES (1)");
    await expect(db.readMany([{ sql: "SELECT n FROM t" }, { sql: "SELECT n FROM no_such_table" }])).rejects.toThrow(/no_such_table/);
    expect(await db.readMany([{ sql: "SELECT n FROM t" }])).toEqual([[{ n: 1 }]]);
    db.close();
  });

  it("a BEGIN that fails is the error that is thrown, and nobody else's transaction is committed", async () => {
    const db = openNodeSqlite(":memory:");
    db.exec("CREATE TABLE t (n INTEGER)");
    db.exec("BEGIN");
    db.exec("INSERT INTO t VALUES (7)");
    await expect(db.readMany([{ sql: "SELECT n FROM t" }])).rejects.toThrow(/within a transaction/);
    // the open transaction is still open: the failed call committed nothing of it
    db.exec("ROLLBACK");
    expect(await db.all("SELECT n FROM t")).toEqual([]);
    db.close();
  });
});

describe("the security event of an export", () => {
  it("is recorded for a download, under the user who asked, with no notice, and not for a refused one", async () => {
    const setup = await setupApp();
    const kaisa = await setup.member("kaisa");
    expect((await setup.client().call("POST", "/api/data/export", {})).status).toBe(401);
    expect(await events(setup)).toEqual([]);
    expect((await download(setup)).res.status).toBe(200);
    expect((await download(setup, kaisa)).res.status).toBe(200);
    const written = (await events(setup)).map((e) => ({ ...e }));
    expect(written).toEqual([
      { kind: "ops_export", user_id: setup.adminId, detail: "tietojen vienti: tiedosto ladattu", notify: 0 },
      { kind: "ops_export", user_id: kaisa.id, detail: "tietojen vienti: tiedosto ladattu", notify: 0 },
    ]);
  });
});
