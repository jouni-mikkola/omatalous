import type { RawTransaction } from "@banking/core";
import { UpstreamError } from "../../platform/errors.ts";
import { addressOn, readCappedText } from "../../platform/outbound.ts";
import { importPrivateKey, type SigningKey } from "../../security/rsa-key.ts";
import { BANKS } from "./banks.ts";
import { signJwt } from "./jwt.ts";
import { mapTransaction } from "./mapper.ts";
import type { EbAccount, EbApplication, EbAspsp, EbBalance, EbSession, EbTransactionsPage } from "./types.ts";

/** The bank's error code (like ASPSP_ERROR) when the body has one; the rest of the body may hold account data and stays out of logs. */
function errorCode(body: string): string {
  try {
    const code = (JSON.parse(body) as { error?: unknown }).error;
    return typeof code === "string" && /^[A-Za-z_]{3,60}$/.test(code) ? code : "";
  } catch {
    return "";
  }
}

/**
 * Codes for an account the application may not read. A restricted application (activated by linking own accounts)
 * reads only the accounts under Linked accounts in the Control Panel. The API reference documents NO_ACCOUNTS_ADDED as
 * "No allowed accounts added to the application"; no other code is documented for it. Add a code here only when the
 * docs or a real response confirm it.
 */
export const NOT_LINKED_CODES: readonly string[] = ["NO_ACCOUNTS_ADDED"];

export class EnableBankingError extends UpstreamError {
  readonly body!: string;

  constructor(
    readonly status: number,
    body: string,
    path: string,
  ) {
    super(`Enable Banking ${status} on ${path}${errorCode(body) ? ` ${errorCode(body)}` : ""}`, `Pankkirajapinta vastasi virheellä (${status}). Yritä myöhemmin uudelleen.`);
    // not enumerable, so printing the error to the log does not print the response
    Object.defineProperty(this, "body", { value: body, enumerable: false });
  }

  /** Enable Banking's error code, like ASPSP_ERROR: a fixed word, safe to show where the status is shown. */
  get code(): string {
    return errorCode(this.body);
  }

  /**
   * The bank consent is gone and the user has to authorise again. Only the
   * session/consent error codes count: a 401 for a wrong application key is
   * not the user's consent expiring (see appRejected).
   */
  get consentExpired(): boolean {
    return /(?:EXPIRED|CLOSED|REVOKED|INVALID|UNKNOWN)_SESSION|SESSION_(?:EXPIRED|CLOSED|REVOKED|NOT_FOUND|DOES_NOT_EXIST)|(?:EXPIRED|REVOKED)_CONSENT|CONSENT_(?:EXPIRED|REVOKED|INVALID)|ACCESS_EXPIRED/i.test(this.body);
  }

  /** The application may not read this account: it is not linked to a restricted application. */
  get notLinked(): boolean {
    return NOT_LINKED_CODES.includes(this.code);
  }

  /** The API refused the application itself (JWT, Application ID or key). */
  get appRejected(): boolean {
    return (this.status === 401 || this.status === 403) && !this.consentExpired && !this.notLinked;
  }
}

export interface EnableBankingOptions {
  appId: string;
  privateKeyPem: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Extra hosts (and their subdomains) the consent page may be on. */
  authHosts?: readonly string[];
  /** The household's time zone, for dates the bank gives with a time. */
  timeZone?: string;
}

const MAX_PAGES = 200;
/** One request may take this long; a hung answer would hold the sync lock for 15 minutes. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Largest answer read (a page of transactions is well under 1 MB). */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Where the browser is sent to give consent: Enable Banking's own pages, and the sign-in hosts of the banks of
 * banks.ts. Each entry stands for the host and its subdomains, so it is a domain the bank itself holds, never a
 * shared suffix.
 */
export const AUTH_HOSTS: readonly string[] = [...new Set(["enablebanking.com", ...BANKS.flatMap((b) => b.authHosts)])];

/**
 * The consent URL comes from an API answer and is followed by the browser, so it must be https on a known host
 * (the rule of platform/outbound.ts `addressOn`). Anything else is refused here instead of being passed on.
 */
export function checkAuthUrl(value: unknown, extraHosts: readonly string[] = []): string {
  const url = addressOn(value, [...AUTH_HOSTS, ...extraHosts]);
  if (url === null) throw new EnableBankingError(502, "", "auth url");
  return url;
}

