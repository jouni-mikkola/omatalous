/**
 * Service tokens on the command line (services/service-tokens.ts), run inside the container:
 *   node dist/node.js service-token create <username> --name <name> [--days <1-90>]   (prints the token once)
 *   node dist/node.js service-token list
 *   node dist/node.js service-token revoke <id>|--all
 * Making one needs the host, so a browser session, stolen or not, cannot make one.
 */
import { option } from "./cli-args.ts";
import { UserError } from "./platform/errors.ts";
import type { Services } from "./services/context.ts";
import { createServiceToken, listServiceTokens, revokeServiceToken } from "./services/service-tokens.ts";

const USAGE = "Usage: service-token create <username> --name <name> [--days <1-90>] | service-token list | service-token revoke <id>|--all";

export async function runServiceTokenCli(s: Services, args: string[]): Promise<number> {
  const [command, target] = args;
  try {
    if (command === "create" && target && !target.startsWith("--")) {
      const made = await createServiceToken(s, { username: target, name: option(args, "--name") ?? "", days: option(args, "--days") });
      console.log(`Service token ${made.id} for ${made.username}, read only, valid until ${made.expiresAt}.`);
      console.log("It is shown this once. Send it as the header Authorization: Bearer <token>.");
      console.log(made.token);
      return 0;
    }
    if (command === "list") {
      const tokens = await listServiceTokens(s);
      if (!tokens.length) console.log("No service tokens.");
      for (const t of tokens) console.log(`${t.id}  ${t.username.padEnd(16)} ${t.name.padEnd(20)} until ${t.expiresAt}  last used ${t.lastUsedAt ?? "never"}${t.lastUsedIp ? ` from ${t.lastUsedIp}` : ""}`);
      return 0;
    }
    if (command === "revoke" && target === "--all") {
      const tokens = await listServiceTokens(s);
      for (const t of tokens) await revokeServiceToken(s, t.id, "komentorivi");
      console.log(`Removed ${tokens.length} service tokens.`);
      return 0;
    }
    if (command === "revoke" && target) {
      if (!(await revokeServiceToken(s, target, "komentorivi"))) {
        console.error(`No service token ${target}.`);
        return 1;
      }
      console.log(`Removed service token ${target}.`);
      return 0;
    }
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    console.error(e.message);
    return 1;
  }
  console.error(USAGE);
  return 1;
}
