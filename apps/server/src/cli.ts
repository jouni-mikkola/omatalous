/**
 * Command-line helpers, run inside the container:
 *   docker compose exec banking node dist/node.js setup-code      (a new code for creating the first admin in the browser, good for 24 hours)
 *   docker compose exec banking node dist/node.js version
 *   docker compose exec banking node dist/node.js user create <username> [--admin] [--name "Nimi"]
 *   docker compose exec banking node dist/node.js user reset-password <username>
 *   docker compose exec banking node dist/node.js user list
 *   docker compose exec banking node dist/node.js user delete <username>
 *   docker compose exec banking node dist/node.js sessions revoke-all      (signs everyone out)
 *   docker compose run --rm --no-deps -T banking node dist/node.js restore <file in /data>   (handled in entry/node.ts, app stopped)
 *   node dist/node.js migrate-check <database file>   (handled in entry/node.ts, db/migrate-check.ts: tries the migrations on a copy)
 *   node dist/node.js cloudflare up|down --name <copy> --hostname <host>   (handled in entry/node.ts, cli-cloudflare.ts: tunnel and Access, no database)
 *   docker compose exec banking node dist/node.js secret rotate            (new app secret, bank keys re-sealed)
 *   node dist/node.js secret check <file>       (exit 0 when the secret in the file opens the stored bank keys, 4 when it does not, 1 when the file could not be tried; restore.sh reads the status before it replaces the app secret)
 *   docker compose exec banking node dist/node.js address set <url>        (the app's own address, install.sh runs it)
 *   docker compose exec -T banking node dist/node.js ops poll|report|state  (the host helper, see cli-ops.ts)
 */
import { readFileSync } from "node:fs";
import { option } from "./cli-args.ts";
import { runOpsCli } from "./cli-ops.ts";
import { isAppSecret } from "./entry/app-secret.ts";
import { UserError } from "./platform/errors.ts";
import type { Services } from "./services/context.ts";
import { parseBaseUrl } from "./platform/validate.ts";
import { databaseOpensWith, triedAgainstToken } from "./services/secret-rotation.ts";
import { recordEvent } from "./services/security.ts";
import { createUser, issueSetupCode, removeUser, resetPassword } from "./services/users.ts";

/** What only the Node entry knows: where the app secret file is and how to copy the database. */
export interface CliContext {
  /** Null when the secret comes from APP_SECRET in the environment. */
  secretFile?: string | null;
  rotateSecret?: () => Promise<string[]>;
  /** All of stdin as text (the ops subcommands read JSON from it). */
  readStdin?: () => Promise<string>;
}

export async function runCli(s: Services, args: string[], ctx: CliContext = {}): Promise<number> {
  const [group, command, username] = args;
  if (group === "version") {
    console.log(`${s.build.version} (${s.build.id})`);
    return 0;
  }
  if (group === "ops") return runOpsCli(s, args.slice(1), ctx.readStdin ?? (async () => ""));
  if (group === "setup-code") {
    const code = await issueSetupCode(s);
    if (!code) {
      console.log("An admin already exists: sign in with the browser.");
      return 0;
    }
    console.log(code);
    return 0;
  }
  if (group === "sessions" && command === "revoke-all") {
    const n = await s.users.deleteAllSessions();
    await recordEvent(s, { kind: "session_revoked", detail: "kaikki (komentorivi)" });
    console.log(`Signed out ${n} sessions. Everyone has to sign in again.`);
    return 0;
  }
  if (group === "address" && command === "set") {
    try {
      // same parser as the browser field, so the command cannot store anything the settings page would refuse
      const next = parseBaseUrl(username);
      // install.sh restarts the app only when the output has " is now ", so keep that wording
      if ((await s.instance.load(true)).appBaseUrl === next) {
        console.log(`App address is already ${next}.`);
        return 0;
      }
      const saved = await s.instance.save({ appBaseUrl: next });
      console.log(`App address is now ${saved.appBaseUrl}.`);
      return 0;
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      console.error(e.message);
      return 1;
    }
  }
  if (group === "secret" && command === "rotate") {
    if (!ctx.rotateSecret) {
      console.error("The app secret comes from the APP_SECRET environment variable. Change it by hand and re-seal the bank keys by moving the secret into a file (APP_SECRET_FILE).");
      return 1;
    }
    for (const line of await ctx.rotateSecret()) console.log(line);
    return 0;
  }
  if (group === "secret" && command === "check") {
    // The candidate is a file, never an argument or output: the command prints one fixed sentence and no part of the secret.
    let candidate: string;
    try {
      candidate = readFileSync(username ?? "", "utf8").trim();
    } catch {
      console.error("The secret file cannot be read. Give its path: secret check <file>");
      return 1;
    }
    // a file from outside is also held to one line, as restore.sh holds it before it sends the file here
    if (!isAppSecret(candidate) || candidate.includes("\n")) {
      console.error("The file is not an app secret (one line of at least 32 characters).");
      return 1;
    }
    // with no bank key stored, the Cloudflare API token of Asetukset > Palvelin > Etäkäyttö is what the secret is tried against
    const what = (await triedAgainstToken(s)) ? "the Cloudflare API token saved in the app" : "the stored bank keys";
    if (!(await databaseOpensWith(s, candidate))) {
      console.error(`The secret does not open ${what}.`);
      // a status of its own: restore.sh tells a wrong secret from a check that could not run by it, never by the sentence
      return 4;
    }
    console.log(`The secret fits ${what}.`);
    return 0;
  }
  if (group !== "user" || !command) {
    console.log("Usage: version | setup-code | user create <username> [--admin] [--name \"Name\"] | user reset-password <username> | user list | user delete <username> | sessions revoke-all | restore <file> | migrate-check <database file> | cloudflare up|down --name <copy> --hostname <host> | secret rotate | secret check <file> | address set <url> | ops poll|report|state");
    return 1;
  }
  if (command === "list") {
    for (const u of await s.users.list()) console.log(`${u.username.padEnd(20)} ${u.role.padEnd(7)} ${u.displayName}`);
    return 0;
  }
  if (!username) {
    console.error("Give a username.");
    return 1;
  }
  if (command === "create") {
    const { user, temporaryPassword } = await createUser(s, {
      username,
      displayName: option(args, "--name") ?? username,
      role: args.includes("--admin") ? "admin" : "member",
    });
    console.log(`Created ${user.role === "admin" ? "admin" : "user"} ${user.username}.`);
    console.log(`Temporary password: ${temporaryPassword}  (changed at the first sign-in)`);
    return 0;
  }
  const record = await s.users.findForLogin(username);
  if (!record) {
    console.error(`User ${username} not found.`);
    return 1;
  }
  if (command === "reset-password") {
    console.log(`New temporary password for ${username}: ${await resetPassword(s, record.id)}`);
    return 0;
  }
  if (command === "delete") {
    const r = await removeUser(s, record.id, "komentorivi");
    console.log(`Deleted ${username} and all their data.`);
    if (r.revoked || r.failed) console.log(`Bank connections ended: ${r.revoked}${r.failed ? `, ${r.failed} failed (they expire at the bank on their own)` : ""}.`);
    return 0;
  }
  console.error(`Unknown command: ${command}`);
  return 1;
}
