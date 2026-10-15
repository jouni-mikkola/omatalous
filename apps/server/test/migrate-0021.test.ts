/**
 * Migration 0021: the stores the next releases fill. It only adds, it carries the compat floor 0.45.0 so a rollback build
 * opens the database, and the foreign keys it leaves are the ones the paper lists. Made-up data.
 */
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMigrations, checksum, compatFloor, pendingMigrations } from "../src/db/migrate.ts";
import { findMigrationsDir, readMigrations } from "../src/db/open.ts";
import { openNodeSqlite } from "../src/db/node-sqlite.ts";
import { loadFixture } from "./fixture-db.ts";
import { scratchDir, setupApp } from "./helpers.ts";

const NAME = "0021_household_stores.sql";
const all = () => readMigrations(findMigrationsDir()).sort((a, b) => a.name.localeCompare(b.name));
const FIXTURES = new URL("./fixtures/db/", import.meta.url);
// the newest release before 0021: the cut of 0.46.0 adds its own fixture, which already holds 0021
const newestFixture = () => readdirSync(FIXTURES).filter((f) => f.endsWith(".sql") && f.localeCompare("0.46.0.sql", "en", { numeric: true }) < 0).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).at(-1)!;

/** A database as the newest frozen release left it, for the migration to run on. */
function fromFixture() {
  const file = join(scratchDir("talous-0021-"), "data", "banking.db");
  mkdirSync(join(file, ".."), { recursive: true });
  loadFixture(file, newestFixture());
  return openNodeSqlite(file);
}

type Db = Awaited<ReturnType<typeof setupApp>>["db"];

/** `name TYPE`, then NN for not null, PK<n> for the place in the primary key, DEFAULT <x>. */
async function columnsOf(db: Db, table: string): Promise<string[]> {
  return (await db.all<{ name: string; type: string; notnull: number; pk: number; dflt_value: string | null }>(`PRAGMA table_info(${table})`)).map(
    (c) => [c.name, c.type, c.notnull ? "NN" : "", c.pk ? `PK${c.pk}` : "", c.dflt_value === null ? "" : `DEFAULT ${c.dflt_value}`].filter(Boolean).join(" "),
  );
}

async function indexesOf(db: Db, table: string): Promise<string[]> {
  const list = await db.all<{ name: string; unique: number; origin: string }>(`PRAGMA index_list(${table})`);
  const out: string[] = [];
  for (const i of list.filter((i) => i.origin === "c")) {
    const cols = (await db.all<{ name: string | null }>(`PRAGMA index_info(${i.name})`)).map((c) => c.name ?? "<expr>");
    out.push(`${i.unique ? "UNIQUE " : ""}${i.name} (${cols.join(", ")})`);
  }
  return out.sort();
}

