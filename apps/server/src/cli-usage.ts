/** The commands of the command line, one to a line: what `help` prints, and what a command that does not exist is answered with. */

/** Every command as the header comment of cli.ts names it. The first word of a line is its group. */
export const COMMANDS: readonly string[] = [
  "setup-code",
  "version",
  "user create <username> [--admin] [--name \"Name\"]",
  "user reset-password <username>",
  "user remove-factor <username>",
  "user list",
  "user delete <username>",
  "sessions list",
  "sessions revoke <username>",
  "sessions revoke-all",
  "restore <file in /data>",
  "migrate-check <database file>",
  "cloudflare up|down --name <copy> --hostname <host>",
  "secret rotate",
  "secret check <file>",
  "address set <url>",
  "ops poll|report|state",
  "service-token create|list|revoke",
];

/** The words that ask for the list. */
export const HELP_WORDS: readonly string[] = ["help", "--help", "-h"];

/**
 * Refuses a command that does not exist: `Unknown command` with the word that fits nothing (the group when the group
 * does not exist or stands alone), and then the lines of the group, or the whole list for a group that does not
 * exist, all on stderr. Always 1, the exit status.
 */
export function refuseUnknown(group?: string, command?: string): number {
  const own = COMMANDS.filter((line) => line.split(" ")[0] === group);
  const word = own.length ? (command ?? group) : group;
  if (word !== undefined) console.error(`Unknown command: ${word}`);
  for (const line of own.length ? own : COMMANDS) console.error(line);
  return 1;
}
