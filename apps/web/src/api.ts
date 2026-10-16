import { type Loan, notLoanMark } from "@banking/core";

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
 */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
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
    // the browser's own message ("Failed to fetch") is English and says nothing to the user
    throw new ApiError("Palvelimeen ei saada yhteyttä. Yritä uudelleen.", 0);
  }
  // a proxy error page or a cut response is not JSON
  const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = data as { error?: string; code?: string } | null;
    if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthenticated();
    throw new ApiError(err?.error ?? `${res.status} ${res.statusText}`, res.status, err?.code);
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
