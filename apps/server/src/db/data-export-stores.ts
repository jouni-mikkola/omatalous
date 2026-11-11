/**
 * "Vie kaikki tiedot": one JSON file of what the signed-in user sees in the app, the format docs/DATA_EXPORT.md writes
 * down. Every table of the database is either a store below or named in LEFT_OUT with the reason. A store says which rows
 * of its table the viewer sees (`rows`) and which columns are written: the three tables that hold a person's identity or
 * a payload name them (`allow`, so a column added later stays out until it is named), the others write every column but
 * those in `omit`. test/data-export.test.ts fails for a table that is neither a store nor left out.
 */

import type { SqlValue } from "./types.ts";
import { EXTENSIONS } from "../extensions.ts";
/** What storeColumns needs of the services: the columns of a table. */
type ColumnSource = { household: { tableColumns(table: string): Promise<string[]> } };

export const EXPORT_FORMAT = "omatalous-export";
export const EXPORT_VERSION = 1;

/** Who asks and what they see: their accounts, the accounts shared with them (`sharedInView`) and the people those name. */
export interface Viewer {
  userId: string;
  /** An administrator sees every member in Asetukset > Talouden jäsenet. */
  admin: boolean;
  /** The ids of the viewer's own accounts and of the accounts shared with them. */
  ownAccounts: readonly string[];
  sharedAccounts: readonly string[];
  /** The real accounts of both (`accountKey`): the key the household's answers and balances are kept under. */
  accountKeys: readonly string[];
  /** Of those, the keys the viewer is weighted in: what a settlement says of a pool or card is for the users who weigh something in it. */
  weightedKeys: readonly string[];
  /** The viewer, the owners of the shared accounts and the members the viewer shares an account with (the file's `users` also holds whom its rows name). */
  users: readonly string[];
}

interface Clause {
  sql: string;
  params: SqlValue[];
}

interface StoreRead {
  table: string;
  columns: readonly string[];
  owner: boolean;
  where: Clause | undefined;
  order: string;
}

export interface ExportStore {
  /** The array's name in the file. */
  key: string;
  table: string;
  /** The columns written, in this order; every other column stays in the database. */
  allow?: readonly string[];
  /** Without `allow`: columns that stay in the database (a value rebuilt from the rest). */
  omit?: readonly string[];
  /** Adds `owner_username`, the username of the row's owner, so a row of another user can be told apart on import. */
  owner?: boolean;
  /** The rows the viewer sees; none = every row (a table of the household). */
  rows?: (v: Viewer) => Clause;
  /** A stable order, so two exports of one database are equal. */
  order: string;
}

/** A list as one JSON parameter: no limit on how many ids, one `?`. */
const list = (ids: readonly string[]) => JSON.stringify(ids);
const among = (column: string) => `${column} IN (SELECT value FROM json_each(?))`;
const accountIds = (v: Viewer) => [...v.ownAccounts, ...v.sharedAccounts];
const mine = (v: Viewer): Clause => ({ sql: "user_id = ?", params: [v.userId] });
const inView = (v: Viewer): Clause => ({ sql: among("account_id"), params: [list(accountIds(v))] });
const byKey = (v: Viewer): Clause => ({ sql: among("account_key"), params: [list(v.accountKeys)] });
const byWeightedKey = (v: Viewer): Clause => ({ sql: among("account_key"), params: [list(v.weightedKeys)] });
/** The users a row of an agreement that shows the income ratio names, as `$.who`; the ones who have put it, `$.confirmed`. */
const WHO = "json_each(account_agreement.value, '$.who')";
const PUT = "json_each(account_agreement.value, '$.confirmed')";
/** As `byWeightedKey`, and a row that still waits for a partner only for the users it names or who have put it (the route's rule). */
const agreementsOfViewer = (v: Viewer): Clause => ({
  sql: `${among("account_key")} AND NOT CASE WHEN json_valid(value) AND (kind = 'income' OR (kind = 'fixed' AND json_extract(value, '$.rest.kind') = 'income'))
    THEN EXISTS (SELECT 1 FROM ${WHO} w WHERE w.value LIKE 'u:_%' AND w.value NOT IN (SELECT c.value FROM ${PUT} c))
      AND ? NOT IN (SELECT w.value FROM ${WHO} w) AND ? NOT IN (SELECT c.value FROM ${PUT} c)
    ELSE 0 END`,
  params: [list(v.weightedKeys), `u:${v.userId}`, `u:${v.userId}`],
});

