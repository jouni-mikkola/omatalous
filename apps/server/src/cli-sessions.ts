/**
 * Sessions on the command line, run inside the container:
 *   node dist/node.js sessions list              (one line for each live session: user, device, last seen)
 *   node dist/node.js sessions revoke <username> (signs one member out everywhere, the password stays)
 *   node dist/node.js sessions revoke-all        (signs everyone out)
 * After a lost phone the host ends the sessions of one member, without a new password for them or a sign-out for the rest.
 */
import { readWords, type Takes } from "./cli-args.ts";
import { refuseUnknown } from "./cli-usage.ts";
import type { Services } from "./services/context.ts";
import { deviceLabel, recordEvent } from "./services/security.ts";

/** The words each `sessions` command takes after its name. */
const SESSIONS_TAKES = new Map<string, Takes>([
  ["list", {}],
  ["revoke", { plain: 1 }],
  ["revoke-all", {}],
]);

export async function runSessionsCli(s: Services, args: string[]): Promise<number> {
  const [command, ...words] = args;
  const takes = command ? SESSIONS_TAKES.get(command) : undefined;
  if (!takes) return refuseUnknown("sessions", command);
  const { plain: [username], stray } = readWords(words, takes);
  if (stray) {
    console.error(stray);
    return 1;
  }
  if (command === "list") {
    // a session past its end is not live: it goes before the list is read
    await s.users.deleteExpiredSessions(s.now());
    for (const u of await s.users.list()) {
      // the device and the time only: the id of a session is the hash of its cookie and stays out of the output
      for (const x of await s.users.listSessions(u.id, undefined, s.now())) console.log(`${u.username.padEnd(20)} ${deviceLabel(x.userAgent).padEnd(20)} ${x.lastSeenAt}`);
    }
    return 0;
  }
  if (command === "revoke-all") {
    const n = await s.users.deleteAllSessions();
    await recordEvent(s, { kind: "session_revoked", detail: "kaikki (komentorivi)" });
    console.log(`Signed out ${n} sessions. Everyone has to sign in again.`);
    return 0;
  }
  // `revoke` is the one command of SESSIONS_TAKES left
  if (!username) {
    console.error("Give a username.");
    return 1;
  }
  const record = await s.users.findForLogin(username);
  if (!record) {
    console.error(`User ${username} not found.`);
    return 1;
  }
  const n = (await s.users.listSessions(record.id, undefined, s.now())).length;
  await s.users.deleteSessionsOf(record.id);
  await recordEvent(s, { kind: "session_revoked", userId: record.id, detail: "kaikki (komentorivi). Kirjaudu uudelleen käyttäjätunnuksella ja salasanalla." });
  console.log(`Signed out ${n} sessions of ${username}. They sign in again with their username and password.`);
  return 0;
}
