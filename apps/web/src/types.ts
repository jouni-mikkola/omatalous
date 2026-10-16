/** Shapes of the server's JSON responses. Domain types come from @banking/core. */
import type { AccountType, AccountUse, ReconcileResult, Category, CategoryRule, DashboardData, FeatureState, LoanProposal, Part, RecurringSeries, ReportsData, Transaction } from "@banking/core";

export type { AccountType, Category, CategoryRule, DashboardData, RecurringSeries, ReportsData };

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  mustChangePassword: boolean;
  createdAt: string;
}

export interface Account {
  id: string;
  userId: string;
  /** What the household sees: the user's own name when there is one, else the bank's. */
  name: string;
  /** The bank's own name for the account (its product name when it gives one). */
  bankName: string;
  /** The name the user gave in Asetukset > Tilit; a link or a sync never replaces it. */
  customName: string | null;
  /** Who holds the account, as the bank gives it ("A, B"). */
  holder: string | null;
  /** A card's last four digits ("•••• 1234"). */
  cardMask: string | null;
  creditLimitCents: number | null;
  iban: string | null;
  currency: string;
  type: AccountType;
  provider: string;
  connectionId: string | null;
  balanceCents: number | null;
  balanceAt: string | null;
  lastSyncedAt: string | null;
  /** What the last fetch of the user's own account ran into; a shared account has none. */
  problem?: { kind: "not_linked" | "failed"; message: string } | null;
  /** Who uses the account. /api/meta always tells it; a page reads a missing one as nothing to say. */
  use?: AccountUse;
  /** The viewer's part of it (their own accounts and those shared with them). */
  part?: Part;
  /** The account is cut by who paid it: it has a money trace (a joint account with a split row). */
  traced?: boolean;
  /** Who set the split by who paid, and when. */
  split?: { by: "app" | "user"; at: string };
  /** Only to the member who linked the account: the payers and the opening whose owner is not told, largest first. */
  questions?: AccountQuestion[];
  /** The answers given, with the label of what they answer. */
  answers?: AccountAnswer[];
  /** Whether the bank's balances are the sum of the rows; null for a card, a loan and another currency. */
  reconcile?: ReconcileResult | null;
  /** The split of the payments to the account when it differs from the weights, in whole percents. */
  offer?: { userId: string | null; percent: number }[];
}

/** A payer of a joint account, or its opening, that nobody has said whose money was. `label` of the opening is its day. */
export interface AccountQuestion {
  kind: "in" | "opening";
  key: string;
  label: string;
  openCents: number;
}

/** An answer: `owner` is `u:<id>` (`u:` for the holders who are no member), `all` or `none`. */
export interface AccountAnswer {
  kind: "in" | "opening";
  key: string;
  label: string;
  owner: string;
}

export interface SharedAccount extends Account {
  ownerName: string;
}

export interface Connection {
  id: string;
  institution: string;
  status: "active" | "expired" | "revoked";
  /** active, lapsed (its date passed), broken (closed before its date), removed (services/accounts.ts) */
  state: "active" | "lapsed" | "broken" | "removed";
  /** Owns no account: the settings do not list it and it has no notice. */
  history: boolean;
  /** Not active, and a newer consent of the same bank is: its accounts did not come with the new consent. */
  replaced: boolean;
  validUntil: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
  /** Days to the end date of an active consent, else null. */
  daysLeft: number | null;
  /** The bank's consent ended (lapsed or broken): Yhdistä uudelleen starts a new one. */
  needsRenewal: boolean;
}

/** What the app has seen of one bank (GET /api/admin/bank-app/capabilities). */
export interface BankCapability {
  bankId: string;
  consentDays: number | null;
  requiredPsuHeaders: string[] | null;
  psuTypes: string[] | null;
  cardAccounts: boolean;
  pending: boolean;
  balanceTypes: string[];
  historyDays: number | null;
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

export interface Meta {
  today: string;
  user: User;
  categories: Category[];
  kinds: Record<string, string>;
  accounts: Account[];
  sharedAccounts: SharedAccount[];
  members: { id: string; displayName: string }[];
  shares: { accountId: string; userId: string }[];
  connections: Connection[];
  lastSync: SyncRun | null;
  bank: {
    /** A bank can be connected: an app is set up and the household's app is not known to be inactive. */
    configured: boolean;
    /** The household's app is set up but its last test found it not active yet (no member key of one's own). */
    inactive?: boolean;
    source: "user" | "instance" | null;
    /** Banks the server offers: its registry, narrowed to what the household's Enable Banking application lists. */
    banks: BankOption[];
    redirectUrl: string;
    /** The pages beside the return page that Enable Banking's registration form asks for. */
    privacyUrl: string;
    termsUrl: string;
    /** own: https callback; relay: the project return page; paste: the user pastes the address of the error page. */
    redirectMode: "own" | "relay" | "paste";
    canStoreOwnKeys: boolean;
  };
  sync: { hours: number[] };
  /** Server release; `build` changes with every upgrade. */
  version: { app: string; build: string };
  /** False until an admin has finished or skipped the setup wizard. */
  setupDone: boolean;
  /** Every feature flag, resolved: the nav hides the entry of a module that is off. */
  features: FeatureState;
}

export interface BankOption {
  id: string;
  name: string;
  country: string;
  /** The server serves this bank's logo at /api/bank/logos/<id>. Only `bankLogo` (banks.ts) builds that address. */
  logo?: boolean;
}

// ── instance setup (admin) ──

export interface InstanceSettings {
  appBaseUrl: string;
  timezone: string;
  syncHours: number[];
  historyDays: number;
  industryLookup: boolean;
  setupDone: boolean;
}

export interface BankAppStatus {
  source: "web" | "env" | null;
  appId: string | null;
  savedAt: string | null;
  pendingSince: string | null;
  hasCertificate: boolean;
  canStoreKeys: boolean;
  redirectUrl: string;
  redirectMode: "own" | "relay" | "paste";
  relayUrl: string;
  privacyUrl: string;
  termsUrl: string;
  /** The sentence to show while the last test found the application not active yet; null otherwise. */
  inactiveMessage: string | null;
}

export interface InstanceState {
  settings: InstanceSettings;
  /** Every feature flag, resolved. */
  features: FeatureState;
  bankApp: BankAppStatus;
  secret: { available: boolean };
  /** Outcome of the Enable Banking test after saving or "Testaa yhteys". */
  result?: { verified: boolean; message: string };
}

export interface TransactionItem extends Transaction {
  valueDate: string | null;
  reference: string | null;
  source: string;
  /** false for rows of an account another member shared (read-only). */
  own: boolean;
  /** The trade register entry the category came from (categorySource "industry"). */
  industry?: { companyName: string | null; businessId: string | null; label: string | null };
}

export type Recurring = Omit<RecurringSeries, "transactionIds">;

/** What `GET /api/loans/proposals` tells of a proposed loan: no row ids, account or payment reference. */
export type LoanProposalRow = Pick<LoanProposal, "key" | "payee" | "paymentCents" | "months" | "firstDate" | "lastDate" | "kind">;

/** own = my accounts; household = mine + accounts shared with me. */
export type Scope = "own" | "household";