/**
 * The users a row of the file names (`user_id`, `said_by`, `set_by`, `answered_by`, an owner `u:<id>`, the `who` and
 * `confirmed` of an agreement), read from the rows the viewer gets of those stores: so every such key is a row of `users`.
 */
function namedInRows(v: Viewer): Clause {
  const uid = (c: string) => `substr(${c}, 3)`;
  const part = (sql: string, params: SqlValue[]) => ({ sql, params });
  const pieces = [
    part(`SELECT said_by FROM owner_answer WHERE ${byKey(v).sql}`, byKey(v).params),
    part(`SELECT substr(owner, 3) FROM owner_answer WHERE owner LIKE 'u:%' AND ${byKey(v).sql}`, byKey(v).params),
    part(`SELECT set_by FROM account_split WHERE ${byKey(v).sql}`, byKey(v).params),
    part(`SELECT user_id FROM account_use WHERE ${byKey(v).sql}`, byKey(v).params),
    part(`SELECT said_by FROM account_use WHERE ${byKey(v).sql}`, byKey(v).params),
    part(`SELECT ${uid("owner")} FROM tx_part WHERE owner LIKE 'u:%' AND tx_id IN (SELECT id FROM transactions WHERE ${among("account_id")})`, [list(accountIds(v))]),
    part(`SELECT user_id FROM payer_role WHERE (user_id IS NULL OR user_id = ?)`, [v.userId]),
    part(`SELECT answered_by FROM payer_role WHERE (user_id IS NULL OR user_id = ?)`, [v.userId]),
    part(`SELECT set_by FROM account_agreement WHERE ${agreementsOfViewer(v).sql}`, agreementsOfViewer(v).params),
    ...["$.who", "$.confirmed"].map((path) =>
      part(`SELECT ${uid("j.value")} FROM (SELECT value AS v FROM account_agreement WHERE ${agreementsOfViewer(v).sql}) a, json_each(a.v, '${path}') j WHERE j.value LIKE 'u:%'`, agreementsOfViewer(v).params),
    ),
  ];
  return {
    sql: `${among("id")} OR ${pieces.map((x) => `id IN (${x.sql})`).join(" OR ")}`,
    params: [list(v.users), ...pieces.flatMap((x) => x.params)],
  };
}

const STORES: readonly ExportStore[] = [
  {
    key: "users",
    table: "users",
    allow: ["id", "username", "display_name", "role", "created_at"],
    rows: (v) => (v.admin ? { sql: "1", params: [] } : namedInRows(v)),
    order: "created_at, id",
  },
  {
    key: "accounts",
    table: "accounts",
    allow: ["id", "user_id", "provider", "identity", "name", "iban", "currency", "type", "balance_cents", "balance_at", "last_synced_at", "created_at", "custom_name", "holder", "card_mask", "credit_limit_cents", "bank_type_code", "bank_usage", "bank_product", "psu_status", "type_source"],
    owner: true,
    rows: (v) => ({ sql: among("id"), params: [list(accountIds(v))] }),
    order: "created_at, id",
  },
  // the viewer's own accounts show who they are shared with, a shared account only the viewer's own share
  {
    key: "accountShares",
    table: "account_shares",
    rows: (v) => ({ sql: `(${among("account_id")} OR (${among("account_id")} AND user_id = ?))`, params: [list(v.ownAccounts), list(v.sharedAccounts), v.userId] }),
    order: "account_id, user_id",
  },
  {
    key: "transactions",
    table: "transactions",
    allow: [
      "id", "user_id", "account_id", "booking_date", "value_date", "amount_cents", "currency", "status", "counterparty", "counterparty_iban", "description", "reference", "mcc", "merchant",
      "category", "category_source", "is_transfer", "source", "imported_at", "bank_txn_code",
    ],
    owner: true,
    rows: inView,
    order: "booking_date, id",
  },
  { key: "rules", table: "category_rules", rows: mine, order: "id" },
  { key: "marks", table: "user_marks", rows: mine, order: "user_id, subject" },
  { key: "answers", table: "owner_answer", rows: byKey, order: "account_key, kind, key" },
  { key: "accountSplits", table: "account_split", rows: byKey, order: "account_key" },
  { key: "accountUse", table: "account_use", rows: byKey, order: "account_key, COALESCE(user_id, '')" },
  {
    key: "parts",
    table: "tx_part",
    rows: (v) => ({ sql: `tx_id IN (SELECT id FROM transactions WHERE ${among("account_id")})`, params: [list(accountIds(v))] }),
    order: "tx_id, owner, kind, grp",
  },
  // a loan another member typed is in the viewer's figures as a copy, not as the row the member stored
  { key: "loans", table: "loans", rows: mine, order: "created_at, id" },
  { key: "expectedBills", table: "expected_bills", rows: mine, order: "created_at, id" },
  { key: "spendingGoals", table: "spending_goal", rows: mine, order: "user_id" },
  { key: "categoryGoals", table: "category_goal", rows: mine, order: "user_id, category" },
  { key: "optimiseInputs", table: "optimise_inputs", rows: mine, order: "user_id, key" },
  { key: "optimiseStates", table: "optimise_states", rows: mine, order: "user_id, finding_id" },
  { key: "optimiseSnapshots", table: "optimise_snapshots", rows: mine, order: "user_id, month" },
  { key: "accountBalances", table: "account_balances", rows: byKey, order: "account_key, day, type" },
  { key: "accountHistory", table: "account_history", rows: inView, order: "account_id" },
  { key: "statementBills", table: "statement_bill", rows: mine, order: "bill_tx_id" },
  { key: "statementRows", table: "statement_rows", rows: mine, order: "bill_tx_id, row_key" },
  { key: "foreignRows", table: "foreign_rows", rows: byKey, order: "account_key, raw_key" },
  // the household's answers are for everybody, a member's own answers only for them
  { key: "payerRoles", table: "payer_role", rows: (v) => ({ sql: "(user_id IS NULL OR user_id = ?)", params: [v.userId] }), order: "scope, COALESCE(user_id, ''), counterparty_key" },
  { key: "householdMembers", table: "household_member", order: "created_at, id" },
  { key: "accountAgreements", table: "account_agreement", rows: agreementsOfViewer, order: "account_key, valid_from" },
  { key: "settlementClosed", table: "settlement_closed", rows: byWeightedKey, order: "account_key, month" },
  { key: "valuedAssets", table: "valued_asset", order: "id, day" },
  { key: "contractTerms", table: "contract_terms", rows: mine, order: "user_id, series_key" },
];