export class EnableBankingClient {
  private key: Promise<SigningKey> | null = null;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: EnableBankingOptions) {
    this.baseUrl = opts.baseUrl ?? "https://api.enablebanking.com";
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  private async authHeader(): Promise<string> {
    const now = Date.now();
    if (!this.token || this.token.expiresAt - now < 5 * 60_000) {
      this.key ??= importPrivateKey(this.opts.privateKeyPem);
      this.token = { value: await signJwt(this.opts.appId, await this.key, now), expiresAt: now + 3600_000 };
    }
    return `Bearer ${this.token.value}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: await this.authHeader(), "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await readCappedText(res, MAX_BODY_BYTES);
    if (text === null) throw new Error("Enable Banking response too large");
    if (!res.ok) throw new EnableBankingError(res.status, text, path);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** The application's own details; only `active` is read. */
  async application(): Promise<EbApplication> {
    return this.request<EbApplication>("GET", "/application");
  }

  /**
   * The banks the application can reach in a country. An entry without a name is left out: callers match by it. An
   * answer without a list is a failed call, not an empty list: an empty list would offer no bank at all.
   */
  async listAspsps(country: string): Promise<EbAspsp[]> {
    const { aspsps } = await this.request<{ aspsps?: unknown }>("GET", `/aspsps?country=${encodeURIComponent(country)}&service=AIS`);
    if (!Array.isArray(aspsps)) throw new EnableBankingError(502, "", "/aspsps");
    return aspsps.filter((a): a is EbAspsp => typeof (a as EbAspsp | null)?.name === "string");
  }

  /** Returns the bank URL the user must open to give consent. */
  async startAuthorization(input: {
    aspspName: string;
    country: string;
    redirectUrl: string;
    state: string;
    validUntil: Date;
    psuType: "personal" | "business";
  }): Promise<{ url: string; authorizationId: string }> {
    const r = await this.request<{ url: string; authorization_id: string }>("POST", "/auth", {
      access: { valid_until: input.validUntil.toISOString() },
      aspsp: { name: input.aspspName, country: input.country },
      state: input.state,
      redirect_url: input.redirectUrl,
      psu_type: input.psuType,
      language: "fi",
    });
    return { url: checkAuthUrl(r.url, this.opts.authHosts), authorizationId: r.authorization_id };
  }

  /** Exchanges the code from the redirect for a session with account details. */
  async createSession(code: string): Promise<EbSession & { accounts: EbAccount[] }> {
    const session = await this.request<EbSession>("POST", "/sessions", { code });
    // Some responses list only account ids; fetch the details for those.
    const accounts = await Promise.all(
      session.accounts.map(async (a) =>
        typeof a === "string" ? { ...(await this.accountDetails(a)), uid: a } : a,
      ),
    );
    return { ...session, accounts };
  }

  /** The account resource (holder, product, card number, limit) of one account of an open session. */
  async accountDetails(accountUid: string): Promise<EbAccount> {
    return this.request<EbAccount>("GET", `/accounts/${encodeURIComponent(accountUid)}/details`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
  }

  async balances(accountUid: string): Promise<EbBalance[]> {
    return (await this.request<{ balances: EbBalance[] }>("GET", `/accounts/${encodeURIComponent(accountUid)}/balances`)).balances;
  }

  /** All transactions since `dateFrom`, following continuation keys. */
  async transactions(accountUid: string, dateFrom: string, strategy: "default" | "longest" = "default"): Promise<RawTransaction[]> {
    const out: RawTransaction[] = [];
    let continuationKey: string | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ date_from: dateFrom });
      if (strategy !== "default") params.set("strategy", strategy);
      if (continuationKey) params.set("continuation_key", continuationKey);
      const r = await this.request<EbTransactionsPage>("GET", `/accounts/${encodeURIComponent(accountUid)}/transactions?${params}`);
      for (const t of r.transactions ?? []) {
        const mapped = mapTransaction(t, this.opts.timeZone);
        if (mapped) out.push(mapped);
      }
      continuationKey = r.continuation_key;
      if (!continuationKey) return out;
    }
    // a short list taken for the whole answer would leave a gap that the next fetch window never covers
    throw new Error(`the bank's transactions did not end after ${MAX_PAGES} pages`);
  }
}
