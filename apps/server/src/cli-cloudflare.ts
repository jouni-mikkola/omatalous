/**
 * `node dist/node.js cloudflare up|down --name <copy> --hostname <host>`: puts a copy behind a Cloudflare Tunnel and
 * Cloudflare Access (one-time PIN to a list of email addresses). The installer runs it in a throwaway container:
 *
 *   docker run --rm -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCESS_EMAILS <image> node dist/node.js cloudflare up --name <copy> --hostname <host>
 *
 * Handled in entry/node.ts before the database or the app secret is touched: it only talks to Cloudflare. The API
 * token and the emails come from the environment, never from the command line (a command line is readable by every
 * user of the machine). `up` is idempotent and prints one JSON line on stdout, `{"hostname","tunnelToken","changed"}`;
 * everything for people goes to stderr in English, with the token and the tunnel token left out. `down` removes what
 * `up` made and prints nothing on stdout. `up --new` is for a host that is not yet this copy's: it stops with exit 3,
 * before writing anything, when a tunnel or an Access application for the host exists already (another copy's).
 *
 * Exit codes: 0 done, 1 Cloudflare could not be reached or answered in an unexpected way, 2 bad input, 3 Cloudflare
 * refused (the message names the missing permission or the record in the way), 4 Zero Trust is not on.
 */
import { CloudflareApi } from "./providers/cloudflare/api.ts";
import { CloudflareClient, CloudflareError } from "./providers/cloudflare/client.ts";
import { CloudflareExit, cloudflareDown, cloudflareUp } from "./providers/cloudflare/reconcile.ts";

export interface CloudflareIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = "Usage: node dist/node.js cloudflare up|down --name <copy> --hostname <host> [--new (up only)]  (CLOUDFLARE_API_TOKEN, and for up CLOUDFLARE_ACCESS_EMAILS, in the environment)";

const NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME = new RegExp(`^${LABEL}(\\.${LABEL})+$`);
const EMAIL = /^[^\s@,<>"';]+@[^\s@,<>"';]+\.[^\s@,<>"';]+$/;
/** Cloudflare Zero Trust Free covers 50 users. */
const MAX_EMAILS = 50;

interface Parsed {
  command: "up" | "down";
  name: string;
  hostname: string;
  new: boolean;
}

/** Strict: exactly `up|down`, then `--name` and `--hostname` with a value each, and for `up` at most one `--new`. */
function parseArgs(args: string[]): Parsed | string {
  const [command, ...all] = args;
  if (command !== "up" && command !== "down") return USAGE;
  const rest = all.filter((a) => a !== "--new");
  const isNew = rest.length < all.length;
  if (isNew && (command !== "up" || all.length - rest.length > 1)) return USAGE;
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!;
    const value = rest[i + 1];
    if ((flag !== "--name" && flag !== "--hostname") || value === undefined || value.startsWith("--") || values.has(flag)) return USAGE;
    values.set(flag, value);
  }
  const name = values.get("--name");
  const hostname = values.get("--hostname")?.toLowerCase();
  if (!name || !hostname) return USAGE;
  if (!NAME.test(name)) return "--name must be the copy's name: lower case letters, digits, - and _.";
  if (hostname.length > 253 || !HOSTNAME.test(hostname)) return "--hostname must be a plain host name such as talous.example.fi (no https://, path or port).";
  return { command, name, hostname, new: isNew };
}

/** The addresses in CLOUDFLARE_ACCESS_EMAILS, or the problem. The addresses themselves are never repeated in a message. */
function parseEmails(value: string | undefined): string[] | string {
  const emails = (value ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!emails.length) return "CLOUDFLARE_ACCESS_EMAILS is empty: list the email addresses that may sign in, separated by commas.";
  const bad = emails.findIndex((e) => e.length > 254 || !EMAIL.test(e));
  if (bad >= 0) return `Entry ${bad + 1} of CLOUDFLARE_ACCESS_EMAILS is not an email address.`;
  if (emails.length > MAX_EMAILS) return `CLOUDFLARE_ACCESS_EMAILS has more than ${MAX_EMAILS} addresses, the most Zero Trust Free covers.`;
  return emails;
}

export async function runCloudflareCli(
  args: string[],
  env: Record<string, string | undefined>,
  io: CloudflareIo = { out: console.log, err: console.error },
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  const secrets: string[] = [];
  /** Every line for people passes here: whatever the secrets are, they are not in it. */
  const err = (line: string) => io.err(secrets.reduce((text, s) => text.split(s).join("[hidden]"), line));

  const parsed = parseArgs(args);
  if (typeof parsed === "string") {
    err(parsed);
    return 2;
  }
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token || !/^[\x21-\x7e]{16,256}$/.test(token)) {
    err("CLOUDFLARE_API_TOKEN is missing or is not an API token.");
    return 2;
  }
  secrets.push(token);
  const emails = parsed.command === "up" ? parseEmails(env.CLOUDFLARE_ACCESS_EMAILS) : [];
  if (typeof emails === "string") {
    err(emails);
    return 2;
  }

  const api = new CloudflareApi(new CloudflareClient(token, fetchFn));
  const reporter = { say: err, secret: (value: string) => void secrets.push(value) };
  try {
    if (parsed.command === "up") io.out(JSON.stringify(await cloudflareUp(api, { ...parsed, emails }, reporter)));
    else await cloudflareDown(api, parsed, reporter);
    return 0;
  } catch (e) {
    if (e instanceof CloudflareExit) {
      err(e.message);
      return e.code;
    }
    if (e instanceof CloudflareError) {
      err(e.message);
      return e.status >= 400 && e.status < 500 ? 3 : 1;
    }
    err(`cloudflare ${parsed.command} failed: ${(e as Error).name}: ${(e as Error).message}`);
    return 1;
  }
}
