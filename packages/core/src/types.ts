import type { LoanReference } from "./optimise/types.ts";

/** ISO date, YYYY-MM-DD. */
export type IsoDate = string;

/** loan: a mortgage or loan account; its own rows are bookkeeping, the payments from checking are the debt service. */
export const ACCOUNT_TYPES = ["checking", "savings", "credit_card", "loan", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Account {
  id: string;
  /** What the household sees: the user's own name for the account when they gave one. */
  name: string;
  /** The bank's own name for the account. A credit card is matched to its bills by this name, so renaming it changes nothing. */
  bankName?: string;
  /** The bank the account's connection was made with ("Nordea"), on an account that came through one. A card has no IBAN to tell it. */
  bank?: string | null;
  /** The holder or holders of the account as the bank gives them ("A, B"). Null: not read yet. "": read, and the bank gave none. */
  holder?: string | null;
  iban: string | null;
  currency: string;
  type: AccountType;
}

/**
 * How much of an account's every cent is one user's: the range `from`..`to` of the users' weights, which add up to
 * `of`. `partOf` works it out and `partCents` cuts an amount by it (account-use.ts). All of an account is 0, 1, 1
 * and none of it 0, 0, 1.
 */
export interface Part {
  from: number;
  to: number;
  of: number;
}

/** One user of an account. `userId` null: the holders who are no user of this instance, together. Only the ratio of the weights counts. */
export interface AccountUser {
  userId: string | null;
  /** What a member is shown: a display name, and for the user with no id the bank's holder names or "Muu tilinomistaja". */
  label: string;
  weight: number;
}

/**
 * Who of the household uses an account, in the order of the parts: by user id, the user with no id last.
 * said: the household said so. bank: the bank's holder names tell. owner: nothing tells, so whoever linked it.
 */
export interface AccountUse {
  users: AccountUser[];
  source: "said" | "bank" | "owner";
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
  /** The bank's own code for the kind of transaction, when it sends one: ISO 20022 domain, family and sub-family ("PMNT-CCRD-POSD"). */
  bankTxnCode?: string | null;
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
  /** The bank's own code for the kind of transaction, as on the raw row ("PMNT-CCRD-POSD"). The rules read it where no wording decides. */
  bankTxnCode?: string | null;
  /** The payment's reference number as the bank gave it: null or empty is a payment with none. A row built without the field (the kit, the demo) says nothing either way. */
  reference?: string | null;
  merchant: string;
  category: string;
  categorySource: CategorySource;
  isTransfer: boolean;
  /** The connector or import the row came from, when the caller has it. Layouts of one source differ, sources differ more. */
  source?: string;
  /**
   * The bank's amount, on a row cut to the viewer's part of a joint account: `amountCents` is the part then. Left out,
   * the row is whole. `applyUse` fills it, for the rows of a member's own view. Read it through `billCents`.
   */
  wholeCents?: number;
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
  /** The bank of the account's connection as the app shows it ("Nordea"). Null for an account shared with the viewer, as the account lists leave it out. */
  bank?: string | null;
  /** A card's last four digits as the bank gave them ("•••• 1234"). Never built from an account number. */
  cardMask?: string | null;
  /** The limit of a card or credit line as the bank gave it, in cents. */
  creditLimitCents?: number | null;
  /** Who uses the account: the server fills it with the balances of a view, in both views. Left out, nothing is known of its use. */
  use?: AccountUse;
  /** The viewer's part of the account, set in the own view only: the household view counts every account whole. Left out, the account counts whole. */
  part?: Part;
}

/** What the user said about a subscription or an alert: still in use, cancelled, or not to be shown again. */
export type MarkKind = "in_use" | "cancelled" | "dismissed";

/**
 * A mark on a subject: `series:<key>` for one subscription (`seriesMarkSubject`), `alert:<id>`, or `merchant:<name>`
 * for a mark stored before marks named a series, which covers every series of the merchant.
 */
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

/** What kind of debt a loan is. The user picks it and no figure depends on it. */
export const LOAN_KINDS = ["mortgage", "consumer", "car", "student", "credit_line", "card", "instalment", "other"] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];

/** A card or a credit line: drawn and paid as its holder likes, so it has a limit and no repayment plan. */
export const isRevolving = (kind: LoanKind): boolean => kind === "card" || kind === "credit_line";

/** The longest gap between two payments a loan can name, in months: a payment once a year. */
export const MAX_LOAN_INTERVAL_MONTHS = 12;

/**
 * How a loan is paid back. annuity and fixed_instalment: the payment holds the interest. equal_principal: the payment
 * is the amortisation and the interest comes on top. bullet: all of it on the last due date.
 */
export const LOAN_REPAYMENTS = ["annuity", "equal_principal", "fixed_instalment", "bullet"] as const;
export type LoanRepayment = (typeof LOAN_REPAYMENTS)[number];

/** The reference rates a loan can name: the ids the Optimoi `loan_rate` input offers. */
export const LOAN_REFERENCES = ["euribor_12", "euribor_6", "euribor_3", "fixed"] as const satisfies readonly LoanReference[];

/**
 * A loan the user typed in, pasted or read from a picture, and confirmed: the bank connection shows payment accounts
 * only. Money is what is owed, positive, in cents. Rates are hundredths of a percent (325 is 3,25 %). A field the
 * source did not give is null, and a figure that needs it is left untold (`loans.ts`).
 */
export interface Loan {
  id: string;
  /**
   * The display name of the member who typed the loan in, on a loan a view holds for another member (the server's
   * `loansInView`). Left out on the viewer's own, and never stored: a loan with it is not the viewer's to change.
   */
  typedBy?: string;
  /** What the user calls it. */
  name: string;
  /** Who lent. */
  lender: string | null;
  kind: LoanKind;
  /** The amount granted. */
  grantedCents: number | null;
  /** What is owed on `balanceDate`. */
  balanceCents: number;
  balanceDate: IsoDate;
  /** The whole rate a year, reference and margin together. */
  rateBp: number | null;
  reference: LoanReference | null;
  marginBp: number | null;
  repayment: LoanRepayment | null;
  /** Months between payments. */
  intervalMonths: number | null;
  /**
   * What is paid each interval. With annuity and fixed_instalment the whole payment, interest in it. With
   * equal_principal the amortisation alone: the interest comes on top and shrinks with the loan. A bullet has none.
   */
  paymentCents: number | null;
  /** The last due date: whatever is left falls due then. */
  endDate: IsoDate | null;
  /** The limit of a credit line or card. */
  limitCents: number | null;
  /** The debt series its payments belong to, null until linked. */
  seriesKey: string | null;
  /**
   * The connected card or loan account that is this same debt, once the household has said so. Left out or null means
   * none, so a loan built by hand still compiles and a loan without a link reads as it did before the field.
   */
  accountId?: string | null;
  /**
   * The day the bank sets the rate again, as the user typed it. Left out or null means none typed. No figure of the
   * loan depends on it, and a day that has passed is kept: the rate has been reviewed since.
   */
  rateReviewDate?: IsoDate | null;
}

/**
 * What the user typed in, next to the bank history: marks, expected bills and loans. The server reads them per request
 * and hands them to core, so they are not part of the cached analysis context and a change needs no data version bump.
 */
export interface UserInputs {
  marks: readonly UserMark[];
  expectedBills: readonly ExpectedBill[];
  /** Left out means none, so a caller that builds its inputs by hand still compiles. Read with `loansOf` (`loans.ts`). */
  loans?: readonly Loan[];
}

export const NO_INPUTS: UserInputs = { marks: [], expectedBills: [], loans: [] };
