/**
 * The routes of Asetukset > Palvelin > Etäkäyttö (apps/server routes/admin.ts, services/remote-access.ts) and the
 * state object every one of them answers with. The server checks everything again; the texts of its refusals are in
 * Finnish and shown as they come.
 */
import { api } from "../../api.ts";

export type AccessMode = "tunnel" | "lan" | "local" | "domain";

export interface RemoteAccessState {
  /** The copy's name (INSTANCE_NAME). */
  copy: string;
  token: {
    saved: boolean;
    /** false when saved but no longer opens: it has to be saved again. */
    usable: boolean;
    savedAt: string | null;
    /** Zone names the token saw when it was saved. */
    zones: string[];
  };
  /** "<copy>.<first zone>", or null without zones. */
  suggestedHostname: string | null;
  /** How the host runs now, from the helper's last report. */
  access: {
    on: boolean;
    hostname: string | null;
    address: string | null;
    mode: AccessMode | null;
    port: number | null;
    /** Who may sign in, when this page set it. */
    emails: string[];
    /** false for a host the installer made: the page has to ask for the list. */
    emailsKnown: boolean;
    /** The running app checks Cloudflare's signature. false for a host the installer made. */
    checked: boolean;
    /** true when on and the address is proven (someone came in through Access, or it was never on trial). */
    confirmed: boolean;
    /** When the server takes an unproven address off by itself. null when confirmed, when off, and before the helper's report is settled. */
    revertAt: string | null;
    /** Where the copy answers after an off ("http://192.168.1.10:8080", "http://localhost:8080"). null from a helper that does not report it. */
    afterOff: string | null;
  };
  /** What this page has made in Cloudflare. */
  cloudflare: {
    hostname: string | null;
    emails: string[];
    /** "installer": the address was made by the server's installer, so Cloudflare's side stays. */
    removal: "removed" | "waiting" | "kept" | "failed" | "installer" | null;
    /** A Finnish sentence for "waiting", "kept", "failed" and "installer". */
    note: string | null;
  };
  /** The change that waits for the helper. */
  pending: {
    want: "tunnel" | "lan";
    hostname: string | null;
    /** The maintenance request, "op_<16 hex>". */
    requestId: string;
    status: "queued" | "running";
    requestedAt: string;
  } | null;
  /** The last change that ended, for 24 hours from its end; null after that. */
  last: {
    want: "tunnel" | "lan";
    hostname: string | null;
    /** "reverted": the server took a new address off by itself, because nobody came in through it. */
    outcome: "applied" | "failed" | "reverted";
    /** The helper's own line (Finnish), or the fixed sentence for "reverted": shown as text. */
    summary: string;
    at: string;
  } | null;
  helper: {
    status: "ok" | "slow" | "off";
    version: string | null;
    /** false: the helper is older than version 3. */
    knowsAccess: boolean;
    enableCommand: string;
  };
  /** Some maintenance action is queued or running. */
  busy: boolean;
}

export const REMOTE_ACCESS_PATH = "/api/admin/remote-access";

export const remoteAccessCalls = {
  /** The token and the password travel in the body, never in the address. */
  saveToken: (token: string, password: string) => api<RemoteAccessState>(`${REMOTE_ACCESS_PATH}/token`, { method: "PUT", body: { token, password } }),
  /** Removing the token asks for the password too, as JSON in the body (a DELETE without one is a 400). */
  removeToken: (password: string) => api<RemoteAccessState>(`${REMOTE_ACCESS_PATH}/token`, { method: "DELETE", body: { password } }),
  turnOn: (hostname: string, emails: string[], password: string) => api<RemoteAccessState>(`${REMOTE_ACCESS_PATH}/on`, { method: "POST", body: { hostname, emails, password } }),
  /** `localOnly: true` goes out only when the admin chose it: the copy then answers on the server machine alone. */
  turnOff: (password: string, localOnly = false) => api<RemoteAccessState>(`${REMOTE_ACCESS_PATH}/off`, { method: "POST", body: localOnly ? { password, localOnly: true } : { password } }),
  /** Withdraws a change that still waits for the helper (the same route as Ylläpito). */
  cancel: (requestId: string) => api<{ ok: boolean }>(`/api/ops/cancel/${requestId}`, { method: "POST", body: {} }),
};

/**
 * Sends what the field holds and empties the field once the server has taken it. The token lives in the field and
 * nowhere else: not in React state, not in storage, not in the address. A refusal leaves it in the field, so a wrong
 * password can be corrected without typing the token again.
 */
export async function saveTokenFrom(field: { value: string }, password: string): Promise<RemoteAccessState> {
  const next = await remoteAccessCalls.saveToken(field.value, password);
  field.value = "";
  return next;
}
