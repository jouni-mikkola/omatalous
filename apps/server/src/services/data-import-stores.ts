/**
 * "Tuo tiedot": what the import accepts of each store of the file (docs/DATA_EXPORT.md). Every column of a store is
 * checked against its type, length and list before anything is staged; a value that fails refuses the whole file. The
 * columns are the ones data-export-stores.ts writes (a test compares them), so a column added to the export fails the
 * import's test until it is named here.
 */
import { EXTENSIONS } from "../extensions.ts";
import { isIsoDate } from "../platform/validate.ts";
import { ACCOUNT_TYPES, CATEGORY_SOURCES, type RuleField } from "@banking/core";

/** A value that is not what its column holds. */
export class BadValue extends Error {}

export type Check = (v: unknown) => string | number | null;

// control characters (a tab and a line break are text) never belong in a stored word
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const text =
  (max: number, min = 1, pattern?: RegExp): Check =>
  (v) => {
    if (typeof v !== "string" || v.length < min || v.length > max || CONTROL.test(v) || (pattern && !pattern.test(v))) throw new BadValue();
    return v;
  };
const maybe =
  (check: Check): Check =>
  (v) =>
    v === null || v === undefined ? null : check(v);
const whole =
  (lo: number, hi: number): Check =>
  (v) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < lo || v > hi) throw new BadValue();
    return v;
  };
const day: Check = (v) => {
  if (!isIsoDate(v)) throw new BadValue();
  return v;
};
const oneOf =
  (list: readonly string[]): Check =>
  (v) => {
    if (typeof v !== "string" || !list.includes(v)) throw new BadValue();
    return v;
  };
const json =
  (max: number): Check =>
  (v) => {
    const s = text(max, 0)(v) as string;
    try {
      JSON.parse(s);
    } catch {
      throw new BadValue();
    }
    return s;
  };

/** Money: whole cents, a hundred billion euros at most either way. */
const cents = whole(-1e13, 1e13);
const flag = whole(0, 1);
const id = text(200);
const at = text(40, 10, /^\d{4}-\d{2}-\d{2}/);
const word = text(40);
const currency = text(3, 3, /^[A-Z]{3}$/);

/** How a store's rows reach this user's data. */
export interface ImportStore {
  /** The array's name in the file. */
  key: string;
  table: string;
  /** Every column of the file's row with its check; a key of the row not here is ignored and counted (`extra` aside). */
  cols: Readonly<Record<string, Check>>;
  /** Keys read for the plan and never stored: the owner's username, the signature. */
  extra?: readonly string[];
  /** The most rows the array may hold. */
  max: number;
  /** The columns that tell a row from another: a row of the table with the same values is kept and counted as existing. */
  pk: readonly string[];
  /** The column holding the row's user (`user_id`): only this user's rows are written. */
  user?: string;
  /** A user column that may be null (a household row): a person other than the user makes the row someone else's. */
  userOrNull?: string;
  /** A user named as the one who said something: the user themselves, else null (a person this import cannot name). */
  said?: readonly string[];
  /** The column holding a real account's key; the row is the account owner's. */
  accountKey?: string;
  /** The column holding an account's id, and whether it may be null. */
  account?: { column: string; nullable?: boolean };
  /** The column holding a transaction's id. */
  tx?: string;
  /** A column holding a person as `u:<user id>` (or `u:` for a holder who is no user): the user's own, whoever the file says. */
  owner?: readonly string[];
  /** Household-wide rows (those with no user, where the store has a user column that may be null): written only for an admin. */
  household?: true;
  /** The column of an opaque id: a new row keeps its own while the table has none like it, else gets a fresh one. */
  idColumn?: string;
}

const MAX_ROWS = 50_000;
/** The rule fields of core, every one of them (the type stops a field being left out or made up). */
const RULE_FIELDS = Object.keys({ merchant: 1, merchant_exact: 1, description: 1, counterparty: 1, any: 1 } satisfies Record<RuleField, 1>);

