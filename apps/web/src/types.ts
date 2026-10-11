/** Shapes of the server's JSON responses. Domain types come from @banking/core. */
import type { AccountType, Category, CategoryRule, DashboardData, FeatureState, RecurringSeries, ReportsData, Transaction } from "@banking/core";

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
  /** Owns no account: it folds under "Aiemmat yhteydet" and has no notice. */
  history: boolean;
  /** Not active, and a newer consent of the same bank is: its accounts did not come with the new consent. */
  replaced: boolean;
  validUntil: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
  /** Days to the end date of an active consent, else null. */
  daysLeft: number | null;
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
    /** Banks that can be connected (server registry); only Nordea for now. */
    banks: BankOption[];
    redirectUrl: string;
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

/** own = my accounts; household = mine + accounts shared with me. */
export type Scope = "own" | "household";