/** The stores of the file, in its order: STORES, then those of the add-on module (extensions.ts). */
export const exportStores = (): readonly ExportStore[] => [...STORES, ...EXTENSIONS.flatMap((e) => e.stores?.map((st) => st.export) ?? [])];

/** Tables the file does not hold, each with the reason: LEFT_OUT and those the add-on module leaves out. */
export const leftOut = (): Readonly<Record<string, string>> => Object.assign({}, LEFT_OUT, ...EXTENSIONS.map((e) => e.leftOut ?? {}));

const LEFT_OUT: Readonly<Record<string, string>> = {
  _migrations: "the schema's own bookkeeping; a new database makes its own",
  sqlite_sequence: "SQLite's counters of the tables above",
  sqlite_stat1: "SQLite's query statistics",
  sessions: "signed-in browsers: a session id is a secret",
  bank_credentials: "the bank application's private key",
  connections: "the bank consents and their state; a restore connects the banks again",
  user_factor: "second-factor secrets",
  view_opens: "the days views were opened, from when the app counted them: nothing reads or writes it now",
  service_tokens: "read-only keys for scripts: a token hash opens the data, and a copy makes none",
  access_token: "hashes of access tokens",
  account_fetch: "a log of when balances were fetched",
  sync_runs: "a log of fetches",
  security_events: "a log with network addresses",
  ops_requests: "a log of maintenance requests",
  settings: "the server's own settings, some of them secrets",
  merchant_industry: "register answers fetched again when needed",
  merchant_industry_users: "which of the household looked up which merchant, with the register answers above",
  tx_part_state: "built again from the transactions and answers",
};

/** The columns a store writes: the allowed ones, else every column of the table but the omitted ones. */
export async function storeColumns(s: ColumnSource, store: ExportStore): Promise<string[]> {
  if (store.allow) return [...store.allow];
  return (await s.household.tableColumns(store.table)).filter((n) => !store.omit?.includes(n));
}

/** What reads a store for a viewer (HouseholdRepo.exportSnapshot makes the statement): the columns written, whether the owner's username goes with them, the viewer's rows. */
export function storeRead(store: ExportStore, columns: readonly string[], v: Viewer): StoreRead {
  return { table: store.table, columns, owner: store.owner === true, where: store.rows?.(v), order: store.order };
}
