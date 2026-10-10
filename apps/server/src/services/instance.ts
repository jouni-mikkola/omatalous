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
 *
 * The same row holds the admin's feature flag overrides (`features`, ids from core's FEATURES, on or off).
 */
import { FEATURE_IDS, type FeatureId, type FeatureOverrides, type FeatureState, resolveFeatures } from "@banking/core";
import type { InstanceSettings } from "../platform/config.ts";
import type { SettingsRepo } from "../db/settings-repo.ts";
import { UserError } from "../platform/errors.ts";
import { parseBaseUrl, parseBoolean, parseHistoryDays, parseSyncHours, parseTimezone, strictObject } from "../platform/validate.ts";

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

/** A partial map of flag ids to on or off: an id that is not in FEATURES is refused, and so is any other value. */
export function parseFeatureOverrides(input: unknown): FeatureOverrides {
  const o = strictObject(input, FEATURE_IDS);
  const out: Partial<Record<FeatureId, boolean>> = {};
  for (const id of FEATURE_IDS) if (o[id] !== undefined) out[id] = parseBoolean(o[id]);
  return out;
}

/** The stored overrides. A flag that no longer exists or holds another type is dropped: an old row must not stop a start. */
function storedOverrides(raw: unknown): FeatureOverrides {
  const out: Partial<Record<FeatureId, boolean>> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const id of FEATURE_IDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (typeof v === "boolean") out[id] = v;
  }
  return out;
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
  private overrides: FeatureOverrides = {};
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
    let stored: Partial<InstanceState> & { features?: unknown } = {};
    try {
      stored = raw ? (JSON.parse(raw) as Partial<InstanceState> & { features?: unknown }) : {};
    } catch {
      console.error("instance settings row is not valid JSON, using defaults");
    }
    let values: InstanceSettings;
    try {
      const { setupDone: _done, redirectMode: _mode, features: _features, ...rest } = stored;
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
    this.overrides = storedOverrides(stored?.features);
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

  /** Every flag with the admin's choice where there is one, else its default. */
  features(): FeatureState {
    return resolveFeatures(this.overrides);
  }

  enabled(id: FeatureId): boolean {
    return this.features()[id];
  }

  /** Switches the named flags and leaves the others as they are. */
  async setFeatures(input: unknown): Promise<FeatureState> {
    const patch = parseFeatureOverrides(input);
    const current = await this.load(true);
    // memory follows the database: a failed write leaves the flags as they were
    await this.write(current, { ...this.overrides, ...patch });
    return this.features();
  }

  private async write(next: InstanceState, overrides = this.overrides): Promise<InstanceState> {
    await this.settings.set(KEY, JSON.stringify(Object.keys(overrides).length ? { ...next, features: overrides } : next));
    this.overrides = overrides;
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
