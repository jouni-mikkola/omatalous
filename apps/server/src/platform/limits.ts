/**
 * The one schema of the numeric limits the server keeps: sign-in limits, request size, password parameters and the
 * age limits of fetching. A field is a key, a type, a default, a min, a max and whether a change needs a restart.
 * A value comes in layers: this default, then the environment (`env`, trusted, seeds the default), then the
 * database (set by an admin, services/limits.ts). Every layer is checked against the same min and max, except that
 * the environment may go down to `envMin`, which lets the tests run a password hash in a millisecond.
 *
 * The Argon2id cost of a new password hash is two fields, memory and passes (one lane, fixed in
 * security/password.ts). Memory is held per running hash, so `hashSlots` times `passwordMemoryKib` is what a burst of
 * sign-ins takes: 4 slots of 19 MiB are 76 MiB of the 512 MiB the container is given,
 * and `hashMemoryProblem` refuses a pair of values that would hold more than 128 MiB.
 *
 * Decision: the admin decides how many wrong tries, how large a request and how heavy a password hash the install
 * allows, and every default is the value the code had before the schema.
 */
import { UserError } from "./errors.ts";

export interface LimitField {
  key: string;
  type: "int";
  default: number;
  min: number;
  max: number;
  /** The lowest value the environment may seed. Absent means `min`. */
  envMin?: number;
  /** True when a change is read only at the start. */
  restart: boolean;
  /** Where the value lives when it is not one of the limits rows: the instance row keeps the history depth. */
  home?: "instance";
  env: string;
  /** Finnish name for the settings page. */
  label: string;
}

// generic so that the keys stay literal types: LimitKey below is the union of them
const field = <K extends string>(f: Omit<LimitField, "type" | "restart" | "key"> & { key: K; restart?: boolean }): LimitField & { key: K } => ({ type: "int", restart: false, ...f });

export const LIMIT_SCHEMA = [
  field({ key: "loginIp", default: 50, min: 1, max: 10_000, env: "LOGIN_IP_LIMIT", label: "Kirjautumisyrityksiä osoitteesta" }),
  field({ key: "loginUser", default: 10, min: 1, max: 10_000, env: "LOGIN_USER_LIMIT", label: "Kirjautumisyrityksiä tunnukselle osoitteesta" }),
  field({ key: "loginName", default: 30, min: 1, max: 10_000, env: "LOGIN_NAME_LIMIT", label: "Kirjautumisyrityksiä tunnukselle kaikista osoitteista" }),
  field({ key: "authWindowMinutes", default: 15, min: 1, max: 1440, env: "AUTH_WINDOW_MINUTES", label: "Yritysten jakso (min)" }),
  field({ key: "accessFailures", default: 10, min: 1, max: 1000, env: "ACCESS_FAILURE_LIMIT", label: "Cloudflare Access -tarkistuksen virheitä osoitteesta" }),
  field({ key: "passwordChange", default: 5, min: 1, max: 1000, env: "PASSWORD_CHANGE_LIMIT", label: "Väärää salasanaa salasanan vaihdossa" }),
  field({ key: "factorUser", default: 5, min: 1, max: 1000, env: "FACTOR_USER_LIMIT", label: "Kaksivaiheisen koodin yrityksiä osoitteesta" }),
  field({ key: "factorName", default: 15, min: 1, max: 1000, env: "FACTOR_NAME_LIMIT", label: "Kaksivaiheisen koodin yrityksiä kaikista osoitteista" }),
  field({ key: "setup", default: 10, min: 1, max: 1000, env: "SETUP_LIMIT", label: "Käyttöönoton yrityksiä osoitteesta" }),
  field({ key: "serviceToken", default: 20, min: 1, max: 10_000, env: "SERVICE_TOKEN_LIMIT", label: "Tuntemattomia palvelutunnuksia osoitteesta" }),
  field({ key: "ops", default: 5, min: 1, max: 1000, env: "OPS_LIMIT", label: "Väärää salasanaa ylläpitopyynnössä" }),
  field({ key: "opsDownload", default: 5, min: 1, max: 1000, env: "OPS_DOWNLOAD_LIMIT", label: "Varmuuskopion latauksia jaksossa" }),
  field({ key: "opsDownloadWindowMinutes", default: 60, min: 1, max: 1440, env: "OPS_DOWNLOAD_WINDOW_MINUTES", label: "Latausten jakso (min)" }),
  field({ key: "keyTest", default: 8, min: 1, max: 1000, env: "KEY_TEST_LIMIT", label: "Pankkiavaimen testejä jaksossa" }),
  field({ key: "keyTestWindowMinutes", default: 10, min: 1, max: 1440, env: "KEY_TEST_WINDOW_MINUTES", label: "Avaintestien jakso (min)" }),
  field({ key: "requestKb", default: 256, min: 16, max: 4096, env: "REQUEST_MAX_KB", label: "Pyynnön enimmäiskoko (kt)" }),
  field({ key: "hashSlots", default: 4, min: 1, max: 64, env: "HASH_SLOTS", label: "Salasanatiivisteitä yhtä aikaa" }),
  // OWASP's minimum for Argon2id: 19 MiB, 2 passes, 1 lane. The cap keeps hashSlots times memory inside a small server, also for a hash made before the memory was lowered.
  field({ key: "passwordMemoryKib", default: 19_456, min: 19_456, max: 32_768, envMin: 8, env: "PASSWORD_MEMORY_KIB", label: "Salasanatiivisteen muisti (kt)" }),
  field({ key: "passwordPasses", default: 2, min: 2, max: 10, envMin: 1, env: "PASSWORD_PASSES", label: "Salasanatiivisteen kierrokset" }),
  field({ key: "consentDays", default: 180, min: 1, max: 365, env: "EB_CONSENT_DAYS", label: "Pankin suostumuksen pituus (pv)" }),
  field({ key: "historyDays", default: 730, min: 30, max: 730, env: "HISTORY_DAYS", home: "instance", label: "Haettavan historian pituus (pv)" }),
] as const;

