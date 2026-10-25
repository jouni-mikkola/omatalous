/**
 * What the app asks of a place transactions come from. A connector owns its link flow and its settings; the
 * generic loop in sync.ts owns the lock, the run record, the overlap window, balances, reprocessing and the
 * register lookup, and calls the connector only for the data.
 */
import type { AccountType, RawTransaction } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import type { Services } from "../services/context.ts";

/**
 * The member's own request, as a function from the list of Psu-* headers a bank requires (null: the default pair) to the
 * headers to send, or null when the request cannot give all of them (psu.ts). Each bank has its own list.
 */
export type UserHeaders = (required: readonly string[] | null) => Readonly<Record<string, string>> | null;

export interface ConnectorContext {
  s: Services;
  repo: FinanceRepo;
  /**
   * The member's own request, set only when the member is present (a fetch the member started or the opening of the app).
   * A source that wants the headers passes them on as they are; they are never stored or logged.
   */
  userHeaders?: UserHeaders;
}

/** One account of an active connection, as the loop hands it to the connector. */
export interface PullAccount {
  id: string;
  /** The source's own id for the account. */
  externalId: string;
  name: string;
}

export interface PullWindow {
  /** First day to ask for: the latest stored row minus the overlap, or the history limit when `initial`. */
  dateFrom: string;
  /** The connector may ask for the longest history it can get: no row of this source is stored yet, or the user just gave a new consent. */
  initial: boolean;
  /**
   * Last day to ask for, for a backfill of the days before the rows already held. Such a request is one plain window; a
   * source may answer it from a later first day when the bank refuses the period (`asked` tells which).
   */
  dateTo?: string;
}

/**
 * What the loop does about a failed pull. A failure the connector does not recognise (`null`) is logged and
 * shown as a generic message.
 */
export type SyncProblem =
  /** The source refused the app's own key or id: the consents are fine, nothing to re-authorise. */
  | { kind: "app_rejected"; message: string }
  /** The consent ended: the loop marks the connection expired and asks the user to link again. */
  | { kind: "consent_expired" }
  /** The source does not let the app read this one account. The message says who fixes it and where. */
  | { kind: "not_linked"; message: string }
  /** The source answered with an error. The message is short and safe to show. */
  | { kind: "upstream"; message: string; /** The source says the app has fetched as often as it allows (bank-limit.ts). */ rateLimited?: boolean };

/**
 * What the bank says the account is, as sent and trimmed (migration 0023). `bankTypeCode` is "" when the bank sent no
 * code, which tells an account that was asked from one that was not (null on the stored account).
 */
export interface BankAccountFields {
  bankTypeCode: string;
  bankUsage: string | null;
  bankProduct: string | null;
  psuStatus: string | null;
}

/** What a source says about an account itself, as the link reads it. A field the source does not give is null. */
export interface AccountDetails extends BankAccountFields {
  /** The source's own name for the account; null when it names nothing. */
  name: string | null;
  holder: string | null;
  cardMask: string | null;
  creditLimitCents: number | null;
  /** The type the app works out from what the source sent, null when it sent nothing to tell it by. Stored unless the user chose the type. */
  type: AccountType | null;
  /** The type the source's rule before migration 0023 gave: a stored type that differs was set by hand. */
  earlierType: AccountType;
}

/** What a source says an account holds: the amount with the facts that say what it is a balance of. */
export interface BalanceReading {
  cents: number;
  /** The source's own code for the kind of balance ("CLBD", "ITBD", "OPBD" ...), as sent; null when it names none. */
  type: string | null;
  /** The day (YYYY-MM-DD) the source says the balance stands for; null when it sends none. Never guessed from the day of the fetch. */
  referenceDay: string | null;
  /** The currency code, upper case, as sent; null when the source names none. */
  currency: string | null;
}

/** Why a source's row could not be read: a status other than booked or pending, no readable amount, no readable date. */
export type RefusalReason = "status" | "amount" | "date";

/** The rows of one fetch that could not be read, by reason. A reason with no row is left out. */
export type RefusedRows = Partial<Record<RefusalReason, number>>;

/** One sync run's access to a source. Created once per run, after the loop knows there is something to fetch. */
export interface Puller {
  transactions(account: PullAccount, window: PullWindow): Promise<RawTransaction[]>;
  /**
   * The window the account's last `transactions` call was in fact answered for, which is shorter than the requested one
   * when the bank refused the period. Left out by a source that never shortens it.
   */
  asked?(account: PullAccount): { dateFrom: string; longest: boolean } | undefined;
  /** The rows of the account's last `transactions` call that could not be read; left out by a source that refuses none. */
  refused?(account: PullAccount): RefusedRows;
  /**
   * Every balance the source tells for the account, as it sent them. The first is the one to show (the source's best
   * pick); the loop stores that one on the account and records them all. Empty when the source reports none.
   */
  balance(account: PullAccount): Promise<BalanceReading[]>;
  /** What the source says about the account, for one linked before these fields were stored. May throw: the loop goes on. */
  details?(account: PullAccount): Promise<AccountDetails>;
  /**
   * True when the calls for this account carry the member's headers; a fetch the member started without them looks
   * unattended to the source and is counted so (bank-limit.ts). Left out: the account is fetched as the request is.
   */
  attended?(account: PullAccount): Promise<boolean>;
}

/** Only a connector that fetches by itself has this. */
export interface SyncSupport {
  /** May throw a UserError: the loop ends the run with its message. */
  open(c: ConnectorContext): Promise<Puller>;
  classify(err: unknown): SyncProblem | null;
}

export interface Connector {
  /** Stored in accounts.provider, connections.provider and transactions.source. Never renamed. */
  readonly id: string;
  readonly sync?: SyncSupport;
  /** Ends every active consent of a member who is being removed, best effort. */
  revokeAll?(s: Services, userId: string): Promise<{ revoked: number; failed: number }>;
}
