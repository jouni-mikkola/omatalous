/**
 * Instance settings an admin changes in the browser (first-run wizard and
 * Asetukset > Palvelin): the public address, time zone, sync times, history
 * depth and whether unknown merchants are looked up in the trade register. Stored as one JSON row in `settings`; the environment only
 * provides defaults, so a fresh container works before the wizard is done.
 *
 * Every value is checked against an allowlist before it is stored, and
 * again when it is read back. Nothing entered here is written to the
 * filesystem, put in a shell command or executed: the values are a URL
 * origin, an IANA time-zone name, small integers and a flag.
 */
import type { InstanceSettings } from "../config.ts";
import type { SettingsRepo } from "../db/settings-repo.ts";
import { UserError } from "./errors.ts";

/**
 * How Enable Banking sends the browser back after consent.
 *   own    an https address: the app's own callback is registered
 *   relay  plain http: the project's static return page forwards the browser to the local address
 *   paste  plain http: https://localhost is registered and the user pastes the address of the error page
 */
export type RedirectMode = "own" | "relay" | "paste";

export interface InstanceState extends InstanceSettings {
  /** False until an admin has finished (or skipped) the setup wizard. */
  setupDone: boolean;
  /** The admin's choice for plain-http installs. Null on installs from before the choice existed (they keep paste). */
  redirectMode: Exclude<RedirectMode, "own"> | null;
}

const KEY = "instance_settings";
/** Set when an upgrade turned the register lookup off for an existing install; admins see a one-time notice (services/security.ts). */
export const INDUSTRY_NOTICE_KEY = "notice_industry_lookup_off";

export const HISTORY_DAYS = { min: 30, max: 730 };
export const MAX_SYNCS_PER_DAY = 4;

// ── validation ───────────────────────────────────────────

