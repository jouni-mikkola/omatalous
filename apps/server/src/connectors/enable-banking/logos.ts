/**
 * Bank logos. Enable Banking's bank list gives each bank a `logo` address. The server fetches that picture when it is
 * first asked for and serves it from the app's own address (routes/bank-logos.ts): the browser never calls a third
 * party, and no artwork file is kept in the repository.
 *
 * The outbound call, all of it in this file:
 *   - Which address: one that `logoAddress` passes, read from the live list of the instance's own application for a
 *     bank of banks.ts. Nothing a browser sends is part of it.
 *   - What is sent: a GET with an Accept header. No Authorization header and no cookie: the application's key is not
 *     used here.
 *   - No redirect is followed. Any answer other than 200 is a failure.
 *   - Five seconds for the whole answer, 300 kB at most, one of four picture types.
 *   - How often: once per bank for as long as the bank list is kept (a day). A failure is remembered for ten minutes.
 *     Requests for one bank at the same time share one call.
 *   - What is kept: the bytes and the type as one of four fixed strings. No header of the answer is passed on.
 *   - The log gets the bank id and a code, never the address or the answer.
 */
import { addressOn, readCapped } from "../../platform/outbound.ts";
import type { Services } from "../../services/context.ts";
import type { BankOption } from "./banks.ts";
import type { EbAspsp } from "./types.ts";

/** Logos are fetched from this host and its subdomains, and from nowhere else. */
const LOGO_HOST = "enablebanking.com";
const ADDRESS_MAX = 500;
const TIMEOUT_MS = 5000;
/** 300 kB. A logo is some kilobytes: a larger answer is something else. */
export const LOGO_MAX_BYTES = 300_000;
/** A failed fetch is not tried again before this, so a broken address is not asked on every page load. */
const RETRY_MS = 10 * 60_000;

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export interface Logo {
  type: LogoType;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Why a logo could not be fetched: the word that goes to the log beside the bank id. */
type Failure = "redirect" | "status" | "type" | "size" | "content" | "timeout" | "network";

/**
 * The address a logo is fetched from, or null. The value comes from an API answer and the server itself calls it, so
 * it is held to the rule of platform/outbound.ts `addressOn` for enablebanking.com, and to 500 characters. Anything
 * else counts as no logo. The address returned is the parsed one, so what is checked is what is called.
 */
export function logoAddress(value: unknown): string | null {
  return typeof value === "string" && value.length <= ADDRESS_MAX ? addressOn(value, [LOGO_HOST]) : null;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const has = (bytes: Uint8Array, magic: readonly number[], at = 0) => bytes.length >= at + magic.length && magic.every((b, i) => bytes[at + i] === b);

/** A raster picture starts with the bytes of its type. An SVG is text, so it has to hold an svg element. */
function agrees(type: LogoType, bytes: Uint8Array): boolean {
  if (type === "image/png") return has(bytes, PNG);
  if (type === "image/jpeg") return has(bytes, JPEG);
  if (type === "image/webp") return has(bytes, RIFF) && has(bytes, WEBP, 8);
  return new TextDecoder().decode(bytes).includes("<svg");
}

/** The picture type a Content-Type header names, without its parameters. Null for any other type and for none. */
function typeOf(header: string | null): LogoType | null {
  const type = (header ?? "").split(";")[0]!.trim().toLowerCase();
  return LOGO_TYPES.find((t) => t === type) ?? null;
}

/** Stops reading an answer that is not used. */
function drop(res: Response, why: Failure): Failure {
  void res.body?.cancel().catch(() => {});
  return why;
}

/** One GET of an address `logoAddress` passed. Never rejects. */
async function ask(fetchFn: typeof fetch, address: string, signal: AbortSignal): Promise<Logo | Failure> {
  try {
    const res = await fetchFn(address, { headers: { Accept: LOGO_TYPES.join(", ") }, redirect: "manual", signal });
    // "manual" hands a redirect back as it is: its Location is never read
    if (res.redirected || res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return drop(res, "redirect");
    if (res.status !== 200) return drop(res, "status");
    const type = typeOf(res.headers.get("content-type"));
    if (!type) return drop(res, "type");
    const bytes = await readCapped(res, LOGO_MAX_BYTES);
    if (!bytes) return "size";
    return agrees(type, bytes) ? { type, bytes } : "content";
  } catch {
    return signal.aborted ? "timeout" : "network";
  }
}

/** `ask` with the five seconds counted here too, so an answer that never ends is cut off whatever the fetch in use does with the signal. */
async function fetchLogo(fetchFn: typeof fetch, address: string): Promise<Logo | Failure> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Failure>((done) => {
    timer = setTimeout(() => {
      abort.abort();
      done("timeout");
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([ask(fetchFn, address, abort.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The logos of one server, by bank id. */
interface Store {
  /** The bank list the pictures were fetched for. A new answer from Enable Banking starts over. */
  list: readonly EbAspsp[] | null;
  logos: Map<string, Logo>;
  pending: Map<string, Promise<Logo | null>>;
  /** When a bank's logo last failed. Kept over a new list: a new list does not make a broken address worth asking sooner. */
  failedAt: Map<string, number>;
}
const stores = new WeakMap<object, Store>();

/**
 * The logo of a bank of banks.ts, fetched when it is first asked for. `list` is the live bank list in use and `logo`
 * the address its entry for the bank gives. Null when that is no address this server fetches, and when the fetch
 * failed now or within the last ten minutes. The picture is kept for as long as `list` is the list in use.
 */
export async function logoFor(s: Services, list: readonly EbAspsp[], bank: Pick<BankOption, "id">, logo: unknown): Promise<Logo | null> {
  const address = logoAddress(logo);
  if (!address) return null;
  let store = stores.get(s);
  if (!store) stores.set(s, (store = { list, logos: new Map(), pending: new Map(), failedAt: new Map() }));
  if (store.list !== list) {
    store.list = list;
    store.logos = new Map();
    store.pending = new Map();
  }
  const { logos, pending, failedAt } = store;
  const kept = logos.get(bank.id);
  if (kept) return kept;
  const failed = failedAt.get(bank.id);
  if (failed !== undefined && s.now().getTime() - failed < RETRY_MS) return null;
  let asked = pending.get(bank.id);
  if (!asked) {
    const fetchFn: typeof fetch = s.fetch ?? ((input, init) => fetch(input, init));
    asked = fetchLogo(fetchFn, address).then((result) => {
      pending.delete(bank.id);
      if (typeof result !== "string") {
        // into the map of the list it was fetched for: an answer that comes after a new list is not kept
        logos.set(bank.id, result);
        return result;
      }
      failedAt.set(bank.id, s.now().getTime());
      console.error(`bank logo: ${bank.id} ${result}`);
      return null;
    });
    pending.set(bank.id, asked);
  }
  return asked;
}
