/**
 * One https POST whose connection goes to an address the caller has checked, so a name that answers differently a
 * moment later (DNS rebinding) cannot lead the request inside the home network.
 *
 * Decision: the admin trusts that a notice address never reaches a private host. The check and the connection use one
 * DNS answer: the name is resolved once, every address must be public, and the socket is opened to the first of them.
 * The URL keeps the name, so the Host header and the TLS server name stay the name's own.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export interface Pin {
  address: string;
  family: number;
}
export type Resolve = (host: string) => Promise<Pin[]>;

const resolveAll: Resolve = (host) => dnsLookup(host, { all: true });

function isPrivate(a: string): boolean {
  return isIP(a) === 6
    ? /^(::1?$|f[cd]|fe[89ab]|::ffff:|64:ff9b:|2002:)/i.test(a)
    : /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/.test(a);
}

/** The first address of a name that resolves only to public addresses (one private answer refuses the name), or null. */
export async function publicAddress(host: string, resolve: Resolve = resolveAll): Promise<Pin | null> {
  try {
    const all = await resolve(host.replace(/^\[|\]$/g, ""));
    const first = all[0];
    return first && !all.some((x) => isPrivate(x.address)) ? { address: first.address, family: first.family } : null;
  } catch {
    return null;
  }
}

/** A `lookup` for the socket that always answers with the checked address and asks DNS nothing. */
export function pinnedLookup(pin: Pin): LookupFunction {
  return (_host, options, callback) => {
    if (options.all) callback(null, [{ address: pin.address, family: pin.family }]);
    else callback(null, pin.address, pin.family);
  };
}

/** POSTs `body` to `url` over a socket opened to `pin`. Resolves with the status; the answer is not read and a redirect is not followed. */
export function postPinned(url: URL, headers: Record<string, string>, body: string, pin: Pin, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(body)) }, lookup: pinnedLookup(pin), signal: AbortSignal.timeout(timeoutMs) },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