const PAPER: Record<string, { columns: string[]; indexes: string[] }> = {
  account_balances: {
    columns: ["account_key TEXT NN PK1", "day TEXT NN PK2", "type TEXT NN PK3", "reference_date TEXT", "cents INTEGER NN", "fetched_at TEXT NN", "source TEXT NN"],
    indexes: ["idx_account_balances_ref (account_key, type, reference_date)"],
  },
  account_history: { columns: ["account_id TEXT PK1", "asked_from TEXT NN", "first_row_day TEXT", "source TEXT NN", "recorded_at TEXT NN"], indexes: [] },
  account_fetch: {
    columns: ["id INTEGER PK1", "account_key TEXT NN", "at TEXT NN", "trigger TEXT NN", "user_id TEXT"],
    indexes: ["idx_account_fetch_key_at (account_key, at)"],
  },
  statement_bill: {
    columns: ["bill_tx_id TEXT PK1", "user_id TEXT NN", "account_key TEXT NN", "period_from TEXT NN", "period_to TEXT NN", "statement_cents INTEGER", "saved_at TEXT NN", "detached_at TEXT", "detached_reason TEXT"],
    indexes: ["idx_statement_bill_user (user_id)"],
  },
  statement_rows: {
    columns: ["id TEXT PK1", "bill_tx_id TEXT NN", "account_key TEXT NN", "user_id TEXT NN", "day TEXT NN", "cents INTEGER NN", "text TEXT NN", "row_key TEXT NN", "imported_at TEXT NN"],
    indexes: ["idx_statement_rows_key (account_key, row_key)", "idx_statement_rows_user (user_id)"],
  },
  foreign_rows: {
    columns: ["account_key TEXT NN PK1", "raw_key TEXT NN PK2", "booking_date TEXT NN", "amount_minor INTEGER NN", "scale INTEGER NN", "currency TEXT NN", "text TEXT", "seen_at TEXT NN"],
    indexes: ["idx_foreign_rows_day (account_key, booking_date)"],
  },
  payer_role: {
    columns: ["scope TEXT NN", "user_id TEXT", "counterparty_key TEXT NN", "role TEXT NN", "answered_by TEXT", "answered_at TEXT NN"],
    indexes: ["UNIQUE idx_payer_role_payer (scope, <expr>, counterparty_key)", "idx_payer_role_counterparty (counterparty_key)"],
  },
  household_member: {
    columns: ["id TEXT PK1", "name TEXT NN", "weight INTEGER NN DEFAULT 1", "created_at TEXT NN"],
    indexes: ["UNIQUE idx_household_member_name (name)"],
  },
  account_agreement: {
    columns: ["account_key TEXT NN PK1", "valid_from TEXT NN PK2", "kind TEXT NN", "value TEXT NN DEFAULT '{}'", "set_by TEXT", "set_at TEXT NN"],
    indexes: [],
  },
  user_factor: {
    columns: ["id TEXT PK1", "user_id TEXT NN", "kind TEXT NN", "secret TEXT NN", "label TEXT", "last_step INTEGER", "created_at TEXT NN", "last_used_at TEXT"],
    indexes: ["idx_user_factor_user (user_id, kind)"],
  },
  valued_asset: { columns: ["id TEXT NN PK1", "kind TEXT NN", "name TEXT NN", "day TEXT NN PK2", "cents INTEGER NN"], indexes: [] },
  contract_terms: {
    columns: ["user_id TEXT NN PK1", "series_key TEXT NN PK2", "notice_days INTEGER", "renews_on TEXT", "answered_at TEXT NN"],
    indexes: [],
  },
  access_token: {
    columns: ["id TEXT PK1", "user_id TEXT NN", "scope TEXT NN", "hash TEXT NN", "label TEXT", "created_at TEXT NN", "expires_at TEXT", "last_used_at TEXT"],
    indexes: ["UNIQUE idx_access_token_hash (hash)"],
  },
};

