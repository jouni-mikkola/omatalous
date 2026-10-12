import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { runCli } from "../src/cli.ts";
import { openDatabase } from "../src/db/open.ts";
import { loadConfig } from "../src/platform/config.ts";
import { ensureSetupCode } from "../src/services/users.ts";

const START = new Date("2026-10-12T08:00:00Z");
const HOUR = 3_600_000;
const ENV = { PASSWORD_ITERATIONS: "1000", APP_SECRET: "test-secret-that-is-long-enough-0123456789", APP_BASE_URL: "http://localhost:8080", INDUSTRY_LOOKUP: "false" };
// both sentences send the reader to the same command
const NEW_CODE = "Uuden saa komennolla docker compose exec banking node dist/node.js setup-code";
const EXPIRED = `Asennuskoodi on vanhentunut. ${NEW_CODE}`;
const WRONG = `Väärä asennuskoodi. ${NEW_CODE}`;
const OK = { status: 200, error: null };
/** What the server does at start (entry/node.ts). */
const START_OF_SERVER = { renewExpired: true };

// A setup code is a secret, also in a test log: a code is never the subject of an expect(), which would print it
// when it fails. These answer true or false instead.
const isCode = (code: string | null) => /^\w{4}-\w{4}-\w{4}-\w{4}$/.test(code ?? "");

/** An app with no users and a clock the test moves. */
async function bareApp(env: Record<string, string> = {}) {
  const { db } = await openDatabase(":memory:");
  let now = START;
  const app = createApp({ db, config: loadConfig({ ...ENV, ...env }), now: () => now });
  const s = app.services;
  const call = (method: string, path: string, payload?: unknown) =>
    app.request(`http://localhost:8080${path}`, { method, headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  /** Tries to create the first admin with `code`. */
  const setup = async (code: string) => {
    const res = await call("POST", "/api/auth/setup", { code, username: "aino", displayName: "Aino", password: "aino-salasana-123" });
    return { status: res.status, error: ((await res.json()) as { error?: string }).error ?? null };
  };
  /** Runs `setup-code` and returns the line it prints, which stays out of the test output. */
  const cliCode = async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runCli(s, ["setup-code"])).toBe(0);
      return String(log.mock.calls.at(-1)?.[0] ?? "");
    } finally {
      log.mockRestore();
    }
  };
  const pass = (hours: number) => {
    now = new Date(now.getTime() + hours * HOUR);
  };
  return { s, call, setup, cliCode, pass };
}

describe("setup code lifetime", () => {
  it("works 23 hours after it was made and is refused after 25", async () => {
    const early = await bareApp();
    const code = await early.cliCode();
    expect(isCode(code)).toBe(true);
    early.pass(23);
    expect(await early.setup(code)).toEqual(OK);

    const late = await bareApp();
    const old = await late.cliCode();
    late.pass(25);
    expect(await late.setup(old)).toEqual({ status: 400, error: EXPIRED });
    // a wrong code is told the same: no code works now
    expect(await late.setup("ihan-vaara-koodi")).toEqual({ status: 400, error: EXPIRED });
    expect(await late.s.users.count()).toBe(0);
  });

  it("setup-code makes a new code that works, and the old one stays refused", async () => {
    const app = await bareApp();
    const old = await app.cliCode();
    app.pass(25);
    const fresh = await app.cliCode();
    expect(isCode(fresh)).toBe(true);
    expect(fresh === old).toBe(false);
    expect(await app.setup(old)).toEqual({ status: 400, error: WRONG });
    expect(await app.setup(fresh)).toEqual(OK);
    // the first account ends the code: nothing of it is kept
    expect(await app.s.settings.get("setup_code_hash")).toBeNull();
    expect(await app.s.settings.get("setup_code_at")).toBeNull();
  });

  it("the start makes a missing code, leaves a fresh one alone and replaces an expired one", async () => {
    const app = await bareApp();
    const first = await ensureSetupCode(app.s, START_OF_SERVER);
    expect(isCode(first)).toBe(true);
    app.pass(23);
    expect((await ensureSetupCode(app.s, START_OF_SERVER)) === null).toBe(true);
    app.pass(2);
    const second = await ensureSetupCode(app.s, START_OF_SERVER);
    expect(isCode(second)).toBe(true);
    expect(second === first).toBe(false);
    expect(await app.setup(first!)).toEqual({ status: 400, error: WRONG });
    expect(await app.setup(second!)).toEqual(OK);
  });

  it("the start replaces a hash that has no time, from an install before this release", async () => {
    const app = await bareApp();
    const old = await app.cliCode();
    await app.s.settings.delete("setup_code_at");
    // until the next start the old code is refused as expired
    expect(await app.setup(old)).toEqual({ status: 400, error: EXPIRED });
    const fresh = await ensureSetupCode(app.s, START_OF_SERVER);
    expect(isCode(fresh)).toBe(true);
    expect(fresh === old).toBe(false);
    expect(await app.setup(fresh!)).toEqual(OK);
  });

  it("a request leaves an expired code in place, so the person who types it is told it expired", async () => {
    const app = await bareApp();
    const old = await app.cliCode();
    app.pass(25);
    // the page asks for the state before it shows the form
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect((await app.call("GET", "/api/auth/state")).status).toBe(200);
      expect(log.mock.calls.length).toBe(0);
    } finally {
      log.mockRestore();
    }
    expect(await app.setup(old)).toEqual({ status: 400, error: EXPIRED });
  });

  it("a time the clock cannot have given counts as expired, a clock set back a little does not", async () => {
    const app = await bareApp();
    const code = await app.cliCode();
    await app.s.settings.set("setup_code_at", new Date(START.getTime() + 72 * HOUR).toISOString());
    expect(await app.setup(code)).toEqual({ status: 400, error: EXPIRED });
    await app.s.settings.set("setup_code_at", "eilen");
    expect(await app.setup(code)).toEqual({ status: 400, error: EXPIRED });
    await app.s.settings.set("setup_code_at", new Date(START.getTime() + HOUR).toISOString());
    expect(await app.setup(code)).toEqual(OK);
  });

  it("a code from .env works after a week, and the start makes no other", async () => {
    const own = "oma-asennuskoodi-0001";
    const app = await bareApp({ SETUP_CODE: own });
    app.pass(7 * 24);
    expect((await ensureSetupCode(app.s, START_OF_SERVER)) === null).toBe(true);
    expect(await app.s.settings.get("setup_code_hash")).toBeNull();
    expect(await app.setup(own)).toEqual(OK);
  });

  it("an expired code is counted by the limiter like a wrong one", async () => {
    const app = await bareApp();
    const old = await app.cliCode();
    app.pass(25);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await app.setup(old)).status);
    expect(statuses).toEqual([...Array<number>(10).fill(400), 429]);
    // a new code does not open the door either until the window ends
    expect((await app.setup(await app.cliCode())).status).toBe(429);
  });
});
