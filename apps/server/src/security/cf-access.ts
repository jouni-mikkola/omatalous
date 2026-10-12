/**
 * The app's own check of Cloudflare Access. A copy behind a Cloudflare Tunnel otherwise trusts that Access is in front
 * of it: a deleted Access application, a Bypass policy or a second host name on the tunnel would hand its login page
 * to anyone. With CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN set (platform/config.ts), every request must carry the token
 * Access adds, `Cf-Access-Jwt-Assertion`, signed by the team's key for this copy's Access application. Without the
 * pair nothing is mounted (app.ts).
 *
 * Fixed here and never taken from the token: the algorithm (RS256) and the host the keys come from (the team domain).
 * Every refusal is the same 403 line. The reason stays in this process (`AccessRefusal`, for the tests).
 */
import { constants, createPublicKey, type KeyObject, verify as verifySignature } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { clientIp } from "../auth/middleware.ts";
import type { AccessConfig } from "../platform/config.ts";
import { readCappedText } from "../platform/outbound.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { recordEvent } from "../services/security.ts";
import { addressKey, RateLimiter } from "./rate-limit.ts";

const ACCESS_HEADER = "cf-access-jwt-assertion";
/** What a refused request gets: 403, plain text, nothing about why. */
export const ACCESS_REFUSAL = "Pääsy estetty.";
/** Failed checks an address may make in a window; after that it is refused without a look at its token. */
export const ACCESS_FAILURES = 10;
export const ACCESS_WINDOW_MS = 15 * 60_000;
/** The keys are fetched at most this often, whatever the tokens name. */
export const ACCESS_REFETCH_MS = 60_000;

/** Clock difference allowed for `exp` and `nbf`. */
const SKEW_SECONDS = 60;
const FETCH_TIMEOUT_MS = 5_000;
/** Cloudflare's tokens are about 1 kB. A longer one is not parsed. */
const TOKEN_MAX = 8_192;
const CERTS_MAX = 256 * 1024;
const KEYS_MAX = 16;
const KEY_BITS_MIN = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const KID = /^[\x21-\x7e]{1,128}$/;
const EMAIL = /^[\x21-\x7e]{3,254}$/;

export type AccessRefusal =
  | "missing" // no header
  | "malformed" // not three base64url parts with JSON objects, too long, no `kid`, or a `crit` header
  | "algorithm" // the header names anything but RS256
  | "unknown_key" // the team's keys are known and the `kid` is not one of them
  | "no_keys" // no key could be fetched yet
  | "signature"
  | "issuer"
  | "audience"
  | "expired" // also a token without `exp`
  | "not_yet";
/** `email` is the address Access signed the person in with, in lower case. A service token has none. */
export type AccessResult = { ok: true; email: string | null } | { ok: false; reason: AccessRefusal };

const no = (reason: AccessRefusal): AccessResult => ({ ok: false, reason });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One part of a token as a JSON object, or null. */
function jsonPart(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** The RSA signing keys of a `/cdn-cgi/access/certs` answer by `kid`. Entries of any other kind are left out. */
function parseKeys(body: unknown): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  const list: unknown[] = isObject(body) && Array.isArray(body.keys) ? body.keys : [];
  for (const k of list.slice(0, KEYS_MAX)) {
    if (!isObject(k) || k.kty !== "RSA" || typeof k.kid !== "string" || !KID.test(k.kid) || typeof k.n !== "string" || typeof k.e !== "string") continue;
    if ((k.use !== undefined && k.use !== "sig") || (k.alg !== undefined && k.alg !== "RS256") || keys.has(k.kid)) continue;
    try {
      // only the two public numbers are passed on, whatever else the entry holds
      const key = createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e }, format: "jwk" });
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) >= KEY_BITS_MIN) keys.set(k.kid, key);
    } catch {
      // not a key
    }
  }
  return keys;
}

/**
 * The team's public keys, kept in memory. They are fetched when a token names a `kid` that is not held (the first
 * token after a start included), at most once a minute. A fetch that fails, or brings no usable key, keeps the keys
 * held. A fetch that works replaces them, so a key the team no longer publishes stops counting.
 */
export class AccessKeys {
  private keys = new Map<string, KeyObject>();
  /** When the last fetch started, in ms. */
  private fetchedAt = Number.NEGATIVE_INFINITY;
  private pending: Promise<void> | null = null;
  private readonly url: string;

  constructor(
    teamDomain: string,
    private readonly fetchFn: typeof fetch,
    private readonly now: () => number,
  ) {
    // the only address keys are read from; config has checked that the value is one label of cloudflareaccess.com
    this.url = `https://${teamDomain}/cdn-cgi/access/certs`;
  }

  get size(): number {
    return this.keys.size;
  }

  async find(kid: string): Promise<KeyObject | null> {
    const held = this.keys.get(kid);
    if (held) return held;
    await this.refetch();
    return this.keys.get(kid) ?? null;
  }

