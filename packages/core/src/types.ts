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

/** An account and the balance it was last given, as the balance and buffer reports and the overview read it. */
export interface BalanceInput {
  id: string;
  name: string;
  type: AccountType;
  balanceCents: number | null;
  /** The owner's name when the account is shared with the viewer, null for the viewer's own. */
  ownerName: string | null;
  /** The local day the balance was given (YYYY-MM-DD, in the app's time zone), null when unknown. */
  balanceAt: string | null;
  /** A joint account both partners linked: the household view keeps it once and never splits it to a person. */
  joint?: boolean;
}

/** What the user said about a subscription or an alert: still in use, cancelled, or not to be shown again. */
export type MarkKind = "in_use" | "cancelled" | "dismissed";

/** A mark on a subject: `merchant:<name>` or `alert:<id>`. */
export interface UserMark {
  subject: string;
  mark: MarkKind;
  /** ISO timestamp. */
  markedAt: string;
}

/** How often a bill the user typed in comes back. */
export type ExpectedCadence = "once" | "quarterly" | "semiannual" | "yearly";

/** A bill the user typed in because the bank history cannot know it yet (insurance, tax, a service). */
export interface ExpectedBill {
  id: string;
  name: string;
  /** What it costs, positive. */
  amountCents: number;
  /** The first due date; later ones follow the cadence. */
  dueDate: IsoDate;
  cadence: ExpectedCadence;
  /** A category id, or null when the user gave none. */
  category: string | null;
}

/**
 * What the user typed in, next to the bank history: marks and expected bills. The server reads them per request and
 * hands them to core, so they are not part of the cached analysis context and a change needs no data version bump.
 */
export interface UserInputs {
  marks: readonly UserMark[];
  expectedBills: readonly ExpectedBill[];
}

export const NO_INPUTS: UserInputs = { marks: [], expectedBills: [] };
