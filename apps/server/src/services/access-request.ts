/**
 * The change of remote access the app has prepared for the host helper (the `access` maintenance action). The request
 * row takes no parameters, so what to apply waits in a file of the data volume, `<data>/ops/access-request.json`
 * (mode 600, written by rename). The helper reads it only through `ops access` (cli-ops.ts). A tunnel request holds
 * the tunnel token: it is never logged, returned to a browser or put in an error.
 *
 * Every value has one strict form, and a file with anything else in it counts as no request. The helper checks the
 * same forms again in bash (scripts/lib/ops-access.sh) before it writes them to `.env`: a value with a newline, a
 * quote, a space, a `$` or a second key fits none of them.
 */
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ACCESS_AUD, ACCESS_TEAM_DOMAIN } from "../platform/config.ts";
import { UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";

export type AccessRequest = { want: "tunnel"; hostname: string; tunnelToken: string; accessAud: string; teamDomain: string } | { want: "lan" };

/**
 * Lower-case labels with dots: at least two, each 1 to 63 characters with no hyphen at an end. The last label holds a
 * letter, so an IPv4 address (127.0.0.1, 169.254.169.254) is no hostname: the host itself fetches this address.
 */
export const ACCESS_HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?=[0-9-]*[a-z])[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const ACCESS_HOSTNAME_MAX = 253;
/** Cloudflare's tunnel token: base64 of a small JSON object. */
const ACCESS_TUNNEL_TOKEN = /^[A-Za-z0-9_=-]{20,2000}$/;

type Where = Pick<Services, "backupDir">;
/** The longest valid request is about 2 500 bytes. */
const MAX_BYTES = 8192;

/** `<data>/ops/access-request.json`, beside the database copies. Null when this process was not told the data folder. */
export function accessRequestPath(s: Where): string | null {
  return s.backupDir ? join(dirname(s.backupDir), "ops", "access-request.json") : null;
}

/**
 * `<data>/ops/wake`, an empty file. The app touches it after it has queued a request and `ops poll` removes it, so the
 * helper, which waits for it inside its minute (wake_wait in scripts/ops-helper.sh), starts the request within seconds.
 * Null when this process was not told the data folder.
 */
function wakePath(s: Where): string | null {
  return s.backupDir ? join(dirname(s.backupDir), "ops", "wake") : null;
}

/** Called after the insert of a request has committed. A failure is swallowed: the request is queued all the same. */
export function touchWake(s: Where): void {
  const file = wakePath(s);
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, "", { mode: 0o600 });
  } catch {
    // the helper still looks once a minute
  }
}

/** Called by `ops poll` before it reads the queue, so a request queued after that leaves the file there. */
export function clearWake(s: Where): void {
  const file = wakePath(s);
  if (!file) return;
  try {
    rmSync(file, { force: true });
  } catch {
    // an empty wake at worst
  }
}

/** The request when it has exactly its keys and every value has its form, else null. */
export function checkAccessRequest(input: unknown): AccessRequest | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const keys = Object.keys(o).sort().join();
  if (o.want === "lan") return keys === "want" ? { want: "lan" } : null;
  if (o.want !== "tunnel" || keys !== "accessAud,hostname,teamDomain,tunnelToken,want") return null;
  const { hostname, tunnelToken, accessAud, teamDomain } = o;
  if (typeof hostname !== "string" || hostname.length > ACCESS_HOSTNAME_MAX || !ACCESS_HOSTNAME.test(hostname)) return null;
  if (typeof tunnelToken !== "string" || !ACCESS_TUNNEL_TOKEN.test(tunnelToken)) return null;
  if (typeof accessAud !== "string" || !ACCESS_AUD.test(accessAud)) return null;
  if (typeof teamDomain !== "string" || !ACCESS_TEAM_DOMAIN.test(teamDomain)) return null;
  // this key order is the order of the line `ops access` prints
  return { want: "tunnel", hostname, tunnelToken, accessAud, teamDomain };
}

/** What waits for the helper, or null: no file, not a plain file, too long, not JSON or a value out of form. */
export function readAccessRequest(s: Where): AccessRequest | null {
  const file = accessRequestPath(s);
  if (!file) return null;
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return checkAccessRequest(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Stores the request whole or not at all. Refuses one the helper would refuse, without repeating its values. */
export function writeAccessRequest(s: Where, request: AccessRequest): void {
  const checked = checkAccessRequest(request);
  if (!checked) throw new UserError("Etäkäytön asetukset eivät ole kelvolliset.");
  const file = accessRequestPath(s);
  if (!file) throw new Error("The data folder is not known, so the access request cannot be stored.");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const next = `${file}.new`;
  rmSync(next, { force: true });
  // wx: a file that appeared in between is not written through
  writeFileSync(next, `${JSON.stringify(checked)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(next, 0o600);
  renameSync(next, file);
}

/** Removes the request, after the helper reported it applied or when the change is withdrawn. */
export function deleteAccessRequest(s: Where): void {
  const file = accessRequestPath(s);
  if (!file) return;
  rmSync(file, { force: true });
  rmSync(`${file}.new`, { force: true });
}
