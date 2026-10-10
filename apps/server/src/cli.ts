/**
 * Command-line helpers, run inside the container:
 *   docker compose exec banking node dist/node.js setup-code      (code for creating the first admin in the browser)
 *   docker compose exec banking node dist/node.js version
 *   docker compose exec banking node dist/node.js user create <username> [--admin] [--name "Nimi"]
 *   docker compose exec banking node dist/node.js user reset-password <username>
 *   docker compose exec banking node dist/node.js user list
 *   docker compose exec banking node dist/node.js user delete <username>
 *   docker compose exec banking node dist/node.js sessions revoke-all      (signs everyone out)
 *   docker compose exec banking node dist/node.js secret rotate            (new app secret, bank keys re-sealed)
 *   docker compose exec -T banking node dist/node.js ops poll|report|state  (the host helper, see cli-ops.ts)
 */
import { runOpsCli } from "./cli-ops.ts";
import type { Services } from "./services/context.ts";
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

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
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
      console.log("Ylläpitäjä on jo luotu: kirjaudu sisään selaimessa.");
      return 0;
    }
    console.log(code);
    return 0;
  }
  if (group === "sessions" && command === "revoke-all") {
    const n = await s.users.deleteAllSessions();
    await recordEvent(s, { kind: "session_revoked", detail: "kaikki (komentorivi)" });
    console.log(`Kirjattu ulos ${n} istuntoa. Kaikkien pitää kirjautua uudelleen.`);
    return 0;
  }
  if (group === "secret" && command === "rotate") {
    if (!ctx.rotateSecret) {
      console.error("Salausavain tulee ympäristömuuttujasta APP_SECRET. Vaihda se käsin ja salaa pankkiavaimet uudelleen asettamalla avain tiedostoon (APP_SECRET_FILE).");
      return 1;
    }
    for (const line of await ctx.rotateSecret()) console.log(line);
    return 0;
  }
  if (group !== "user" || !command) {
    console.log("Käyttö: version | setup-code | user create <tunnus> [--admin] [--name \"Nimi\"] | user reset-password <tunnus> | user list | user delete <tunnus> | sessions revoke-all | secret rotate | ops poll|report|state");
    return 1;
  }
  if (command === "list") {
    for (const u of await s.users.list()) console.log(`${u.username.padEnd(20)} ${u.role.padEnd(7)} ${u.displayName}`);
    return 0;
  }
  if (!username) {
    console.error("Anna käyttäjätunnus.");
    return 1;
  }
  if (command === "create") {
    const { user, temporaryPassword } = await createUser(s, {
      username,
      displayName: option(args, "--name") ?? username,
      role: args.includes("--admin") ? "admin" : "member",
    });
    console.log(`Luotu ${user.role === "admin" ? "ylläpitäjä" : "käyttäjä"} ${user.username}.`);
    console.log(`Väliaikainen salasana: ${temporaryPassword}  (vaihdetaan ensimmäisellä kirjautumisella)`);
    return 0;
  }
  const record = await s.users.findForLogin(username);
  if (!record) {
    console.error(`Käyttäjää ${username} ei löydy.`);
    return 1;
  }
  if (command === "reset-password") {
    console.log(`Uusi väliaikainen salasana käyttäjälle ${username}: ${await resetPassword(s, record.id)}`);
    return 0;
  }
  if (command === "delete") {
    const r = await removeUser(s, record.id, "komentorivi");
    console.log(`Poistettu ${username} ja kaikki hänen tietonsa.`);
    if (r.revoked || r.failed) console.log(`Pankkiyhteyksiä päätetty ${r.revoked}${r.failed ? `, ${r.failed} ei onnistunut (ne vanhenevat pankissa itsestään)` : ""}.`);
    return 0;
  }
  console.error(`Tuntematon komento: ${command}`);
  return 1;
}