describe("migration 0021", () => {
  it("applies on the newest frozen release database, adds only, and stores the floor 0.45.0", async () => {
    const db = fromFixture();
    try {
      const before = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
      const { pending } = await pendingMigrations(db, all());
      expect(pending.map((m) => m.name)).toContain(NAME);
      await applyMigrations(db, pending);
      const after = new Set((await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name));
      for (const t of before) expect(after.has(t.name)).toBe(true);
      for (const t of Object.keys(PAPER)) expect(after.has(t), t).toBe(true);
      expect(await db.all("SELECT compat FROM _migrations WHERE name = ?", [NAME])).toEqual([{ compat: "0.45.0" }]);
      expect(compatFloor(all().find((m) => m.name === NAME)!)).toBe("0.45.0");
      expect(await db.all("PRAGMA foreign_key_check")).toEqual([]);
      expect(await db.all("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
    } finally {
      db.close();
    }
  });

  it("makes the columns and indexes of the paper", async () => {
    const { db } = await setupApp();
    for (const [table, want] of Object.entries(PAPER)) {
      expect(await columnsOf(db, table), table).toEqual(want.columns);
      expect(await indexesOf(db, table), table).toEqual(want.indexes);
    }
    // the two columns of the barcode release are nullable, so a row older code writes is still valid
    expect((await columnsOf(db, "expected_bills")).slice(-2)).toEqual(["reference TEXT", "payee_iban TEXT"]);
  });

  it("run a second time applies nothing, and a copy run without its record stops on its first table and leaves nothing half made", async () => {
    const db = fromFixture();
    try {
      const m = all().find((x) => x.name === NAME)!;
      await applyMigrations(db, (await pendingMigrations(db, all())).pending);
      const schema = await db.all("SELECT type, name, sql FROM sqlite_master ORDER BY type, name");
      // recorded: a second run applies nothing
      expect(await applyMigrations(db, [m])).toEqual([]);
      // not recorded (a copy of the file made without its row): the plain CREATE TABLE stops it and the transaction leaves no table half made
      await db.run("DELETE FROM _migrations WHERE name = ?", [NAME]);
      await expect(applyMigrations(db, [m])).rejects.toThrow(/already exists/);
      expect(await db.all("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")).toEqual(schema);
      await db.run("INSERT INTO _migrations (name, applied_at, checksum, compat) VALUES (?, '2026-10-20T08:00:00.000Z', ?, '0.45.0')", [NAME, checksum(m.sql)]);
      expect(await db.all("SELECT name FROM _migrations WHERE name = ?", [NAME])).toHaveLength(1);
      // the next update has nothing to apply
      expect((await pendingMigrations(db, all())).pending).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("is opened by a build that stops at 0020, and refused by one below its floor", async () => {
    const db = fromFixture();
    try {
      await applyMigrations(db, (await pendingMigrations(db, all())).pending);
      const known = all().filter((m) => m.name < NAME);
      const rollback = await pendingMigrations(db, known, { appVersion: "0.45.0" });
      expect(rollback.pending).toEqual([]);
      expect(rollback.ahead).toEqual([NAME]);
      await expect(pendingMigrations(db, known, { appVersion: "0.44.9" })).rejects.toThrow(/newer app version/);
    } finally {
      db.close();
    }
  });

  it("leaves a foreign key check that is empty when a rollback build deletes a bill, a member and an account", async () => {
    const { db, s, adminId, member } = await setupApp();
    const maija = await member("maija");
    const at = "2026-10-20T08:00:00.000Z";
    await s.finance(adminId).upsertAccount({ id: "a-matti", connectionId: null, provider: "enablebanking", externalId: "x", identity: "idn-joint", name: "Yhteinen tili", iban: null, currency: "EUR", type: "checking" });
    await s.finance(maija.id).upsertAccount({ id: "a-maija", connectionId: null, provider: "enablebanking", externalId: "y", identity: "idn-joint", name: "Yhteinen tili", iban: null, currency: "EUR", type: "checking" });
    const tx = (id: string, user: string, account: string) =>
      db.run(
        "INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, merchant, category, category_source, source, imported_at) VALUES (?, ?, ?, '2026-10-10', -12000, 'EUR', 'booked', 'ESIMERKKI OY', 'other', 'default', 'enablebanking', ?)",
        [id, user, account, at],
      );
    await tx("bill-1", adminId, "a-matti");
    await tx("bill-2", maija.id, "a-maija");
    for (const [bill, user] of [["bill-1", adminId], ["bill-2", maija.id]] as const) {
      await db.run("INSERT INTO statement_bill (bill_tx_id, user_id, account_key, period_from, period_to, statement_cents, saved_at) VALUES (?, ?, 'idn-joint', '2026-09-01', '2026-09-30', 12000, ?)", [bill, user, at]);
      await db.run("INSERT INTO statement_rows (id, bill_tx_id, account_key, user_id, day, cents, text, row_key, imported_at) VALUES (?, ?, 'idn-joint', ?, '2026-09-05', -4000, 'KAHVILA', 'k1', ?)", [`${bill}-r`, bill, user, at]);
    }
    await db.run("INSERT INTO user_factor (id, user_id, kind, secret, created_at) VALUES ('f1', ?, 'totp', 'sealed', ?)", [maija.id, at]);
    await db.run("INSERT INTO access_token (id, user_id, scope, hash, created_at) VALUES ('t1', ?, 'ha_summary', 'abc', ?)", [maija.id, at]);
    await db.run("INSERT INTO contract_terms (user_id, series_key, notice_days, answered_at) VALUES (?, 'esimerkki-oy', 30, ?)", [maija.id, at]);
    await db.run("INSERT INTO payer_role (scope, user_id, counterparty_key, role, answered_by, answered_at) VALUES ('member', ?, 'name:ville', 'gift', ?, ?)", [maija.id, adminId, at]);
    await db.run("INSERT INTO payer_role (scope, user_id, counterparty_key, role, answered_by, answered_at) VALUES ('household', NULL, 'name:ville', 'cost_share', ?, ?)", [maija.id, at]);
    await db.run("INSERT INTO account_agreement (account_key, valid_from, kind, set_by, set_at) VALUES ('idn-joint', '2026-01-01', 'equal', ?, ?)", [maija.id, at]);
    await db.run("INSERT INTO foreign_rows (account_key, raw_key, booking_date, amount_minor, scale, currency, seen_at) VALUES ('idn-joint', 'r1', '2026-10-01', -5400, 2, 'USD', ?)", [at]);
    await db.run("INSERT INTO account_balances (account_key, day, type, cents, fetched_at, source) VALUES ('idn-joint', '2026-10-20', 'CLBD', 125000, ?, 'bank')", [at]);
    await db.run("INSERT INTO account_fetch (account_key, at, trigger, user_id) VALUES ('idn-joint', ?, 'manual', ?)", [at, maija.id]);

    // a bill is deleted as a transaction row: its statement goes with it, the other member's stays
    await db.run("DELETE FROM transactions WHERE id = 'bill-1'");
    expect(await db.all("SELECT bill_tx_id FROM statement_bill")).toEqual([{ bill_tx_id: "bill-2" }]);
    expect(await db.all("SELECT id FROM statement_rows")).toEqual([{ id: "bill-2-r" }]);

    // a member is deleted by a build that does not know the new tables: what is the member's own goes, the key's stays
    await db.run("DELETE FROM users WHERE id = ?", [maija.id]);
    for (const t of ["statement_bill", "statement_rows", "user_factor", "access_token", "contract_terms"]) expect(await db.all(`SELECT 1 FROM ${t}`), t).toEqual([]);
    expect(await db.all("SELECT scope, user_id, answered_by FROM payer_role")).toEqual([{ scope: "household", user_id: null, answered_by: null }]);
    expect(await db.all("SELECT set_by FROM account_agreement")).toEqual([{ set_by: null }]);
    expect(await db.all("SELECT user_id FROM account_fetch")).toEqual([{ user_id: null }]);
    expect(await db.all("SELECT 1 FROM foreign_rows")).toHaveLength(1);
    expect(await db.all("SELECT 1 FROM account_balances")).toHaveLength(1);

    // an account is deleted: its transactions go, and with them any bill
    await tx("bill-3", adminId, "a-matti");
    await db.run("INSERT INTO statement_bill (bill_tx_id, user_id, account_key, period_from, period_to, saved_at) VALUES ('bill-3', ?, 'idn-joint', '2026-09-01', '2026-09-30', ?)", [adminId, at]);
    await db.run("DELETE FROM accounts WHERE id = 'a-matti'");
    expect(await db.all("SELECT 1 FROM statement_bill")).toEqual([]);
    expect(await db.all("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("keeps the rows of a joint key when one member is removed", async () => {
    const { db, s, adminId, member } = await setupApp();
    const maija = await member("maija");
    const at = "2026-10-20T08:00:00.000Z";
    for (const [id, user] of [["a-matti", adminId], ["a-maija", maija.id]] as const) {
      await s.finance(user).upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: id, identity: "idn-joint", name: "Yhteinen tili", iban: null, currency: "EUR", type: "checking" });
    }
    await db.run("INSERT INTO foreign_rows (account_key, raw_key, booking_date, amount_minor, scale, currency, seen_at) VALUES ('idn-joint', 'r1', '2026-10-01', -5400, 2, 'USD', ?)", [at]);
    await db.run("INSERT INTO account_balances (account_key, day, type, cents, fetched_at, source) VALUES ('idn-joint', '2026-10-20', 'CLBD', 125000, ?, 'bank')", [at]);
    await db.run("INSERT INTO account_agreement (account_key, valid_from, kind, set_by, set_at) VALUES ('idn-joint', '2026-01-01', 'equal', ?, ?)", [maija.id, at]);
    await s.household.removeMember(maija.id);
    expect(await db.all("SELECT 1 FROM foreign_rows")).toHaveLength(1);
    expect(await db.all("SELECT 1 FROM account_balances")).toHaveLength(1);
    expect(await db.all("SELECT set_by FROM account_agreement")).toEqual([{ set_by: null }]);
    // nobody holds the key once the last copy is gone: the sweep still keeps what cannot be fetched again or was the user's own answer
    await db.run("DELETE FROM accounts WHERE id = 'a-matti'");
    await s.household.sweepUnheldKeys();
    for (const t of ["foreign_rows", "account_agreement"]) expect(await db.all(`SELECT 1 FROM ${t}`), t).toHaveLength(1);
    expect(await db.all("SELECT 1 FROM account_balances")).toHaveLength(1);
  });

  it("has no table keyed on an account key that a user's removal deletes, except a member's own statement rows", async () => {
    const { db } = await setupApp();
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).map((t) => t.name);
    const found: string[] = [];
    for (const t of tables) {
      const keyed = (await db.all<{ name: string }>(`PRAGMA table_info(${t})`)).some((c) => c.name === "account_key");
      if (!keyed) continue;
      const cascades = (await db.all<{ table: string; on_delete: string }>(`PRAGMA foreign_key_list(${t})`)).filter((f) => f.table === "users" && f.on_delete === "CASCADE");
      if (cascades.length) found.push(t);
    }
    // account_use holds a user's own weight
    expect(found.filter((t) => !["account_use", "statement_bill", "statement_rows"].includes(t))).toEqual([]);
  });

  it("moves a statement with its bill when merging accounts renames the bill's id", async () => {
    const { db, s, adminId } = await setupApp();
    const repo = s.finance(adminId);
    const at = "2026-10-20T08:00:00.000Z";
    for (const id of ["csv-1", "a-bank"]) await repo.upsertAccount({ id, connectionId: null, provider: id === "csv-1" ? "csv" : "enablebanking", externalId: null, identity: id === "csv-1" ? null : "idn-1", name: id, iban: null, currency: "EUR", type: "checking" });
    await db.run(
      "INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, merchant, category, category_source, source, imported_at) VALUES ('old-id', ?, 'csv-1', '2026-10-10', -12000, 'EUR', 'booked', 'ESIMERKKI OY', 'other', 'default', 'csv', ?)",
      [adminId, at],
    );
    await db.run("INSERT INTO statement_bill (bill_tx_id, user_id, account_key, period_from, period_to, saved_at) VALUES ('old-id', ?, 'csv-1', '2026-09-01', '2026-09-30', ?)", [adminId, at]);
    await db.run("INSERT INTO statement_rows (id, bill_tx_id, account_key, user_id, day, cents, text, row_key, imported_at) VALUES ('r1', 'old-id', 'csv-1', ?, '2026-09-05', -4000, 'KAHVILA', 'k1', ?)", [adminId, at]);
    await repo.mergeAccountInto("csv-1", "a-bank", new Map([["old-id", "new-id"]]));
    expect(await db.all("SELECT bill_tx_id FROM statement_bill")).toEqual([{ bill_tx_id: "new-id" }]);
    expect(await db.all("SELECT bill_tx_id FROM statement_rows")).toEqual([{ bill_tx_id: "new-id" }]);
    expect(await db.all("PRAGMA foreign_key_check")).toEqual([]);
  });
});
