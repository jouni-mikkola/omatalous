/** ISO date, YYYY-MM-DD. */
export type IsoDate = string;

/** loan: a mortgage or loan account; its own rows are bookkeeping, the payments from checking are the debt service. */
export type AccountType = "checking" | "savings" | "credit_card" | "loan" | "other";

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
 * same merchant's other rows, the trade register, nothing (default), or
 * transfer detection.
 */
export type CategorySource = "user" | "rule" | "mcc" | "merchant" | "industry" | "default" | "transfer";

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