const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*$`);

/** An http(s) origin only: no credentials, path, query or fragment. */
export function parseBaseUrl(value: unknown): string {
  const problem = new UserError("Anna osoite muodossa https://talous.oma.fi (ilman polkua).");
  if (typeof value !== "string" || value.length > 200 || /[\s\x00-\x1f\x7f\\]/.test(value)) throw problem;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw problem;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw problem;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw problem;
  if (!HOSTNAME.test(url.hostname) && !/^\[[0-9a-f:.]+\]$/.test(url.hostname)) throw problem;
  return url.origin;
}

/** An IANA zone name the runtime knows, e.g. Europe/Helsinki. */
export function parseTimezone(value: unknown): string {
  const problem = new UserError("Tuntematon aikavyöhyke.");
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+-]{0,30}(?:\/[A-Za-z0-9_+-]{1,30}){0,2}$/.test(value)) throw problem;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
  } catch {
    throw problem;
  }
  return value;
}

/** 0–4 distinct whole hours; an empty list means manual fetching only. */
export function parseSyncHours(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > MAX_SYNCS_PER_DAY || !value.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) {
    throw new UserError(`Valitse enintään ${MAX_SYNCS_PER_DAY} hakuaikaa.`);
  }
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

export function parseHistoryDays(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < HISTORY_DAYS.min || (value as number) > HISTORY_DAYS.max) {
    throw new UserError(`Historian pituus on ${HISTORY_DAYS.min}–${HISTORY_DAYS.max} päivää.`);
  }
  return value as number;
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new UserError("Arvon pitää olla päällä tai pois.");
  return value;
}

/**
 * A JSON object with only the listed keys. Unknown keys are refused rather
 * than ignored, so a typo or a probe never silently "succeeds".
 */
export function strictObject<K extends string>(value: unknown, allowed: readonly K[]): Partial<Record<K, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UserError("Pyynnön sisältö on väärän muotoinen.");
  for (const key of Object.keys(value)) {
    if (!(allowed as readonly string[]).includes(key)) throw new UserError(`Tuntematon kenttä: ${key.slice(0, 40)}`);
  }
  return value as Partial<Record<K, unknown>>;
}

const FIELDS = ["appBaseUrl", "timezone", "syncHours", "historyDays", "industryLookup"] as const;

/** Validates a partial update on top of the current values. */
export function parseSettingsUpdate(input: unknown, current: InstanceSettings): InstanceSettings {
  const o = strictObject(input, FIELDS);
  return {
    appBaseUrl: o.appBaseUrl === undefined ? current.appBaseUrl : parseBaseUrl(o.appBaseUrl),
    timezone: o.timezone === undefined ? current.timezone : parseTimezone(o.timezone),
    syncHours: o.syncHours === undefined ? current.syncHours : parseSyncHours(o.syncHours),
    historyDays: o.historyDays === undefined ? current.historyDays : parseHistoryDays(o.historyDays),
    industryLookup: o.industryLookup === undefined ? current.industryLookup : parseBoolean(o.industryLookup),
  };
}

/** Defaults come from the environment, which is trusted, but are checked the same way. */
function sanitizeDefaults(d: InstanceSettings): InstanceSettings {
  const safe = <T>(parse: () => T, fallback: T): T => {
    try {
      return parse();
    } catch {
      return fallback;
    }
  };
  return {
    appBaseUrl: safe(() => parseBaseUrl(d.appBaseUrl), "http://localhost:8080"),
    timezone: safe(() => parseTimezone(d.timezone), "Europe/Helsinki"),
    syncHours: safe(() => parseSyncHours(d.syncHours), [6, 18]),
    historyDays: safe(() => parseHistoryDays(d.historyDays), 730),
    industryLookup: d.industryLookup !== false,
  };
}

// ── store ────────────────────────────────────────────────

export class InstanceStore {
  private readonly defaults: InstanceSettings;
  private state: InstanceState;
  private loaded = false;

  constructor(
    private readonly settings: SettingsRepo,
    defaults: InstanceSettings,
  ) {
    this.defaults = sanitizeDefaults(defaults);
    this.state = { ...this.defaults, setupDone: false, redirectMode: null };
  }

  /** The last loaded or saved values; `load()` runs at the start of every API request. */
  get current(): InstanceState {
    return this.state;
  }

  /**
   * Reads the stored row on the first call. After that the values in memory
   * are current, because one process does every save through this store.
   * `force` reads the row again (the hourly tick does, in case it was edited by hand).
   */
  async load(force = false): Promise<InstanceState> {
    if (!force && this.loaded) return this.state;
    const raw = await this.settings.get(KEY);
    let stored: Partial<InstanceState> = {};
    try {
      stored = raw ? (JSON.parse(raw) as Partial<InstanceState>) : {};
    } catch {
      console.error("instance settings row is not valid JSON, using defaults");
    }
    let values: InstanceSettings;
    try {
      const { setupDone: _done, redirectMode: _mode, ...rest } = stored;
      values = parseSettingsUpdate(rest, this.defaults);
    } catch {
      // a row edited by hand into something invalid must not take the app down
      console.error("instance settings failed validation, using defaults");
      values = this.defaults;
    }
    // A row saved before the setting existed would silently inherit the default "on" and start sending
    // merchant names to the trade register after an update. Such an install gets "off" and the admin a notice.
    const legacy = !!raw && stored !== null && typeof stored === "object" && !Array.isArray(stored) && stored.industryLookup === undefined && values.industryLookup;
    if (legacy) values = { ...values, industryLookup: false };
    this.state = { ...values, setupDone: stored.setupDone === true, redirectMode: stored.redirectMode === "relay" || stored.redirectMode === "paste" ? stored.redirectMode : null };
    this.loaded = true;
    if (legacy) {
      await this.write(this.state);
      await this.settings.set(INDUSTRY_NOTICE_KEY, new Date().toISOString());
    }
    return this.state;
  }

  async save(input: unknown): Promise<InstanceState> {
    const current = await this.load(true);
    const next: InstanceState = { ...parseSettingsUpdate(input, current), setupDone: current.setupDone, redirectMode: current.redirectMode };
    return this.write(next);
  }

  /** Finishing the wizard fixes the return mode, so a new install does not turn into a "paste" install by finishing. */
  async completeSetup(): Promise<InstanceState> {
    const current = await this.load(true);
    return this.write({ ...current, setupDone: true, redirectMode: current.redirectMode ?? "relay" });
  }

  async setRedirectMode(mode: unknown): Promise<InstanceState> {
    if (mode !== "relay" && mode !== "paste") throw new UserError("Tuntematon paluutapa.");
    return this.write({ ...(await this.load(true)), redirectMode: mode });
  }

  private async write(next: InstanceState): Promise<InstanceState> {
    await this.settings.set(KEY, JSON.stringify(next));
    this.state = next;
    this.loaded = true;
    return next;
  }
}

/** The return mode in effect: an https address always uses its own callback. */
export function redirectModeOf(state: Pick<InstanceState, "appBaseUrl" | "setupDone" | "redirectMode">): RedirectMode {
  if (state.appBaseUrl.startsWith("https://")) return "own";
  // an install that finished setup before the return page existed keeps pasting until an admin switches
  return state.redirectMode ?? (state.setupDone ? "paste" : "relay");
}

/** The return page the project publishes; EB_RELAY_URL points a self-hosted copy of it elsewhere. */
export const DEFAULT_RELAY_URL = "https://jouni-mikkola.github.io/omatalous/callback/";

/** Where Enable Banking sends the browser back after consent. Production requires https. EB_REDIRECT_URL wins. */
export function redirectUrlFor(
  state: Pick<InstanceState, "appBaseUrl" | "setupDone" | "redirectMode">,
  override: string | null,
  relayUrl: string = DEFAULT_RELAY_URL,
): string {
  if (override) return override;
  switch (redirectModeOf(state)) {
    case "own":
      return `${state.appBaseUrl}/api/connections/callback`;
    case "relay":
      return relayUrl;
    default:
      // https://localhost cannot be reached: the bank's redirect fails and the user pastes the address of that page
      return "https://localhost/api/connections/callback";
  }
}

/** Whether the hourly scheduler tick at local `hour` should fetch. */
export function isSyncHour(state: Pick<InstanceSettings, "syncHours">, hour: number): boolean {
  return state.syncHours.includes(hour);
}
