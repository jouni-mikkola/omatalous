/** ISO date, YYYY-MM-DD. */
export type IsoDate = string;

/** loan: a mortgage or loan account; its own rows are bookkeeping, the payments from checking are the debt service. */
export const ACCOUNT_TYPES = ["checking", "savings", "credit_card", "loan", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Account {
  id: string;
  name: string;
  iban: string | null;
  currency: string;
  type: AccountType;
}

export type TransactionStatus = "booked" | "pending";

/**
 * A transaction as delivered by a bank provider, before enrichment.
 * Amounts are integer cents: negative = money out, positive = money in.
 */
export interface RawTransaction {
  /** Provider's own stable id when it has one (entry_reference etc). */
  externalId: string | null;
  bookingDate: IsoDate;
  valueDate: IsoDate | null;
  amountCents: number;
  currency: string;
  status: TransactionStatus;
  counterparty: string | null;
  counterpartyIban: string | null;
  description: string | null;
  reference: string | null;
  mcc: string | null;
  raw?: unknown;
}

/**
 * Where a category came from: the user by hand, a rule, the card's MCC, the
 * same merchant's other rows, the trade register, nothing (default),
 * transfer detection, or a payment it cancels (match: a refund, money paid back).
 */
export type CategorySource = "user" | "rule" | "mcc" | "merchant" | "industry" | "default" | "transfer" | "match";

/** A stored, enriched transaction. */
export interface Transaction {
  id: string;
  accountId: string;
  bookingDate: IsoDate;
  amountCents: number;
  currency: string;
  status: TransactionStatus;
  counterparty: string | null;
  counterpartyIban: string | null;
  description: string | null;
  mcc: string | null;
  merchant: string;
  category: string;
  categorySource: CategorySource;
  isTransfer: boolean;
  /** The connector or import the row came from, when the caller has it. Layouts of one source differ, sources differ more. */
  source?: string;
}

/** merchant_exact: the whole merchant name, so "Matti Meikäläinen" does not catch "Mobilepay Matti Meikäläinen". */
export type RuleField = "merchant" | "merchant_exact" | "description" | "counterparty" | "any";

export interface CategoryRule {
  id?: number;
  field: RuleField;
  /**
   * Plain words matched as whole words, case-insensitive. "|" separates
   * alternatives and a trailing "*" matches the start of a word. A merchant_exact
   * rule compares the whole name. Old rules may hold a /regex/ made of words only.
   */
  pattern: string;
  category: string;
  /** Lower runs first. User rules default to 10, built-in rules use 100+. */
  priority: number;
}