const IMPORT_STORES: readonly ImportStore[] = [
  { key: "users", table: "users", cols: { id, username: text(100), display_name: text(200), role: oneOf(["admin", "member"]), created_at: at }, max: 1000, pk: ["id"] },
  {
    key: "accounts",
    table: "accounts",
    cols: {
      id, user_id: id, provider: word, identity: maybe(text(200)), name: text(200), iban: maybe(text(40)), currency,
      type: oneOf(ACCOUNT_TYPES), balance_cents: maybe(cents), balance_at: maybe(at), last_synced_at: maybe(at),
      created_at: at, custom_name: maybe(text(200)), holder: maybe(text(200, 0)), card_mask: maybe(text(40, 0)), credit_limit_cents: maybe(whole(0, 1e13)),
      bank_type_code: maybe(text(8, 0, /^[A-Z]*$/)), bank_usage: maybe(text(8)), bank_product: maybe(text(120)), psu_status: maybe(text(40)), type_source: maybe(oneOf(["bank", "user"])),
    },
    extra: ["owner_username"],
    max: 1000,
    pk: ["id"],
  },
  { key: "accountShares", table: "account_shares", cols: { account_id: id, user_id: id, created_at: at }, max: 5000, pk: ["account_id", "user_id"] },
  {
    key: "transactions",
    table: "transactions",
    cols: {
      id, user_id: id, account_id: id, booking_date: day, value_date: maybe(day), amount_cents: cents, currency, status: oneOf(["booked", "pending"]),
      counterparty: maybe(text(500, 0)), counterparty_iban: maybe(text(40, 0)), description: maybe(text(2000, 0)), reference: maybe(text(200, 0)), mcc: maybe(text(10, 0)),
      merchant: text(500, 0), category: text(60), category_source: oneOf(CATEGORY_SOURCES), is_transfer: flag, source: word, imported_at: at,
      bank_txn_code: maybe(text(40, 0)),
    },
    extra: ["owner_username", "signature"],
    max: 500_000,
    pk: ["id"],
    user: "user_id",
    account: { column: "account_id" },
  },
  { key: "rules", table: "category_rules", cols: { id: whole(0, 1e12), user_id: id, field: oneOf(RULE_FIELDS), pattern: text(200), category: text(60), priority: whole(-1e6, 1e6), created_at: at }, max: 2000, pk: ["user_id", "field", "pattern"], user: "user_id" },
  { key: "marks", table: "user_marks", cols: { user_id: id, subject: text(300), mark: oneOf(["in_use", "cancelled", "dismissed"]), marked_at: at }, max: 5000, pk: ["user_id", "subject"], user: "user_id" },
  { key: "answers", table: "owner_answer", cols: { account_key: id, kind: oneOf(["in", "opening"]), key: text(300, 0), owner: text(200), said_by: id, said_at: at }, max: MAX_ROWS, pk: ["account_key", "kind", "key"], accountKey: "account_key", said: ["said_by"], owner: ["owner"] },
  { key: "accountSplits", table: "account_split", cols: { account_key: id, mode: oneOf(["source"]), set_by: maybe(id), set_at: at }, max: 5000, pk: ["account_key"], accountKey: "account_key", said: ["set_by"] },
  { key: "accountUse", table: "account_use", cols: { account_key: id, user_id: maybe(id), weight: whole(0, 1e6), said_by: maybe(id), said_at: at }, max: 5000, pk: ["account_key", "user_id"], accountKey: "account_key", userOrNull: "user_id", said: ["said_by"] },
  { key: "parts", table: "tx_part", cols: { tx_id: id, owner: text(200), kind: word, grp: text(200, 0), cents, passed: flag }, max: 1_500_000, pk: ["tx_id", "owner", "kind", "grp"], tx: "tx_id", owner: ["owner"] },
  {
    key: "loans",
    table: "loans",
    cols: {
      id, user_id: id, name: text(200), lender: maybe(text(200, 0)), kind: word, granted_cents: maybe(whole(0, 1e13)), balance_cents: whole(0, 1e13), balance_date: day,
      rate_bp: maybe(whole(0, 1e6)), reference: maybe(word), margin_bp: maybe(whole(0, 1e6)), repayment: maybe(word), interval_months: maybe(whole(0, 1200)), payment_cents: maybe(whole(0, 1e13)),
      end_date: maybe(day), limit_cents: maybe(whole(0, 1e13)), series_key: maybe(text(200)), created_at: at, updated_at: at, account_id: maybe(id), rate_review_date: maybe(day),
    },
    max: 500,
    pk: ["user_id", "id"],
    user: "user_id",
    account: { column: "account_id", nullable: true },
    idColumn: "id",
  },
  {
    key: "expectedBills",
    table: "expected_bills",
    cols: { id, user_id: id, name: text(200), amount_cents: whole(1, 1e12), due_date: day, cadence: oneOf(["once", "quarterly", "semiannual", "yearly"]), category: maybe(text(60)), created_at: at, reference: maybe(text(200, 0)), payee_iban: maybe(text(40, 0)) },
    max: 100,
    pk: ["user_id", "id"],
    user: "user_id",
    idColumn: "id",
  },
  { key: "optimiseInputs", table: "optimise_inputs", cols: { user_id: id, key: text(100), value: text(2000, 0), as_of: day }, max: 1000, pk: ["user_id", "key"], user: "user_id" },
  {
    key: "optimiseStates",
    table: "optimise_states",
    cols: { user_id: id, finding_id: text(200), status: oneOf(["done", "dismissed", "snoozed"]), reason: maybe(text(500, 0)), until: maybe(day), effective_date: maybe(day), mid_cents: maybe(cents), baseline: maybe(text(2000, 0)), decided_at: at },
    max: 5000,
    pk: ["user_id", "finding_id"],
    user: "user_id",
  },
  { key: "optimiseSnapshots", table: "optimise_snapshots", cols: { user_id: id, month: text(10, 7), data: json(150_000), created_at: at }, max: 1000, pk: ["user_id", "month"], user: "user_id" },
  {
    key: "accountBalances",
    table: "account_balances",
    cols: { account_key: id, day, type: word, reference_date: maybe(day), cents, fetched_at: at, source: word },
    max: MAX_ROWS,
    pk: ["account_key", "day", "type"],
    accountKey: "account_key",
  },
  { key: "accountHistory", table: "account_history", cols: { account_id: id, asked_from: day, first_row_day: maybe(day), source: word, recorded_at: at }, max: 5000, pk: ["account_id"], account: { column: "account_id" } },
  {
    key: "statementBills",
    table: "statement_bill",
    cols: { bill_tx_id: id, user_id: id, account_key: id, period_from: day, period_to: day, statement_cents: maybe(cents), saved_at: at, detached_at: maybe(at), detached_reason: maybe(text(200, 0)) },
    max: 5000,
    pk: ["bill_tx_id"],
    user: "user_id",
    accountKey: "account_key",
    tx: "bill_tx_id",
  },
  {
    key: "statementRows",
    table: "statement_rows",
    cols: { id, bill_tx_id: id, account_key: id, user_id: id, day, cents: whole(-1e13, 1e13), text: text(120), row_key: text(200), imported_at: at },
    max: MAX_ROWS,
    pk: ["user_id", "bill_tx_id", "row_key"],
    user: "user_id",
    accountKey: "account_key",
    tx: "bill_tx_id",
    idColumn: "id",
  },
  {
    key: "foreignRows",
    table: "foreign_rows",
    cols: { account_key: id, raw_key: text(200), booking_date: day, amount_minor: whole(-1e15, 1e15), scale: whole(0, 3), currency, text: maybe(text(500, 0)), seen_at: at },
    max: MAX_ROWS,
    pk: ["account_key", "raw_key"],
    accountKey: "account_key",
  },
  {
    key: "payerRoles",
    table: "payer_role",
    cols: { scope: word, user_id: maybe(id), counterparty_key: text(300), role: word, answered_by: maybe(id), answered_at: at },
    max: MAX_ROWS,
    pk: ["scope", "user_id", "counterparty_key"],
    userOrNull: "user_id",
    said: ["answered_by"],
    household: true,
  },
  { key: "householdMembers", table: "household_member", cols: { id, name: text(80), weight: whole(0, 1e6), created_at: at }, max: 200, pk: ["name"], idColumn: "id", household: true },
  {
    key: "accountAgreements",
    table: "account_agreement",
    cols: { account_key: id, valid_from: text(10, 10), kind: word, value: json(10_000), set_by: maybe(id), set_at: at },
    max: 5000,
    pk: ["account_key", "valid_from"],
    accountKey: "account_key",
    said: ["set_by"],
  },
  {
    key: "settlementClosed",
    table: "settlement_closed",
    cols: { account_key: id, month: text(7, 7, /^\d{4}-\d{2}$/), closed_on: day, snapshot: json(150_000), written_at: at },
    max: 5000,
    pk: ["account_key", "month"],
    accountKey: "account_key",
  },
  { key: "valuedAssets", table: "valued_asset", cols: { id, kind: word, name: text(200), day, cents: whole(0, 1e13) }, max: MAX_ROWS, pk: ["id", "day"], household: true },
  { key: "contractTerms", table: "contract_terms", cols: { user_id: id, series_key: text(200), notice_days: maybe(whole(0, 3650)), renews_on: maybe(day), answered_at: at }, max: 5000, pk: ["user_id", "series_key"], user: "user_id" },
];

