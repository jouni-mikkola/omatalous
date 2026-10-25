import { type Loan, notLoanMark, type PayerRole } from "@banking/core";
import { figuresOwner, keepFigures, keptFigures, markCurrent, markKept } from "./offline.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
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
 * there too. Any other request fails as before.
 */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; keep?: boolean }): Promise<T> {
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
    throw new ApiError("Palvelimeen ei saada yhteyttä. Yritä uudelleen.", 0);
  }
  // a proxy error page or a cut response is not JSON
  const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (data === null && res.status >= 500) {
      const kept = await unreachable();
      if (kept) return kept;
    }
    const err = data as { error?: string; code?: string } | null;
    if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthenticated();
    throw new ApiError(err?.error ?? `${res.status} ${res.statusText}`, res.status, err?.code);
  }
  if (read) {
    markCurrent(path);
    if (init?.keep) keepFigures(path, data, who);
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
    throw new ApiError("Palvelimeen ei saada yhteyttä. Yritä uudelleen.", 0);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(data?.error ?? `${res.status} ${res.statusText}`, res.status, data?.code);
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
  /** "Ei laina" on a proposal (`GET /api/loans/proposals`): the mark that keeps the series from being proposed again. */
  notLoan: (key: string) => api<unknown>("/api/marks", { method: "PUT", body: notLoanMark({ key }) }),
};

/** The answer to a payer's question on Yhteenveto: a role (the member's own answer), or null for the proposal again. */
export const payerCalls = {
  say: (key: string, role: PayerRole | null) => api<{ ok: true }>("/api/payer-roles", { method: "PUT", body: { key, role } }),
};