type LimitKey = (typeof LIMIT_SCHEMA)[number]["key"];
/** The keys the limits row holds (the history depth stays in the instance row). */
export type StoredLimitKey = Exclude<LimitKey, "historyDays">;
export type LimitValues = Record<StoredLimitKey, number>;

/** The fields the limits row holds. */
export const limitField = (key: LimitKey): LimitField => LIMIT_SCHEMA.find((f) => f.key === key)!;

function defaultLimits(schema: readonly LimitField[] = LIMIT_SCHEMA): Record<string, number> {
  return Object.fromEntries(schema.map((f) => [f.key, f.default]));
}

/** A value of the field, or a 400. */
export function parseLimit(f: LimitField, value: unknown, min = f.min): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > f.max) {
    throw new UserError(`${f.label}: anna kokonaisluku ${min}–${f.max}.`);
  }
  return value as number;
}

/** What running password hashes may hold at once: a quarter of the 512 MiB the container is given, in KiB. */
const HASH_MEMORY_BUDGET_KIB = 131_072;

/** The words for a set of limits whose slots times hash memory goes over the budget, or null when it fits. */
export function hashMemoryProblem(v: { hashSlots?: number; passwordMemoryKib?: number }): string | null {
  const slots = v.hashSlots ?? 0;
  const memory = v.passwordMemoryKib ?? 0;
  return slots * memory <= HASH_MEMORY_BUDGET_KIB ? null : `Salasanatiivisteitä yhtä aikaa (${slots}) kertaa tiivisteen muisti (${memory} kt) saa olla enintään ${HASH_MEMORY_BUDGET_KIB / 1024} Mt.`;
}

/**
 * The defaults with the environment laid over them. A value that is no integer or lies outside the schema is
 * dropped with a warning, so a typo in `.env` cannot start the server with an unsafe limit.
 */
export function envLimits(env: Record<string, string | undefined>, schema: readonly LimitField[] = LIMIT_SCHEMA): Record<string, number> {
  const out = defaultLimits(schema);
  for (const f of schema) {
    const text = env[f.env]?.trim();
    if (!text) continue;
    try {
      out[f.key] = parseLimit(f, /^\d{1,9}$/.test(text) ? Number(text) : Number.NaN, f.envMin ?? f.min);
    } catch {
      console.warn(`${f.env} must be a whole number from ${f.envMin ?? f.min} to ${f.max}; the default ${f.default} is used.`);
    }
  }
  if (hashMemoryProblem(out)) {
    console.warn(`HASH_SLOTS times PASSWORD_MEMORY_KIB goes over ${HASH_MEMORY_BUDGET_KIB / 1024} MiB; the defaults of both are used.`);
    Object.assign(out, { hashSlots: defaultLimits(schema).hashSlots, passwordMemoryKib: defaultLimits(schema).passwordMemoryKib });
  }
  return out;
}
