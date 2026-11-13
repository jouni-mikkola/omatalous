/** Every word of a command line has to fit (readWords in cli-args.ts): a command with a stray word does nothing. */
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { createServiceToken } from "../src/services/service-tokens.ts";
import { NOW, setupApp } from "./helpers.ts";

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

/** The household aino (admin) with these members signed in, and one service token of aino's. */
async function household(...members: string[]): Promise<App> {
  const t = await setupApp();
  for (const name of members) await t.member(name);
  await createServiceToken(t.s, { username: "aino", name: "kotiskripti" });
  return t;
}

/** What a refused command must leave alone: `user list`, the sessions and `service-token list`. */
async function state(t: App): Promise<{ users: string; sessions: unknown[]; tokens: string }> {
  return {
    users: (await run(t, "user", "list")).out,
    sessions: await t.db.all("SELECT id, user_id FROM sessions ORDER BY id", []),
    tokens: (await run(t, "service-token", "list")).out,
  };
}

const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("command line: a stray word stops the command", () => {
  // the command, the word stderr names, and the members the household has beside aino
  const refused: [string[], string, string[]][] = [
    [["user", "create", "anna", "--admn"], "--admn", []],
    [["user", "create", "bob", "--name", "--admin"], "--admin", []],
    [["user", "delete", "anna", "--help"], "--help", ["anna"]],
    [["user", "delete", "bob", "carl"], "carl", ["bob", "carl"]],
    [["user", "reset-password", "anna", "--help"], "--help", ["anna"]],
    [["sessions", "revoke-all", "--help"], "--help", ["anna"]],
    [["service-token", "list", "extra"], "extra", []],
    [["service-token", "create", "aino", "--name", "x", "--dayz", "5"], "--dayz", []],
    [["service-token", "create", "aino", "--name", "x", "--days"], "--days", []],
    [["service-token", "create", "aino", "bob", "--name", "x"], "bob", ["bob"]],
  ];

  it.each(refused)("%j exits 1, names %s and changes nothing", async (words, named, members) => {
    const t = await household(...members);
    const before = await state(t);
    const r = await run(t, ...words);
    expect(r.code).toBe(1);
    expect(r.err).toContain(named);
    // no password, token or "Deleted" line: the command said only what is wrong
    expect(r.out).toBe("");
    expect(await state(t)).toEqual(before);
    expect(before.sessions).toHaveLength(members.length + 1);
    // the password is the one the member chose, so no reset went through
    for (const name of members) {
      expect((await t.client().call("POST", "/api/auth/login", { username: name, password: `${name}-uusi-salasana` })).status).toBe(200);
    }
  });
});

describe("command line: the flags of user create stand on either side of the username", () => {
  it.each([
    [["user", "create", "--admin", "carl", "--name", "Carl C"], "Carl C"],
    [["user", "create", "carl", "--name", "Carl C", "--admin"], "Carl C"],
    // `--admin` is never the username: the user is the plain word after it
    [["user", "create", "--admin", "carl"], "carl"],
  ])("%j creates the admin carl", async (words, displayName) => {
    const t = await setupApp();
    const r = await run(t, ...words);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Created admin carl.");
    expect((await t.s.users.list()).map((u) => [u.username, u.role, u.displayName])).toEqual(
      expect.arrayContaining([["carl", "admin", displayName]]),
    );
    expect((await t.s.users.list()).map((u) => u.username).sort()).toEqual(["aino", "carl"]);
  });
});

