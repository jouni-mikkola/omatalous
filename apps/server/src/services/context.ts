/**
 * Everything a request handler or background job needs, created once per
 * process. Route modules receive this object; none of them construct
 * repositories or read configuration themselves.
 */
import { todayIn, type Config } from "../platform/config.ts";
import { FactorRepo } from "../db/factor-repo.ts";
import { FinanceRepo } from "../db/finance-repo.ts";
import { AgreementRepo } from "../db/agreement-repo.ts";
import { HouseholdRepo } from "../db/household-repo.ts";
import { IndustryRepo } from "../db/industry-repo.ts";
import { OpsRepo } from "../db/ops-repo.ts";
import { SecurityRepo } from "../db/security-repo.ts";
import { SettingsRepo } from "../db/settings-repo.ts";
import type { Db } from "../db/types.ts";
import { UsersRepo } from "../db/users-repo.ts";
import type { User } from "../db/rows.ts";
import { Gate, LoginLimiter, RateLimiter, RememberedAddresses } from "../security/rate-limit.ts";
import { SecretBox } from "../security/secretbox.ts";
import { ShortLived } from "../security/short-lived.ts";
import { APP_VERSION } from "../version.ts";
import { AnalysisCache } from "./analysis.ts";
import { afterReprocess, reprocessClock } from "./enrich.ts";
import { InstanceStore, type RedirectMode, redirectModeOf, redirectUrlFor } from "./instance.ts";
import { syncStatementState } from "./statements.ts";

/** How long a password-right sign-in waits for its second factor. */
const HALF_SESSION_MS = 5 * 60_000;

export interface BuildInfo {
  /** Release version shown to people (src/version.ts). */
  version: string;
  /** Changes whenever the code changes; triggers the post-upgrade tasks (services/upgrade.ts). */
  id: string;
}

export interface AppDeps {
  db: Db;
  config: Config;
  build?: BuildInfo;
  /** Injected in tests to fake Enable Banking and the trade register. */
  fetch?: typeof fetch;
  now?: () => Date;
  /** The wait between two calls a background run spaces out; tests make it nothing. */
  pause?: (ms: number) => Promise<void>;
  /** Writes the day's database copy and returns its path. Only the Node entry knows where the database is. */
  backup?: (day: string) => string;
  /** Removes database copies past their retention; the hourly tick calls it. */
  pruneBackups?: (now: Date) => void;
  /** Folder of the database copies (<data>/backups); an admin can download the newest. */
  backupDir?: string;
  /** True when the secret file no longer holds the secret this process runs with (a `secret rotate` waits for its restart). Only the Node entry knows the file. */
  secretStale?: () => boolean;
}

export interface Services {
  readonly config: Config;
  readonly build: BuildInfo;
  readonly db: Db;
  readonly users: UsersRepo;
  readonly household: HouseholdRepo;
  /** Dated agreements and the household members who have no login (settlement between partners). */
  readonly agreements: AgreementRepo;
  readonly settings: SettingsRepo;
  /** Trade register answers per merchant name (services/industry.ts). */
  readonly industry: IndustryRepo;
  /** Address, time zone and sync times set in the browser (env = defaults). */
  readonly instance: InstanceStore;
  readonly analysis: AnalysisCache;
  /**
   * Failed logins per client address (`ip`), per user name from one address (`user`) and per user name from all
   * addresses (`name`). Members of one household often share an address, so the address limit is higher: one
   * member's typos must not lock the others out. `name` is there so that more addresses buy no more guesses at
   * one name, and one address alone (10 per name) cannot reach it. `remembered` holds the addresses a login
   * succeeded from: the three limiters count those in a spare when they are full (security/rate-limit.ts).
   */
  readonly loginLimiter: {
    readonly ip: LoginLimiter;
    readonly user: LoginLimiter;
    readonly name: LoginLimiter;
    readonly remembered: RememberedAddresses;
  };
  /** Wrong current passwords on password change, per user. */
  readonly passwordLimiter: RateLimiter;
  /** Second-factor secrets and recovery codes (services/second-factor.ts). */
  readonly factors: FactorRepo;
  /** Codes typed for the second factor: `user` per address and user (5 in 15 minutes), `name` per user from all addresses (15). */
  readonly factorLimiter: { readonly user: RateLimiter; readonly name: RateLimiter };
  /** A secret made for an enrolment and not yet confirmed with a code, by user id; ten minutes. */
  readonly factorEnrolments: ShortLived<string>;
  /**
   * A sign-in with the password right that waits for the second factor, by the hash of its cookie token to the user and the
   * password hash it was made with (a changed or reset password ends it); five minutes (auth/session.ts).
   */
  readonly halfSessions: ShortLived<{ userId: string; passwordHash: string }>;
  /** First-run setup attempts per client address. */
  readonly setupLimiter: RateLimiter;
  /** Caps password hashes running at once, so unauthenticated requests cannot fill the thread pool. */
  readonly hashGate: Gate;
  readonly security: SecurityRepo;
  /** Maintenance requests for the host helper (services/ops.ts). */
  readonly ops: OpsRepo;
  /** Wrong passwords on maintenance requests, per admin. */
  readonly opsLimiter: RateLimiter;
  /** Backup downloads per admin and hour. */
  readonly opsDownloadLimiter: RateLimiter;
  /**
   * Tests of an Enable Banking key: eight in ten minutes per user for a member's own key (countKeyTest), and eight in
   * ten minutes for the whole instance for an application id (checkAppId), both in connectors/enable-banking/app-setup.ts.
   */
  readonly keyTestLimiter: RateLimiter;
  readonly backupDir?: string;
  readonly fetch?: typeof fetch;
  pause(ms: number): Promise<void>;
  readonly backup?: (day: string) => string;
  readonly pruneBackups?: (now: Date) => void;
  now(): Date;
  /** Today in the instance time zone. */
  today(): string;
  /** Where the bank redirects after consent. */
  redirectUrl(): string;
  redirectMode(): RedirectMode;
  /** Data access scoped to one user. The only way to reach financial rows. */
  finance(userId: string): FinanceRepo;
  /** Null when no app secret is available (Docker creates one on first start). */
  secretBox(): Promise<SecretBox | null>;
  /** See AppDeps.secretStale. */
  secretStale(): boolean;
}

