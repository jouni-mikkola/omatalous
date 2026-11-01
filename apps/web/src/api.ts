import { type Loan, messageIn, messageFromWire, type MessageCode, notLoanMark, type PayerRole } from "@banking/core";
import { dropAnswers } from "./query-client.ts";
import { figuresOwner, keepFigures, keptFigures, markCurrent, markKept } from "./offline.ts";
import { language as currentLanguage } from "./format.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** The catalogue code of the sentence, when the server sent one (core messages.ts). */
    readonly messageCode?: MessageCode,
  ) {
    super(message);
  }
}

/** Called when the session is gone, so the app can show the login screen. */
let onUnauthenticated: () => void = () => {};
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

/**
 * JSON API call. Always sends `X-Requested-With: fetch`, which the server
 * requires on state-changing requests (CSRF protection).
 *
 * A GET with `keep` leaves its answer on the device (offline.ts), and when the server cannot be reached (no connection,
 * or a proxy's error page where the server's own JSON should be) it is answered from there, if it has been kept, and
 * the page says since when the figures are (`useFiguresFrom`). The request for "who is signed in" is answered from
 * there too. Any other request fails as before. A write that succeeds drops the cached answers (query-client.ts), unless it says it is `quiet`: it changes none a page holds, or tells the page itself.
 */
/** What a failure with no message of the server's own says: no status code, which tells the reader nothing. */
function plainStatus(status: number): string {
  return messageIn(currentLanguage(), status >= 500 ? "app.server_status" : "app.request_failed");
}

type WireError = { error?: string; code?: string; messageCode?: string; params?: unknown } | null;

/** The error of an answer: the sentence is formatted here from the catalogue code, else the server's own text. */
function failure(err: WireError, status: number): ApiError {
  const text = messageFromWire(err?.messageCode, err?.params, currentLanguage());
  return new ApiError(text ?? err?.error ?? plainStatus(status), status, err?.code, text === undefined ? undefined : (err?.messageCode as MessageCode));
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; keep?: boolean; quiet?: boolean }): Promise<T> {
  const read = (init?.method ?? "GET") === "GET";
  const keep = read && (init?.keep || path === "/api/auth/state");
  // the user the request is made for: an answer that comes after a logout or a change of user is not kept
  const who = figuresOwner();
  const unreachable = async (): Promise<T | null> => {
    const kept = keep ? await keptFigures(path) : null;
    if (!kept) return null;
    markKept(path, kept.at);
    return kept.data as T;
  };
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "fetch",
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    const kept = await unreachable();
    if (kept) return kept;
    // the browser's own message ("Failed to fetch") is English and says nothing to the user
    throw new ApiError(messageIn(currentLanguage(), "app.unreachable"), 0, undefined, "app.unreachable");
  }
  // a proxy error page or a cut response is not JSON
  const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (data === null && res.status >= 500) {
      const kept = await unreachable();
      if (kept) return kept;
    }
    if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthenticated();
    throw failure(data as WireError, res.status);
  }
  if (read) {
    markCurrent(path);
    if (init?.keep) keepFigures(path, data, who);
  } else if (!init?.quiet) {
    // a write may change any answer the pages cache; the open ones are read again, the rest on their next visit
    void dropAnswers();
  }
  return data as T;
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * A file from a POST (a password goes in the body, not in an address; the export of the data has an empty body). Returns the bytes and the
 * file name the server chose.
 */
export async function apiDownload(path: string, body: unknown): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "fetch", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(messageIn(currentLanguage(), "app.unreachable"), 0, undefined, "app.unreachable");
  }
  if (!res.ok) {
    throw failure((await res.json().catch(() => null)) as WireError, res.status);
  }
  const name = /filename="([A-Za-z0-9._-]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  return { blob: await res.blob(), filename: name ?? "varmuuskopio.db" };
}

/** Hands bytes to the browser as a file of the given name. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The writes of Asetukset > Lainat (`GET /api/loans` lists them). A body is every field of a loan but its id: PUT
 * replaces the whole loan, so an edit sends back also what its form does not show.
 */
export const loanCalls = {
  add: (body: Omit<Loan, "id">) => api<{ loan: Loan }>("/api/loans", { method: "POST", body }),
  replace: (id: string, body: Omit<Loan, "id">) => api<{ loan: Loan }>(`/api/loans/${encodeURIComponent(id)}`, { method: "PUT", body }),
  remove: (id: string) => api<{ ok: true }>(`/api/loans/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** "Ei ole laina" on a proposal (`GET /api/loans/proposals`): the mark that keeps the series from being proposed again. */
  notLoan: (key: string) => api<unknown>("/api/marks", { method: "PUT", body: notLoanMark({ key }) }),
};

/** The answer to a payer's question on Yhteenveto: a role (the member's own answer), or null for the proposal again. */
export const payerCalls = {
  say: (key: string, role: PayerRole | null) => api<{ ok: true }>("/api/payer-roles", { method: "PUT", body: { key, role } }),
};
