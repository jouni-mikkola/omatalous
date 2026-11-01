/**
 * What the host helper needs for the copy to another machine (the `offsite` maintenance action): where it goes and the
 * key to sign in with. The request row takes no parameters, so the values wait in a file of the data volume,
 * `<data>/ops/offsite-request.json` (mode 600, written by rename), made from the sealed settings just before a request
 * is queued. The helper reads it only through `ops offsite` (cli-ops.ts). The SSH key is a secret: never logged,
 * returned to a browser or put in an error. Like access-request.ts, every value has one strict form that bash checks
 * again (scripts/lib/ops-offsite.sh), and a file with anything else in it counts as no request.
 */
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGE_RECIPIENT, isSshKey } from "../security/offsite-keys.ts";
import { OFFSITE_DIR, OFFSITE_HOST, OFFSITE_USER } from "../platform/validate.ts";
import type { Services } from "./context.ts";

export interface OffsiteRequest {
  host: string;
  port: number;
  user: string;
  dir: string;
  recipient: string;
  /** The private SSH key as a PKCS#8 PEM. */
  sshKey: string;
}

type Where = Pick<Services, "backupDir">;
const MAX_BYTES = 4096;

function offsiteRequestPath(s: Where): string | null {
  return s.backupDir ? join(dirname(s.backupDir), "ops", "offsite-request.json") : null;
}

/** The request when it has exactly its keys and every value has its form, else null. */
function checkOffsiteRequest(input: unknown): OffsiteRequest | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== "dir,host,port,recipient,sshKey,user") return null;
  const { host, port, user, dir, recipient, sshKey } = o;
  if (typeof host !== "string" || host.length > 253 || !OFFSITE_HOST.test(host)) return null;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof user !== "string" || !OFFSITE_USER.test(user)) return null;
  if (typeof dir !== "string" || !OFFSITE_DIR.test(dir) || dir.includes("//") || dir.split("/").includes("..")) return null;
  if (typeof recipient !== "string" || !AGE_RECIPIENT.test(recipient)) return null;
  if (!isSshKey(sshKey)) return null;
  // this key order is the order of the line `ops offsite` prints
  return { host, port, user, dir, recipient, sshKey };
}

export function readOffsiteRequest(s: Where): OffsiteRequest | null {
  const file = offsiteRequestPath(s);
  if (!file) return null;
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return checkOffsiteRequest(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Stores the request whole or not at all. Returns false for one the helper would refuse or when the data folder is unknown. */
export function writeOffsiteRequest(s: Where, request: OffsiteRequest): boolean {
  const checked = checkOffsiteRequest(request);
  const file = offsiteRequestPath(s);
  if (!checked || !file) return false;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const next = `${file}.new`;
  rmSync(next, { force: true });
  writeFileSync(next, `${JSON.stringify(checked)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(next, 0o600);
  renameSync(next, file);
  return true;
}

export function deleteOffsiteRequest(s: Where): void {
  const file = offsiteRequestPath(s);
  if (!file) return;
  rmSync(file, { force: true });
  rmSync(`${file}.new`, { force: true });
}

/** Removes the file when no offsite request is waiting for the helper (queued or running) and it is not just written, before its request is queued. */
export async function sweepOffsiteRequest(s: Services, reported = false): Promise<void> {
  const file = offsiteRequestPath(s);
  try {
    if (!reported && file && Date.now() - statSync(file).mtimeMs < 120_000) return;
  } catch {
    return;
  }
  if (!(await s.ops.recent(40)).some((r) => r.action === "offsite" && (r.status === "queued" || r.status === "running"))) deleteOffsiteRequest(s);
}