describe("command line: a command with only its own words works as before", () => {
  it.each([[["user", "create", "anna"]], [["user", "create", "anna", "--name"]]])("%j creates the member anna", async (words) => {
    const t = await setupApp();
    const r = await run(t, ...words);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Created user anna.");
    expect(r.out).toContain("Temporary password: ");
    expect((await t.s.users.list()).map((u) => [u.username, u.role, u.displayName])).toEqual(expect.arrayContaining([["anna", "member", "anna"]]));
  });

  it("user list, reset-password, remove-factor and delete", async () => {
    const t = await household("anna");
    const anna = (await t.s.users.findForLogin("anna"))!;
    expect((await run(t, "user", "list")).out).toMatch(/^anna\s+member\s+anna$/m);

    const reset = await run(t, "user", "reset-password", "anna");
    expect(reset.code).toBe(0);
    const temporary = /^New temporary password for anna: (\S+)$/.exec(reset.out)![1]!;
    expect((await t.client().call("POST", "/api/auth/login", { username: "anna", password: temporary })).status).toBe(200);

    // without a factor the command refuses as it did, with one it takes it away
    const none = await run(t, "user", "remove-factor", "anna");
    expect([none.code, none.err]).toEqual([1, "anna has no second sign-in factor."]);
    await t.s.factors.enable(anna.id, "sealed", 1, [], NOW.toISOString());
    const removed = await run(t, "user", "remove-factor", "anna");
    expect(removed.code).toBe(0);
    expect(removed.out).toContain("Removed the second sign-in factor");
    expect(await t.s.factors.hasTotp(anna.id)).toBe(false);

    const deleted = await run(t, "user", "delete", "anna");
    expect(deleted.code).toBe(0);
    expect(deleted.out).toContain("Deleted anna and all their data.");
    expect(await t.s.users.findForLogin("anna")).toBeNull();
    // an unknown user and a missing username are refused in their old words, an unknown command with the lines of its group after it
    expect((await run(t, "user", "delete", "anna")).err).toBe("User anna not found.");
    expect((await run(t, "user", "delete")).err).toBe("Give a username.");
    expect((await run(t, "user", "frobnicate", "aino")).err).toMatch(/^Unknown command: frobnicate\n/);
  });

  it("sessions revoke-all signs everyone out", async () => {
    const t = await household("anna");
    const r = await run(t, "sessions", "revoke-all");
    expect(r.code).toBe(0);
    expect(r.out).toBe("Signed out 2 sessions. Everyone has to sign in again.");
    expect((await t.admin.call("GET", "/api/meta")).status).toBe(401);
  });

  it.each([
    [["service-token", "create", "aino", "--name", "x"], 30],
    [["service-token", "create", "aino", "--name", "x", "--days", "5"], 5],
    [["service-token", "create", "aino", "--days", "5", "--name", "x"], 5],
  ])("%j makes a token valid for %i days", async (words, valid) => {
    const t = await setupApp();
    const r = await run(t, ...words);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`for aino, read only, valid until ${days(valid)}.`);
    const token = r.out.split("\n").find((l) => l.startsWith("omt_"))!;
    expect((await t.client().call("GET", "/api/meta", undefined, { Authorization: `Bearer ${token}` })).status).toBe(200);
  });

  it("service-token revoke takes an id or --all", async () => {
    const t = await household();
    const { id } = await createServiceToken(t.s, { username: "aino", name: "toinen" });
    const one = await run(t, "service-token", "revoke", id);
    expect([one.code, one.out]).toEqual([0, `Removed service token ${id}.`]);
    expect((await run(t, "service-token", "list")).out).not.toContain(id);
    expect((await run(t, "service-token", "revoke", id)).err).toBe(`No service token ${id}.`);
    const all = await run(t, "service-token", "revoke", "--all");
    expect([all.code, all.out]).toEqual([0, "Removed 1 service tokens."]);
    expect((await run(t, "service-token", "list")).out).toBe("No service tokens.");
    // an id beside --all is a stray word, and no command at all gets the usage
    const both = await run(t, "service-token", "revoke", id, "--all");
    expect([both.code, both.err]).toEqual([1, `Unexpected word: ${id}`]);
    expect((await run(t, "service-token", "revoke")).err).toMatch(/^Usage: service-token /);
    expect((await run(t, "service-token")).err).toMatch(/^Usage: service-token /);
  });
});
