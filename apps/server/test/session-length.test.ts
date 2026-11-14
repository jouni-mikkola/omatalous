import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/platform/config.ts";
import { type Client, NOW, setupApp } from "./helpers.ts";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** An app whose clock the test moves: `at(ms)` sets the time to that long after the sign-in. */
async function appWithClock(env: Record<string, string> = {}) {
  let time = NOW;
  const t = await setupApp(env, undefined, { now: () => time });
  return Object.assign(t, {
    at(ms: number) {
      time = new Date(NOW.getTime() + ms);
      return time;
    },
  });
}

const row = (t: { db: Awaited<ReturnType<typeof setupApp>>["db"] }) => t.db.first<{ last_seen_at: string; expires_at: string }>("SELECT last_seen_at, expires_at FROM sessions");

afterEach(() => vi.restoreAllMocks());

describe("a session in daily use", () => {
  it("gets its cookie again, with the full age, on a request more than an hour after the last use", async () => {
    const t = await appWithClock();
    const signedIn = t.admin.cookie;
    const [name, token] = signedIn.split("=");

    t.at(59 * MINUTE);
    const inside = await t.admin.call("GET", "/api/auth/state");
    expect(inside.body.user).not.toBeNull();
    expect(inside.res.headers.get("set-cookie")).toBeNull();

    t.at(61 * MINUTE);
    const after = await t.admin.call("GET", "/api/auth/state");
    expect(after.body.user).not.toBeNull();
    const parts = (after.res.headers.get("set-cookie") ?? "").split("; ");
    expect(parts[0]).toBe(`${name}=${token}`);
    expect(parts).toContain("HttpOnly");
    expect(parts).toContain("SameSite=Lax");
    expect(parts).toContain(`Max-Age=${30 * 86_400}`);
    expect(parts).toContain("Path=/");

    // that request was a use: the next one inside the hour sets nothing
    t.at(100 * MINUTE);
    expect((await t.admin.call("GET", "/api/auth/state")).res.headers.get("set-cookie")).toBeNull();
  });

  it("has the cookie's age follow SESSION_DAYS", async () => {
    const t = await appWithClock({ SESSION_DAYS: "7" });
    t.at(2 * 60 * MINUTE);
    const r = await t.admin.call("GET", "/api/auth/state");
    expect(r.res.headers.get("set-cookie")).toContain(`Max-Age=${7 * 86_400}`);
  });

  it("is still signed in after 70 days when used every 20 days, by the cookie's age and by the row", async () => {
    const t = await appWithClock();
    let cookieEnds = NOW.getTime() + 30 * DAY; // the sign-in's cookie
    for (const day of [20, 40, 60, 70]) {
      const now = t.at(day * DAY).getTime();
      expect(now, `the browser still has the cookie on day ${day}`).toBeLessThan(cookieEnds);
      const r = await t.admin.call("GET", "/api/auth/state");
      expect(r.body.user, `signed in on day ${day}`).not.toBeNull();
      const maxAge = /Max-Age=(\d+)/.exec(r.res.headers.get("set-cookie") ?? "");
      expect(maxAge, `a new cookie on day ${day}`).not.toBeNull();
      cookieEnds = now + Number(maxAge![1]) * 1000;
      expect((await row(t))!.expires_at).toBe(new Date(now + 30 * DAY).toISOString());
    }
  });

  it("writes the server's clock as the time of the last use", async () => {
    const t = await appWithClock();
    const now = t.at(3 * DAY);
    await t.admin.call("GET", "/api/auth/state");
    expect((await row(t))!.last_seen_at).toBe(t.s.now().toISOString());
    expect((await row(t))!.last_seen_at).toBe(now.toISOString());
  });
});

describe("a logout more than an hour after the last use", () => {
  it("ends with the cookie deleted, after the renewal", async () => {
    const t = await appWithClock();
    const name = t.admin.cookie.split("=")[0]!;
    t.at(2 * 60 * MINUTE);
    const r = await t.admin.call("POST", "/api/auth/logout");
    const cookies = r.res.headers.getSetCookie().filter((c) => c.startsWith(`${name}=`));
    expect(cookies.at(-1)).toMatch(new RegExp(`^${name}=;`));
    expect(cookies.at(-1)).toContain("Max-Age=0");
    expect(await row(t)).toBeFalsy();
  });
});

describe("GET /api/security/sessions", () => {
  it("leaves out a session whose end has passed while its row is still there", async () => {
    const t = await appWithClock();
    const other = t.client();
    expect((await other.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" })).status).toBe(200);
    expect((await t.admin.call("GET", "/api/security/sessions")).body.sessions).toHaveLength(2);

    t.at(20 * DAY);
    await t.admin.call("GET", "/api/auth/state"); // only the first browser comes back
    t.at(35 * DAY);
    const list = (await t.admin.call("GET", "/api/security/sessions")).body.sessions;
    expect(list).toHaveLength(1);
    expect(list[0].current).toBe(true);
    expect((await t.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM sessions"))!.c).toBe(2);
  });
});

describe("a sign-in from a device that signed in before", () => {
  const agent = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0" };
  const signIn = (c: Client) => c.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, agent);
  const count = (t: { db: Awaited<ReturnType<typeof setupApp>>["db"] }) => t.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM sessions").then((r) => r!.c);

  it("replaces the session its own cookie names", async () => {
    const t = await appWithClock();
    const browser = t.client();
    expect((await signIn(browser)).status).toBe(200);
    expect(await count(t)).toBe(2);
    expect((await signIn(browser)).status).toBe(200);
    expect(await count(t)).toBe(2);
  });

  it("replaces a session of the same user agent that was not used for a day, and keeps one in use", async () => {
    const t = await appWithClock();
    await signIn(t.client());
    t.at(2 * DAY);
    const inUse = t.client();
    await signIn(inUse);
    expect(await count(t)).toBe(2); // the first browser's sign-in is gone, the admin's own (no user agent) stays
    t.at(2 * DAY + 2 * MINUTE);
    await signIn(t.client());
    expect(await count(t)).toBe(3); // the one two minutes old is a device in use
    expect((await inUse.call("GET", "/api/auth/state")).body.user).not.toBeNull();
  });

  it("leaves the sessions of other user agents and of other members alone", async () => {
    const t = await appWithClock();
    await t.client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, { "User-Agent": "Safari/17" });
    await t.member("ville");
    t.at(2 * DAY);
    await signIn(t.client());
    expect(await count(t)).toBe(4);
  });
});

describe("SESSION_DAYS", () => {
  it("is taken as a whole number from 1 to 365", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(loadConfig({}).sessionDays).toBe(30);
    expect(loadConfig({ SESSION_DAYS: "1" }).sessionDays).toBe(1);
    expect(loadConfig({ SESSION_DAYS: "90" }).sessionDays).toBe(90);
    expect(loadConfig({ SESSION_DAYS: "365" }).sessionDays).toBe(365);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["30abc", "0", "1.5", "100000000", "366", "-5"])("warns about %s by the setting's name and uses 30", (value) => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(loadConfig({ SESSION_DAYS: value }).sessionDays).toBe(30);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("SESSION_DAYS");
  });

  it("lets a member sign in whatever the setting says", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setupApp({ SESSION_DAYS: "100000000" }); // throws when the sign-in answers 500
    expect((await t.admin.call("GET", "/api/auth/state")).body.user).not.toBeNull();
  });
});
