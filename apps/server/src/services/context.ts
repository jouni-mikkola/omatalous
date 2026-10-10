/**
 * Everything a request handler or background job needs, created once per
 * process. Route modules receive this object; none of them construct
 * repositories or read configuration themselves.
 */
import { todayIn, type Config } from "../platform/config.ts";
import { FinanceRepo } from "../db/finance-repo.ts";
import { HouseholdRepo } from "../db/household-repo.ts";
import { IndustryRepo } from "../db/industry-repo.ts";
import { OpsRepo } from "../db/ops-repo.ts";
import { SecurityRepo } from "../db/security-repo.ts";
import { SettingsRepo } from "../db/settings-repo.ts";
import type { Db } from "../db/types.ts";
import { UsersRepo } from "../db/users-repo.ts";
import type { User } from "../db/rows.ts";
import { Gate, RateLimiter } from "../security/rate-limit.ts";
import { SecretBox } from "../security/secretbox.ts";
import { APP_VERSION } from "../version.ts";
import { AnalysisCache } from "./analysis.ts";
import { InstanceStore, type RedirectMode, redirectModeOf, redirectUrlFor } from "./instance.ts";

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
  /** Writes the day's database copy and returns its path. Only the Node entry knows where the database is. */
  backup?: (day: string) => string;
  /** Removes database copies past their retention; the hourly tick calls it. */
  pruneBackups?: (now: Date) => void;
  /** Folder of the database copies (<data>/backups); an admin can download the newest. */
  backupDir?: string;
}

export interface Services {
  readonly config: Config;
  readonly build: BuildInfo;
  readonly db: Db;
  readonly users: UsersRepo;
  readonly household: HouseholdRepo;
  readonly settings: SettingsRepo;
  /** Trade register answers per merchant name (services/industry.ts). */
  readonly industry: IndustryRepo;
  /** Address, time zone and sync times set in the browser (env = defaults). */
  readonly instance: InstanceStore;
  readonly analysis: AnalysisCache;
  /**
   * Failed logins per user name and per client address. Members of one
   * household often share an address, so the address limit is higher: one
   * member's typos must not lock the others out.
   */
  readonly loginLimiter: { readonly user: RateLimiter; readonly ip: RateLimiter };
  /** Wrong current passwords on password change, per user. */
  readonly passwordLimiter: RateLimiter;
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
  readonly backupDir?: string;
  readonly fetch?: typeof fetch;
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
}

export function createServices(deps: AppDeps): Services {
  const now = deps.now ?? (() => new Date());
  let box: Promise<SecretBox | null> | undefined;
  const settings = new SettingsRepo(deps.db);
  const instance = new InstanceStore(settings, deps.config.defaults);
  return {
    config: deps.config,
    build: deps.build ?? { version: APP_VERSION, id: APP_VERSION },
    db: deps.db,
    users: new UsersRepo(deps.db),
    household: new HouseholdRepo(deps.db),
    settings,
    industry: new IndustryRepo(deps.db),
    instance,
    analysis: new AnalysisCache(),
    // per 15 minutes: 10 failed logins per user name and address, 50 per address
    loginLimiter: { user: new RateLimiter(10, 15 * 60_000), ip: new RateLimiter(50, 15 * 60_000) },
    passwordLimiter: new RateLimiter(5, 15 * 60_000),
    setupLimiter: new RateLimiter(10, 15 * 60_000),
    hashGate: new Gate(4),
    security: new SecurityRepo(deps.db),
    ops: new OpsRepo(deps.db),
    opsLimiter: new RateLimiter(5, 15 * 60_000),
    opsDownloadLimiter: new RateLimiter(5, 3600_000),
    backupDir: deps.backupDir,
    fetch: deps.fetch,
    backup: deps.backup,
    pruneBackups: deps.pruneBackups,
    now,
    today: () => todayIn(instance.current.timezone, now()),
    redirectUrl: () => redirectUrlFor(instance.current, deps.config.bank.redirectUrl, deps.config.bank.relayUrl ?? undefined),
    redirectMode: () => redirectModeOf(instance.current),
    finance: (userId) => new FinanceRepo(deps.db, userId),
    secretBox: () => (box ??= deps.config.appSecret ? SecretBox.fromSecret(deps.config.appSecret) : Promise.resolve(null)),
  };
}

/** Hono typing for the per-request variables set by the auth middleware. */
export type AppEnv = {
  Variables: {
    user: User;
    sessionId: string;
  };
};