  private refetch(): Promise<void> {
    // requests that arrive during a fetch wait for that one
    if (this.pending) return this.pending;
    const now = this.now();
    const since = now - this.fetchedAt;
    // a clock set back (since < 0) does not hold the next fetch off
    if (since >= 0 && since < ACCESS_REFETCH_MS) return Promise.resolve();
    this.fetchedAt = now;
    this.pending = this.load().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async load(): Promise<void> {
    try {
      // a redirect is an error: the keys come from the team domain or not at all
      const res = await this.fetchFn(this.url, { redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await readCappedText(res, CERTS_MAX);
      if (text === null) throw new Error("the answer is too long");
      const keys = parseKeys(JSON.parse(text));
      if (!keys.size) throw new Error("the answer has no RSA signing key");
      this.keys = keys;
    } catch (err) {
      console.error(`Cloudflare Access keys could not be fetched (${this.url}): ${(err as Error).message}. ${this.keys.size ? "The keys held are used." : "Requests are refused until a fetch works."}`);
    }
  }
}

/** Checks one token against the team's keys and this copy's Access application. */
export class AccessVerifier {
  readonly keys: AccessKeys;
  private readonly issuer: string;

  constructor(
    private readonly config: AccessConfig,
    fetchFn: typeof fetch,
    private readonly now: () => number,
  ) {
    this.keys = new AccessKeys(config.teamDomain, fetchFn, now);
    this.issuer = `https://${config.teamDomain}`;
  }

  async verify(token: string | undefined): Promise<AccessResult> {
    if (!token) return no("missing");
    if (token.length > TOKEN_MAX) return no("malformed");
    const parts = token.split(".");
    if (parts.length !== 3 || !parts.every((p) => BASE64URL.test(p))) return no("malformed");
    const [head, body, signature] = parts as [string, string, string];
    const header = jsonPart(head);
    if (!header) return no("malformed");
    // The one algorithm, compared with a constant. "none", HS256 (the public key used as a shared secret) and every
    // other value stop here, and the header's `alg` chooses nothing below.
    if (header.alg !== "RS256") return no("algorithm");
    if (typeof header.kid !== "string" || !KID.test(header.kid) || header.crit !== undefined) return no("malformed");
    const key = await this.keys.find(header.kid);
    if (!key) return no(this.keys.size ? "unknown_key" : "no_keys");
    if (!signedBy(key, `${head}.${body}`, signature)) return no("signature");

    // the claims are read only after the signature holds
    const claims = jsonPart(body);
    if (!claims) return no("malformed");
    if (claims.iss !== this.issuer) return no("issuer");
    const audiences: unknown[] = typeof claims.aud === "string" ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
    if (!audiences.includes(this.config.aud)) return no("audience");
    const seconds = this.now() / 1000;
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || seconds >= claims.exp + SKEW_SECONDS) return no("expired");
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || seconds < claims.nbf - SKEW_SECONDS)) return no("not_yet");
    return { ok: true, email: typeof claims.email === "string" && EMAIL.test(claims.email) ? claims.email.toLowerCase() : null };
  }
}

/** RSASSA-PKCS1-v1_5 with SHA-256 (RS256), whatever the token says. The key is one of the team's RSA public keys. */
function signedBy(key: KeyObject, signed: string, signature: string): boolean {
  try {
    return verifySignature("RSA-SHA256", Buffer.from(signed, "ascii"), { key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

const refuse = (c: Context) => c.text(ACCESS_REFUSAL, 403, { "Cache-Control": "no-store" });

/**
 * The address of each request that passed the check with one, by the request's context: the body limit (app.ts) may
 * put a new Request in place of the first. Held as long as the request is handled, and stored nowhere.
 */
const signedIn = new WeakMap<object, string>();
/** The address Access verified for this request. Null for a service token, and where no Access check ran. */
export const accessEmail = (c: Context): string | null => signedIn.get(c) ?? null;

/**
 * The middleware, mounted on every path before anything that answers. `GET /api/health` is let through: Docker's
 * health check and the maintenance scripts ask it from inside the container, where no Access is in front.
 *
 * Failed checks are counted per address (addressKey). An address over the limit is refused without a look at its
 * token until its window ends, so a flood costs no signature checks, and the first such refusal of a window is a
 * `lockout` security event. A refusal for lack of keys is a fault on this side and is not counted.
 */
export function cfAccess(s: Services, config: AccessConfig, onPass?: () => Promise<void>): MiddlewareHandler<AppEnv> {
  const now = () => s.now().getTime();
  const verifier = new AccessVerifier(config, s.fetch ?? fetch, now);
  // built here and not on Services: it exists only when Access is configured, and this handler is its one reader
  const failures = new RateLimiter(ACCESS_FAILURES, ACCESS_WINDOW_MS);

  return async (c, next) => {
    if (c.req.method === "GET" && c.req.path === "/api/health") return next();

    const ip = clientIp(c, s);
    const key = addressKey(ip);
    if (failures.check(key, now()) > 0) {
      // over its limit, consume() counts nothing and says whether this window's lockout was reported
      if (failures.consume(key, now()).first) await recordEvent(s, { kind: "lockout", ip, userAgent: c.req.header("user-agent"), detail: "Cloudflare Access" });
      return refuse(c);
    }
    const result = await verifier.verify(c.req.header(ACCESS_HEADER));
    if (result.ok) {
      // somebody came in through Access; what that proves is the caller's to say (app.ts), and a fault there refuses nobody
      await onPass?.().catch(() => undefined);
      if (result.email) signedIn.set(c, result.email);
      return next();
    }
    // A token whose key we do not hold is not counted: after the team rotates its keys and one fetch fails, every good
    // token names an unknown key for a minute, and counting them would lock the household's own address out. Such a
    // refusal costs no signature check, so a flood of made-up kids gains nothing by it.
    if (result.reason !== "no_keys" && result.reason !== "unknown_key") failures.consume(key, now());
    return refuse(c);
  };
}
