/** Sessions on the command line (cli-sessions.ts): who is signed in, one member signed out, everyone signed out. */
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { COMMANDS } from "../src/cli-usage.ts";
import { setupApp } from "./helpers.ts";

type App = Awaited<ReturnType<typeof setupApp>>;

const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

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

/** aino (admin) signed in on the setup browser and on an iPhone, anna (member) on the browser she joined with and on Firefox. */
async function household() {
  const t = await setupApp();
  const phone = t.client();
  expect((await phone.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, { "User-Agent": SAFARI_IPHONE })).status).toBe(200);
  const anna = await t.member("anna");
  const laptop = t.client();
  expect((await laptop.call("POST", "/api/auth/login", { username: "anna", password: "anna-uusi-salasana" }, { "User-Agent": FIREFOX_LINUX })).status).toBe(200);
  return { t, phone, anna, laptop };
}

const signedIn = async (c: { call: App["admin"]["call"] }) => (await c.call("GET", "/api/auth/state")).body.user?.username ?? null;

describe("command line: sessions", () => {
  it("sessions list prints one line for each live session, with no token and no hash", async () => {
    const { t, phone, laptop } = await household();
    const stored = await t.db.all<{ id: string; last_seen_at: string }>("SELECT id, last_seen_at FROM sessions", []);
    expect(stored.length).toBe(4);
    const r = await run(t, "sessions", "list");
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    const lines = r.out.split("\n").map((l) => l.trim().split(/\s{2,}|(?<=^\S+) /).map((w) => w.trim()));
    expect(lines.map(([user, device]) => `${user}: ${device}`).sort()).toEqual(["aino: Safari, iOS", "aino: Tuntematon laite", "anna: Firefox, Linux", "anna: Tuntematon laite"]);
    for (const line of r.out.split("\n")) expect(stored.some((x) => line.endsWith(` ${x.last_seen_at}`))).toBe(true);
    for (const { id } of stored) expect(r.out).not.toContain(id.slice(0, 8));
    for (const c of [t.admin, phone, laptop]) expect(r.out).not.toContain(c.cookie.split("=")[1]!.slice(0, 8));
    // listing ends nothing
    expect(await signedIn(laptop)).toBe("anna");
  });

  it("sessions list leaves out a session past its end", async () => {
    const { t } = await household();
    await t.db.run("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE user_agent = ?", [FIREFOX_LINUX]);
    const r = await run(t, "sessions", "list");
    expect(r.out.split("\n").length).toBe(3);
    expect(r.out).not.toContain("Firefox");
  });

  it("sessions revoke signs one member out everywhere and leaves the others in", async () => {
    const { t, phone, anna, laptop } = await household();
    const r = await run(t, "sessions", "revoke", "aino");
    expect(r.code).toBe(0);
    expect(r.out).toBe("Signed out 2 sessions of aino. They sign in again with their username and password.");
    for (const c of [t.admin, phone]) {
      const state = await c.call("GET", "/api/auth/state");
      expect(state.status).toBe(200);
      expect(state.body.user).toBeNull();
    }
    expect(await signedIn(anna)).toBe("anna");
    expect(await signedIn(laptop)).toBe("anna");
    const events = await t.s.security.list({ kind: "session_revoked", limit: 5 });
    expect(events.length).toBe(1);
    expect(events[0]!.username).toBe("aino");
    expect(events[0]!.detail).toContain("komentorivi");
    expect(events[0]!.detail).toContain("Kirjaudu uudelleen käyttäjätunnuksella ja salasanalla");
    // the password stays: aino signs in again with the old one
    expect((await t.admin.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" })).status).toBe(200);
    expect(await signedIn(t.admin)).toBe("aino");
  });

  it("sessions revoke refuses an unknown user, a missing name and a stray word, and ends nothing", async () => {
    const { t, laptop } = await household();
    const unknown = await run(t, "sessions", "revoke", "ghost");
    expect(unknown).toEqual({ code: 1, out: "", err: "User ghost not found." });
    expect(await run(t, "sessions", "revoke")).toEqual({ code: 1, out: "", err: "Give a username." });
    expect((await run(t, "sessions", "revoke", "anna", "aino")).code).toBe(1);
    expect((await run(t, "sessions", "list", "anna")).code).toBe(1);
    expect(await signedIn(laptop)).toBe("anna");
    expect(await signedIn(t.admin)).toBe("aino");
    expect((await t.s.security.list({ kind: "session_revoked", limit: 5 })).length).toBe(0);
  });

  it("sessions revoke-all works as before", async () => {
    const { t, anna } = await household();
    const r = await run(t, "sessions", "revoke-all");
    expect(r).toEqual({ code: 0, out: "Signed out 4 sessions. Everyone has to sign in again.", err: "" });
    expect((await t.admin.call("GET", "/api/auth/state")).body.user).toBeNull();
    expect((await anna.call("GET", "/api/auth/state")).body.user).toBeNull();
    const events = await t.s.security.list({ kind: "session_revoked", limit: 5 });
    expect(events.map((e) => e.detail)).toEqual(["kaikki (komentorivi)"]);
  });

  it("both commands are in the usage list", async () => {
    const { t } = await household();
    expect(COMMANDS).toContain("sessions list");
    expect(COMMANDS).toContain("sessions revoke <username>");
    const help = (await run(t, "help")).out.split("\n");
    expect(help).toContain("sessions list");
    expect(help).toContain("sessions revoke <username>");
    expect(help).toContain("sessions revoke-all");
  });
});
