/**
 * Which addresses the bank return may forward the browser to. The project's static return page (relay/callback)
 * receives the bank's redirect on https and sends the browser on to the household's own server, whose address
 * travels in the OAuth `state`. Only private, loopback and local-name origins qualify, so the page cannot be
 * used to send anyone to a public site. The return page carries a hand-written copy of this rule; both run the
 * same test table (test/local-origin.test.ts).
 */

const LOCAL_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal"];
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function privateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function localName(host: string): boolean {
  if (host.length > 253) return false;
  const labels = host.split(".");
  if (!labels.every((l) => LABEL.test(l))) return false;
  // A bare name such as "ai" or "wpad" can be a public host (some top-level domains have an apex record), so only
  // localhost is accepted without a local suffix.
  if (labels.length === 1) return host === "localhost";
  return LOCAL_SUFFIXES.some((s) => host.endsWith(s));
}

/**
 * The canonical origin (`http://192.168.1.10:8080`) when `value` is a plain origin on a private network, else null.
 * The text must already be canonical, so forms such as `http://0xC0.168.1.10` or `HTTP://TALOUS.LOCAL` are refused
 * because `window.location.origin` is always canonical.
 */
export function parseLocalOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 120 || /[\s\x00-\x1f\x7f\\%]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
  if (value !== url.origin && value !== `${url.origin}/`) return null;
  if (url.port === "0") return null;
  const host = url.hostname;
  let ok: boolean;
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    ok = v6 === "::1" || /^f[cd][0-9a-f]{2}:/.test(v6);
  } else {
    ok = /^[0-9.]+$/.test(host) ? privateIpv4(host) : localName(host);
  }
  return ok ? url.origin : null;
}

const encoder = new TextEncoder();

/** `state` for the bank: an unguessable token, a dot and the base64url of the origin to return to. */
export function relayState(token: string, origin: string): string {
  const b64 = btoa(String.fromCharCode(...encoder.encode(origin)));
  return `${token}.${b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** The origin inside a relay `state`, checked again with the same rule; null for any other state. */
export function originFromRelayState(state: unknown): string | null {
  if (typeof state !== "string" || state.length > 300) return null;
  const dot = state.lastIndexOf(".");
  if (dot < 1) return null;
  const b64 = state.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(b64)) return null;
  try {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    return parseLocalOrigin(bin);
  } catch {
    return null;
  }
}