export const IMPORT_BY_KEY: ReadonlyMap<string, ImportStore> = new Map(IMPORT_STORES.map((s) => [s.key, s]));

/** IMPORT_STORES and the stores of the build's extensions (extensions.ts), after them. */
export const importStores = (): readonly ImportStore[] => [...IMPORT_STORES, ...EXTENSIONS.flatMap((e) => e.stores?.map((st) => st.import) ?? [])];

/** The store of a key of the file, an extension's too. */
export const importStoreOf = (key: string): ImportStore | undefined => IMPORT_BY_KEY.get(key) ?? importStores().find((st) => st.key === key);

/** The stores of the file the import never writes, each with its reason (the page shows the row count as skipped). */
export const NEVER_WRITTEN: Readonly<Record<string, "users" | "sharing">> = { users: "users", accountShares: "sharing" };

/** The format and the version this import reads. */
export const IMPORT_FORMAT = "omatalous-export";
export const IMPORT_VERSION = 1;

/** Limits of one import: the text of all chunks together, the text of one chunk (the app's body cap is 256 KiB), the minutes a session lasts without a chunk. */
export const IMPORT_LIMITS = { totalBytes: 64 * 1024 * 1024, chunkBytes: 192 * 1024, sessionMinutes: 15, chunks: 2000 } as const;

/** One row against its store: the checked values, and how many keys the store does not know. */
export function checkRow(store: ImportStore, raw: unknown): { row: Record<string, string | number | null>; unknownKeys: number } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new BadValue("row");
  const keys = Object.keys(raw);
  if (keys.length > 200) throw new BadValue("row");
  const row: Record<string, string | number | null> = {};
  const get = (k: string) => (Object.hasOwn(raw, k) ? (raw as Record<string, unknown>)[k] : undefined);
  for (const [name, check] of Object.entries(store.cols)) {
    try {
      row[name] = check(get(name));
    } catch {
      throw new BadValue(name);
    }
  }
  for (const name of store.extra ?? []) {
    const v = get(name);
    if (v !== undefined && v !== null) {
      if (typeof v !== "string" || v.length > 2000 || CONTROL.test(v)) throw new BadValue(name);
      row[`@${name}`] = v;
    }
  }
  return { row, unknownKeys: keys.filter((k) => !Object.hasOwn(store.cols, k) && !store.extra?.includes(k)).length };
}
