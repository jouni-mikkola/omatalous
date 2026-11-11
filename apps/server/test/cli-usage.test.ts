/** Help for the command line (cli-usage.ts): the list on request, and the lines of its own group for a command that does not exist. */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { COMMANDS } from "../src/cli-usage.ts";
import { setupApp } from "./helpers.ts";

type App = Awaited<ReturnType<typeof setupApp>>;

/** One command: its exit status, and what it wrote to stdout and stderr. */
async function run(t: App, ...words: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  try {
    return { code: await runCli(t.s, words), out: out.join("\n"), err: err.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

/** The commands the header comment of cli.ts names: what follows `node dist/node.js`, without the note in brackets. */
function headerCommands(): string[] {
  const source = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
  const header = source.slice(0, source.indexOf("*/"));
  return [...header.matchAll(/node dist\/node\.js (.+)$/gm)].map((m) => (m[1] ?? "").split(/\s{2,}\(/)[0]!.trim());
}

const USER_LINES = [
  "user create <username> [--admin] [--name \"Name\"]",
  "user reset-password <username>",
  "user remove-factor <username>",
  "user list",
  "user delete <username>",
];

describe("command line: help", () => {
  it("the header comment of cli.ts and the list name the same commands", () => {
    expect(headerCommands().length).toBeGreaterThan(10);
    expect([...COMMANDS]).toEqual(headerCommands());
  });

  it.each(["help", "--help", "-h"])("%s exits 0 with every command on stdout, one to a line", async (word) => {
    const t = await setupApp();
    const r = await run(t, word);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out.split("\n")).toEqual(headerCommands());
  });
});

describe("command line: a command that does not exist", () => {
  // the command, the word stderr names (the group when it stands alone), and the lines of its group
  const refused: [string[], string, string[]][] = [
    [["sessions", "frobnicate"], "frobnicate", ["sessions list", "sessions revoke <username>", "sessions revoke-all"]],
    [["address", "show"], "show", ["address set <url>"]],
    [["secret"], "secret", ["secret rotate", "secret check <file>"]],
    [["user", "frobnicate", "ghost"], "frobnicate", USER_LINES],
    [["user", "frobnicate"], "frobnicate", USER_LINES],
    [["user"], "user", USER_LINES],
  ];

  it.each(refused)("%j exits 1 with only the lines of its group on stderr", async (words, named, lines) => {
    const t = await setupApp();
    const r = await run(t, ...words);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err.split("\n")).toEqual([`Unknown command: ${named}`, ...lines]);
  });

  it("an unknown group exits 1 with the whole list on stderr", async () => {
    const t = await setupApp();
    const r = await run(t, "frobnicate", "now");
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err.split("\n")).toEqual(["Unknown command: frobnicate", ...COMMANDS]);
    const none = await run(t);
    expect(none.code).toBe(1);
    expect(none.out).toBe("");
    expect(none.err.split("\n")).toEqual([...COMMANDS]);
  });
});

describe("command line: what help leaves as it was", () => {
  it("user list, version and address set answer in their old words", async () => {
    const t = await setupApp();
    const list = await run(t, "user", "list");
    expect(list.code).toBe(0);
    expect(list.out).toBe(`${"aino".padEnd(20)} ${"admin".padEnd(7)} ${(await t.s.users.list())[0]!.displayName}`);
    const version = await run(t, "version");
    expect(version).toEqual({ code: 0, out: `${t.s.build.version} (${t.s.build.id})`, err: "" });
    // install.sh restarts the app only when the output has " is now "
    const set = await run(t, "address", "set", "https://raha.example.com");
    expect(set).toEqual({ code: 0, out: "App address is now https://raha.example.com.", err: "" });
    const again = await run(t, "address", "set", "https://raha.example.com");
    expect(again).toEqual({ code: 0, out: "App address is already https://raha.example.com.", err: "" });
  });

  it("ops and service-token keep their own usage lines", async () => {
    const t = await setupApp();
    const ops = await run(t, "ops");
    expect(ops.code).toBe(1);
    expect(ops.err).toBe("Usage: ops poll [--dry] --helper <version> --done <ids> | ops report | ops progress | ops state | ops access --helper <version> | ops offsite --helper <version>");
    const token = await run(t, "service-token");
    expect(token.code).toBe(1);
    expect(token.err).toBe("Usage: service-token create <username> --name <name> [--days <1-90>] | service-token list | service-token revoke <id>|--all");
  });
});
