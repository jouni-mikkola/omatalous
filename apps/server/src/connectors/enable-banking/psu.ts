/**
 * The Psu-* headers that make a fetch one made with the user present. Enable Banking's rule: send every header the
 * bank requires, or none. They are the member's own address and browser, so the rules here are privacy rules:
 * an address that is not a public one is never sent, a value is passed as data, and nothing here logs a value.
 */
import { isIP } from "node:net";

/** What a bank requires when its entry in the bank list has no `required_psu_headers`; a list it has is used instead (capabilities.ts). */
const DEFAULT_REQUIRED: readonly string[] = ["Psu-Ip-Address", "Psu-User-Agent"];

/** The request header each Psu header is taken from, as the browser sent it. The address comes from the caller. */
const FROM_REQUEST: Readonly<Record<string, string>> = {
  "Psu-User-Agent": "user-agent",
  "Psu-Accept": "accept",
  "Psu-Accept-Charset": "accept-charset",
  "Psu-Accept-Encoding": "accept-encoding",
  "Psu-Accept-Language": "accept-language",
};

const MAX_VALUE = 256;

/** Printable ASCII only: a line break cannot start another header, and a value the HTTP client refuses cannot fail the fetch. */
function clean(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "").trim().slice(0, MAX_VALUE);
}

function publicV4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this host, private, loopback, multicast and reserved
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  return !(a === 192 && b === 168);
}

function publicV6(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return publicV4(mapped[1]!);
  // "::" is the unspecified address, "::1" loopback; the other forms that start so (v4-compatible) are not worth sending
  if (lower.startsWith("::")) return false;
  const first = Number.parseInt(lower.split(":")[0]!, 16);
  if ((first & 0xfe00) === 0xfc00) return false; // unique-local
  if ((first & 0xffc0) === 0xfe80) return false; // link-local
  return (first & 0xff00) !== 0xff00; // multicast
}

/** True for an address the bank could see from the internet. The word `local` and anything that is no address are not. */
function isPublicAddress(ip: string): boolean {
  const address = ip.split("%")[0]!;
  const version = isIP(address);
  return version === 4 ? publicV4(address) : version === 6 ? publicV6(address) : false;
}

/**
 * The headers to send with a member's fetch, or null: all that are required or none. `header` reads the member's
 * request header by lower-case name. A value that is missing or empty once cleaned, or an address that is not a
 * public one, means none.
 */
export function psuHeaders(ip: string, header: (name: string) => string | undefined, required?: readonly string[] | null): Record<string, string> | null {
  // never from a private address, whatever the bank's list asks for
  if (!isPublicAddress(ip)) return null;
  const out: Record<string, string> = {};
  for (const name of required ?? DEFAULT_REQUIRED) {
    const source = FROM_REQUEST[name];
    const raw = name === "Psu-Ip-Address" ? ip : source ? header(source) : undefined;
    const value = raw === undefined ? "" : clean(raw);
    if (!value) return null;
    out[name] = value;
  }
  return Object.keys(out).length ? out : null;
}