export function createServices(deps: AppDeps): Services {
  const now = deps.now ?? (() => new Date());
  let box: Promise<SecretBox | null> | undefined;
  const settings = new SettingsRepo(deps.db);
  const instance = new InstanceStore(settings, deps.config.defaults);
  const services: Services = {
    config: deps.config,
    build: deps.build ?? { version: APP_VERSION, id: APP_VERSION },
    db: deps.db,
    users: new UsersRepo(deps.db),
    household: new HouseholdRepo(deps.db),
    agreements: new AgreementRepo(deps.db),
    settings,
    industry: new IndustryRepo(deps.db),
    instance,
    analysis: new AnalysisCache(),
    // per 15 minutes: 50 failed logins per address, 10 per user name and address, 30 per user name from all
    // addresses. Each keeps 10 000 keys and a spare of 1 000 for the 100 addresses remembered for 30 days.
    loginLimiter: {
      ip: new LoginLimiter(50, 15 * 60_000),
      user: new LoginLimiter(10, 15 * 60_000),
      name: new LoginLimiter(30, 15 * 60_000),
      remembered: new RememberedAddresses(),
    },
    passwordLimiter: new RateLimiter(5, 15 * 60_000),
    factors: new FactorRepo(deps.db),
    factorLimiter: { user: new RateLimiter(5, 15 * 60_000), name: new RateLimiter(15, 15 * 60_000) },
    factorEnrolments: new ShortLived(10 * 60_000),
    halfSessions: new ShortLived(HALF_SESSION_MS),
    setupLimiter: new RateLimiter(10, 15 * 60_000),
    hashGate: new Gate(4),
    security: new SecurityRepo(deps.db),
    ops: new OpsRepo(deps.db),
    opsLimiter: new RateLimiter(5, 15 * 60_000),
    opsDownloadLimiter: new RateLimiter(5, 3600_000),
    keyTestLimiter: new RateLimiter(8, 10 * 60_000),
    backupDir: deps.backupDir,
    fetch: deps.fetch,
    pause: deps.pause ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    backup: deps.backup,
    pruneBackups: deps.pruneBackups,
    now,
    today: () => todayIn(instance.current.timezone, now()),
    redirectUrl: () => redirectUrlFor(instance.current, deps.config.bank.redirectUrl, deps.config.bank.relayUrl ?? undefined),
    redirectMode: () => redirectModeOf(instance.current),
    finance: (userId) => new FinanceRepo(deps.db, userId),
    secretStale: deps.secretStale ?? (() => false),
    secretBox: () => (box ??=deps.config.appSecret ? SecretBox.fromSecret(deps.config.appSecret) : Promise.resolve(null)),
  };
  // card statements set aside or read again once the rows they depend on have changed
  afterReprocess(settings, (userId, held) => syncStatementState(services, userId, held));
  reprocessClock(settings, () => services.today());
  return services;
}

/** Hono typing for the per-request variables set by the auth middleware. */
export type AppEnv = {
  Variables: {
    user: User;
    sessionId: string;
  };
};
