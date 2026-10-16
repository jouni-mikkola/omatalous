/** Row types and SQL row → object mappers shared by the repositories. */
import type { Account, AccountType, CategorySource, Transaction, TransactionStatus } from "@banking/core";
import type { SqlValue } from "./types.ts";

export type Row = Record<string, SqlValue>;

export const str = (v: SqlValue | undefined) => (v == null ? null : String(v));
export const num = (v: SqlValue | undefined) => (v == null ? null : Number(v));

/**
 * `name` is the name the household sees: the user's own when they gave one, else the bank's. The bank's stays in
 * `bankName` (a link rewrites it, never `customName`).
 */
export interface StoredAccount extends Account {
  userId: string;
  bankName: string;
  customName: string | null;
  /** Who holds the account, as the bank gives it ("A, B"). Null: not read yet. "": read, and the bank gave none. */
  holder: string | null;
  /** A card's last four digits ("•••• 1234"). */
  cardMask: string | null;
  creditLimitCents: number | null;
  connectionId: string | null;
  provider: string;
  externalId: string | null;
  identity: string | null;
  balanceCents: number | null;
  balanceAt: string | null;
  lastSyncedAt: string | null;
}

export interface Connection {
  id: string;
  userId: string;
  provider: string;
  institution: string;
  country: string;
  status: "active" | "expired" | "revoked";
  validUntil: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
}

export interface StoredTransaction extends Transaction {
  userId: string;
  valueDate: string | null;
  reference: string | null;
  source: string;
  raw: string | null;
}

export interface SyncRun {
  id: number;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "ok" | "partial" | "failed";
  fetched: number;
  inserted: number;
  message: string | null;
}

export type Role = "admin" | "member";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  createdAt: string;
}

/**
 * A select column: the bank the account's connection was made with (`connections.institution`), null for an account
 * without a connection. `a` is the name or alias of the accounts table in the query.
 */
export const accountBank = (a: string) => `(SELECT c.institution FROM connections c WHERE c.id = ${a}.connection_id AND c.user_id = ${a}.user_id) AS bank`;

export function toAccount(r: Row): StoredAccount {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    connectionId: str(r.connection_id),
    provider: String(r.provider),
    externalId: str(r.external_id),
    identity: str(r.identity),
    name: str(r.custom_name) ?? String(r.name),
    bankName: String(r.name),
    // selected with accountBank(); a query without it leaves the bank unknown
    bank: str(r.bank),
    customName: str(r.custom_name),
    holder: str(r.holder),
    cardMask: str(r.card_mask),
    creditLimitCents: num(r.credit_limit_cents),
    iban: str(r.iban),
    currency: String(r.currency),
    type: String(r.type) as AccountType,
    balanceCents: num(r.balance_cents),
    balanceAt: str(r.balance_at),
    lastSyncedAt: str(r.last_synced_at),
  };
}

export function toConnection(r: Row): Connection {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    provider: String(r.provider),
    institution: String(r.institution),
    country: String(r.country),
    status: String(r.status) as Connection["status"],
    validUntil: str(r.valid_until),
    createdAt: String(r.created_at),
    lastSyncedAt: str(r.last_synced_at),
  };
}

export const TX_COLUMNS =
  "id, user_id, account_id, booking_date, value_date, amount_cents, currency, status, counterparty, counterparty_iban, description, reference, mcc, bank_txn_code, merchant, category, category_source, is_transfer, source, raw";
/** For loading whole histories: everything but the bank's raw JSON, which nothing reads back. */
export const TX_COLUMNS_LIGHT = TX_COLUMNS.replace(", raw", "");

export function toTransaction(r: Row): StoredTransaction {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    accountId: String(r.account_id),
    bookingDate: String(r.booking_date),
    valueDate: str(r.value_date),
    amountCents: Number(r.amount_cents),
    currency: String(r.currency),
    status: String(r.status) as TransactionStatus,
    counterparty: str(r.counterparty),
    counterpartyIban: str(r.counterparty_iban),
    description: str(r.description),
    reference: str(r.reference),
    mcc: str(r.mcc),
    bankTxnCode: str(r.bank_txn_code),
    merchant: String(r.merchant),
    category: String(r.category),
    categorySource: String(r.category_source) as CategorySource,
    isTransfer: Number(r.is_transfer) === 1,
    source: String(r.source),
    raw: str(r.raw),
  };
}

export function toSyncRun(r: Row): SyncRun {
  return {
    id: Number(r.id),
    trigger: String(r.trigger),
    startedAt: String(r.started_at),
    finishedAt: str(r.finished_at),
    status: String(r.status) as SyncRun["status"],
    fetched: Number(r.fetched),
    inserted: Number(r.inserted),
    message: str(r.message),
  };
}

export function toUser(r: Row): User {
  return {
    id: String(r.id),
    username: String(r.username),
    displayName: String(r.display_name),
    role: String(r.role) as Role,
    mustChangePassword: Number(r.must_change_password) === 1,
    createdAt: String(r.created_at),
  };
}

/** A row in another currency to keep: the bank's own figure in its own currency, as `parseForeignAmount` read it. */
export interface ForeignRowInput {
  rawKey: string;
  bookingDate: string;
  amountMinor: number;
  scale: number;
  currency: string;
  text: string | null;
}
