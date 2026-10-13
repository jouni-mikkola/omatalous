/**
 * What the app asks of a place transactions come from. A connector owns its link flow and its settings; the
 * generic loop in sync.ts owns the lock, the run record, the overlap window, balances, reprocessing and the
 * register lookup, and calls the connector only for the data.
 */
import type { RawTransaction } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import type { Services } from "../services/context.ts";

export interface ConnectorContext {
  s: Services;
  repo: FinanceRepo;
  /**
   * Headers of the member's own request, set only when the member is present (a fetch started by opening the app).
   * A source that wants them passes them on as they are; they are never stored or logged.
   */
  userHeaders?: Readonly<Record<string, string>>;
}

/** One account of an active connection, as the loop hands it to the connector. */
export interface PullAccount {
  id: string;
  /** The source's own id for the account. */
  externalId: string;
  name: string;
}

export interface PullWindow {
  /** First day to ask for: the latest stored row minus the overlap, or the history limit on a first fetch. */
  dateFrom: string;
  /** No row of this source is stored yet, so the connector may ask for the longest history it can get. */
  initial: boolean;
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

/** What a source says about an account itself, as the link reads it. A field the source does not give is null. */
export interface AccountDetails {
  /** The source's own name for the account; null when it names nothing. */
  name: string | null;
  holder: string | null;
  cardMask: string | null;
  creditLimitCents: number | null;
}

/** One sync run's access to a source. Created once per run, after the loop knows there is something to fetch. */
export interface Puller {
  transactions(account: PullAccount, window: PullWindow): Promise<RawTransaction[]>;
  /** The balance in cents, or null when the source reports none. */
  balance(account: PullAccount): Promise<number | null>;
  /** What the source says about the account, for one linked before these fields were stored. May throw: the loop goes on. */
  details?(account: PullAccount): Promise<AccountDetails>;
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
