/**
 * Configuration from environment variables and secret files (entry/node.ts).
 * Only infrastructure lives here; everything an admin can change in the
 * browser (address, time zone, sync times, the shared Enable Banking app) is
 * stored in the database and these values are its defaults, see
 * services/instance.ts.
 */
export interface EnableBankingConfig {
  appId: string;
  privateKeyPem: string;
}

/** Settings an admin changes in the browser; the environment only seeds them. */
export interface InstanceSettings {
  /** Address the app is opened at: bank redirect, cookies, CSRF origin. */
  appBaseUrl: string;
  timezone: string;
  /** Local hours (0–23) of the automatic fetch; PSD2 allows at most 4 a day. */
  syncHours: number[];
  /** Days of history to request on the first sync of an account. */
  historyDays: number;
  /** Look up unknown merchants' industry in the public trade register (services/industry.ts). */
  industryLookup: boolean;
}

export interface Config {
  defaults: InstanceSettings;
  /**
   * Encrypts the bank keys stored in the database. Lives in a file outside
   * the database (Docker: /secrets/app_secret, created on first start).
   */
  appSecret: string | null;
  sessionDays: number;
  /**
   * Session cookie name, per instance (`talous_<INSTANCE_NAME>`). Browsers share cookies between ports of
   * one host, so two instances on a machine need different names. Read from the environment so a
   * restored or cloned database cannot bring the collision back.
   */
  sessionCookie: string;
  /** Behind Caddy / Cloudflare Tunnel: trust X-Forwarded-For / -Proto. */
  trustProxy: boolean;
  /** One-time code for creating the first admin in the browser. */
  setupCode: string | null;
  /** PBKDF2 iterations; lower only for tests. */
  passwordIterations: number;
  /** Optional instance app from the environment (EB_APP_ID + EB_PRIVATE_KEY_FILE); one saved in the browser wins. */
  enableBanking: EnableBankingConfig | null;
  bank: {
    /** Overrides the redirect URL derived from the address (rarely needed). */
    redirectUrl: string | null;
    /** The static return page used for plain-http installs (EB_RELAY_URL); null means the project's own. */
    relayUrl: string | null;
    consentDays: number;
    /** Extra host names (with their subdomains) the bank's consent page may be on, on top of the built-in list (EB_AUTH_HOSTS). */
    authHosts: string[];
  };
}

type Env = Record<string, string | undefined>;

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** "6,18" → [6, 18]; invalid entries are ignored. */
function hours(value: string | undefined, fallback: number[]): number[] {
  if (!value?.trim()) return fallback;
  const list = value.split(",").map((h) => Number(h.trim()));
  const valid = [...new Set(list.filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b).slice(0, 4);
  return valid.length ? valid : fallback;
}

/** Shorter than 32 characters is too weak to derive an encryption key from: treated as missing. */
function validSecret(secret: string): string | null {
  if (!secret) return null;
  if (secret.length < 32) {
    console.warn("APP_SECRET on alle 32 merkkiä, joten sitä ei käytetä. Pankkiavaimia ei voi tallentaa ennen kuin se korjataan.");
    return null;
  }
  return secret;
}

/** Cookie names allow [a-z0-9_-] here; compose passes INSTANCE_NAME, existing installs have none and are "banking-app". */
function cookieName(instance: string | undefined): string {
  const name = (instance ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
  return `talous_${name || "banking-app"}`;
}

export function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, "\n").trim();
}

export function loadConfig(env: Env, files: { privateKeyPem?: string; appSecret?: string } = {}): Config {
  const pem = normalizePem(files.privateKeyPem ?? env.EB_PRIVATE_KEY ?? "");
  return {
    defaults: {
      // without an address the app is opened on this machine, at the port it listens on
      appBaseUrl: (env.APP_BASE_URL || `http://localhost:${int(env.PORT, 8080)}`).replace(/\/+$/, ""),
      timezone: env.TZ || "Europe/Helsinki",
      syncHours: hours(env.SYNC_HOURS, [6, 18]),
      historyDays: int(env.HISTORY_DAYS, 730),
      industryLookup: env.INDUSTRY_LOOKUP !== "false",
    },
    appSecret: validSecret((files.appSecret ?? env.APP_SECRET ?? "").trim()),
    sessionDays: int(env.SESSION_DAYS, 30),
    sessionCookie: cookieName(env.INSTANCE_NAME),
    trustProxy: env.TRUST_PROXY === "true" || env.TRUST_PROXY === "1",
    setupCode: env.SETUP_CODE?.trim() || null,
    passwordIterations: int(env.PASSWORD_ITERATIONS, 600_000),
    enableBanking: env.EB_APP_ID && pem ? { appId: env.EB_APP_ID, privateKeyPem: pem } : null,
    bank: {
      redirectUrl: env.EB_REDIRECT_URL?.trim() || null,
      relayUrl: /^https:\/\/[^\s]+$/.test(env.EB_RELAY_URL?.trim() ?? "") ? env.EB_RELAY_URL!.trim() : null,
      consentDays: int(env.EB_CONSENT_DAYS, 180),
      authHosts: (env.EB_AUTH_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9][a-z0-9.-]{1,100}$/.test(h)),
    },
  };
}

/** Today's date (YYYY-MM-DD) in the given time zone. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Local hour (0–23) in the given time zone. */
export function hourIn(timezone: string, now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
}
