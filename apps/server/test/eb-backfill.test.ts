/**
 * The backfill: a card whose long first window the bank refused has its history taken in windows of 12 months by a fetch
 * the member starts, once a month. Made-up data.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { addDays } from "@banking/core";
import { describe, expect, it } from "vitest";
import { accountsAtLimit } from "../src/connectors/bank-limit.ts";
import { syncUser } from "../src/connectors/sync.ts";
import { accountKey } from "../src/db/household-repo.ts";
import type { UserHeaders } from "../src/connectors/types.ts";
import { NOW, setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
/** The member is at the screen: the headers the bank wants come with the request. */
const ATTENDED: UserHeaders = () => ({ "Psu-Ip-Address": "203.0.113.7" });

/** The windows of 360 days the walk asks from `to` back to the reach of five years, empty or not; it stops within 31 days of the reach. */
function windows(to: string, today: string): [string, string][] {
  const wide = addDays(today, -1825);
  const out: [string, string][] = [];
  for (let end = to; end > addDays(wide, 31) && out.length < 6; end = out.at(-1)![0]) {
    const from = addDays(end, -360);
    out.push([from < wide ? wide : from, end]);
  }
  return out;
}

/** Nordea as the audit saw it: a card request spans 12 months at most, and the bank holds a year and a half more than that. */
async function linked(env: Record<string, string> = {}) {
  const bank = mockBank();
  bank.cardMaxDays = 366;
  bank.cardOlder = [
    { id: "o1", date: "2025-01-10" },
    { id: "o2", date: "2025-03-01" },
    { id: "o3", date: "2025-12-01" },
  ];
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem, ...env }, bank.fetchMock);
  await app.admin.call("POST", "/api/connections/start", {});
  await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
  await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  const card = async () => (await app.s.finance(app.adminId).listAccounts()).find((a) => a.externalId === "u-card")!;
  const asks = () => bank.calls.filter((c) => c.startsWith("GET /accounts/u-card/transactions")).map((c) => Object.fromEntries(new URLSearchParams(c.split("?")[1])));
  const days = async () => (await app.db.all<{ d: string }>("SELECT booking_date AS d FROM transactions WHERE account_id = ? ORDER BY booking_date", [(await card()).id])).map((r) => r.d);
  const history = async () => (await app.db.all<{ asked_from: string; source: string }>("SELECT asked_from, source FROM account_history WHERE account_id = ?", [(await card()).id]))[0];
  return { bank, ...app, card, asks, days, history };
}

describe("backfill of a card's history", () => {
  it("records the window the bank answered for, not the one that was wanted", async () => {
    const f = await linked();
    const today = f.s.today();
    // 730 days was refused, 360 was answered
    expect(f.asks().map((a) => a.date_from)).toEqual([addDays(today, -730), addDays(today, -360)]);
    expect(f.asks()[0]).toMatchObject({ strategy: "longest" });
    expect(await f.history()).toEqual({ asked_from: addDays(today, -360), source: "default" });
    // the bare connect fetch had no member's headers: nothing was asked beyond that
    expect(await f.days()).toEqual(["2025-12-01", "2026-09-12", "2026-10-05", "2026-10-08"]);
  });

  it("asks the days before the first window in windows of 12 months when the member starts a fetch, and then rests for a month", async () => {
    const f = await linked();
    const today = f.s.today();
    f.bank.calls.length = 0;
    await syncUser(f.s, f.adminId, "manual", ATTENDED);
    const [ordinary, ...back] = f.asks();
    expect(ordinary!.date_to).toBeUndefined();
    // each window ends where the one before began and goes back 360 days; windows without a row do not end the walk, the reach of five years does
    expect(back.map((a) => [a.date_from, a.date_to])).toEqual([
      [addDays(today, -720), addDays(today, -360)],
      [addDays(today, -1080), addDays(today, -720)],
      [addDays(today, -1440), addDays(today, -1080)],
      [addDays(today, -1800), addDays(today, -1440)],
    ]);
    expect(await f.days()).toEqual(["2025-01-10", "2025-03-01", "2025-12-01", "2026-09-12", "2026-10-05", "2026-10-08"]);
    expect((await f.history())!.asked_from).toBe(addDays(today, -1800));
    // asked again a month on, nothing is asked beyond the ordinary window
    f.bank.calls.length = 0;
    await syncUser(f.s, f.adminId, "manual", ATTENDED);
    expect(f.asks()).toHaveLength(1);
    expect(await f.days()).toHaveLength(6);
  });

  it("goes on window by window to the history limit when only 89 days were answered at first", async () => {
    const bank = mockBank();
    bank.cardMaxDays = 366;
    bank.cardOldest = "2026-06-01"; // the consent is no longer fresh: the bank gives 90 days
    bank.cardOlder = [{ id: "o3", date: "2025-12-01" }, { id: "o2", date: "2025-03-01" }, { id: "o1", date: "2025-01-10" }, { id: "o0", date: "2024-02-02" }];
    const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await app.admin.call("POST", "/api/connections/start", {});
    await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    const today = app.s.today();
    const card = (await app.s.finance(app.adminId).listAccounts()).find((a) => a.externalId === "u-card")!;
    const asks = () => bank.calls.filter((c) => c.startsWith("GET /accounts/u-card/transactions")).map((c) => Object.fromEntries(new URLSearchParams(c.split("?")[1])));
    expect(asks().map((a) => a.date_from)).toEqual([addDays(today, -730), addDays(today, -360), addDays(today, -89)]);
    bank.cardOldest = null;
    bank.calls.length = 0;
    await syncUser(app.s, app.adminId, "connect", ATTENDED);
    const back = asks().filter((a) => a.date_to);
    // each window ends where the one before began, the last at the backfill's reach (five years)
    expect(back.map((a) => [a.date_from, a.date_to])).toEqual([
      [addDays(today, -449), addDays(today, -89)],
      [addDays(today, -809), addDays(today, -449)],
      [addDays(today, -1169), addDays(today, -809)],
      [addDays(today, -1529), addDays(today, -1169)],
      [addDays(today, -1825), addDays(today, -1529)],
    ]);
    const days = (await app.db.all<{ d: string }>("SELECT booking_date AS d FROM transactions WHERE account_id = ? ORDER BY booking_date", [card.id])).map((r) => r.d);
    expect(days.slice(0, 4)).toEqual(["2024-02-02", "2025-01-10", "2025-03-01", "2025-12-01"]);
    expect((await app.db.all<{ asked_from: string }>("SELECT asked_from FROM account_history WHERE account_id = ?", [card.id]))[0]!.asked_from).toBe(addDays(today, -1825));
  });

  it("also fills a card whose record, written before the fallback was recorded, says the longest history was asked", async () => {
    const f = await linked();
    await f.db.run("UPDATE account_history SET source = 'longest', asked_from = ? WHERE account_id = ?", [addDays(f.s.today(), -730), (await f.card()).id]);
    await syncUser(f.s, f.adminId, "manual", ATTENDED);
    expect((await f.days())[0]).toBe("2025-01-10");
  });

  it("leaves a background fetch and an open alone", async () => {
    const f = await linked();
    f.bank.calls.length = 0;
    await syncUser(f.s, f.adminId, "schedule");
    await syncUser(f.s, f.adminId, "open", ATTENDED);
    await syncUser(f.s, f.adminId, "open-bare");
    expect(f.asks().filter((a) => a.date_to)).toEqual([]);
  });

  it("asks once before the first row of a longest answer, since Enable Banking's search may stop short, and finds the account whole", async () => {
    const f = await linked();
    f.bank.cardMaxDays = null;
    await f.db.run("UPDATE connections SET last_synced_at = NULL");
    await f.db.run("DELETE FROM transactions WHERE account_id = ?", [(await f.card()).id]);
    f.bank.calls.length = 0;
    await syncUser(f.s, f.adminId, "connect", ATTENDED);
    // the windows before the first row go on to the backfill's reach, empty ones too
    const today = f.s.today();
    expect(f.asks().map((a) => [a.strategy ?? "default", a.date_from, a.date_to])).toEqual([
      ["longest", addDays(today, -730), undefined],
      ...windows("2025-01-10", today).map(([from, to]) => ["default", from, to]),
    ]);
    expect(await f.days()).toEqual(["2025-01-10", "2025-03-01", "2025-12-01", "2026-09-12", "2026-10-05", "2026-10-08"]);
    f.bank.calls.length = 0;
    await syncUser(f.s, f.adminId, "manual", ATTENDED);
    expect(f.asks().filter((a) => a.date_to)).toEqual([]);
  });

  it("fills the days a short longest answer left out in the fetch right after the consent", async () => {
    // the audit's card: the longest history came back with a month, and the bank holds a year more
    const bank = mockBank();
    bank.cardLongestFrom = "2026-09-10";
    bank.cardMaxDays = 366;
    bank.cardOlder = [{ id: "o1", date: "2025-12-01" }, { id: "o2", date: "2026-08-20" }, { id: "o3", date: "2026-09-11" }];
    const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await app.admin.call("POST", "/api/connections/start", {});
    await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    // the member's fetch right after the consent, as the link's own fetch is when the member's headers come with it
    await app.db.run("UPDATE connections SET last_synced_at = NULL");
    await app.db.run("DELETE FROM transactions");
    bank.calls.length = 0;
    await syncUser(app.s, app.adminId, "connect", ATTENDED);
    const today = app.s.today();
    const asks = bank.calls.filter((c) => c.startsWith("GET /accounts/u-card/transactions")).map((c) => Object.fromEntries(new URLSearchParams(c.split("?")[1])));
    expect(asks.map((a) => [a.strategy ?? "default", a.date_from, a.date_to])).toEqual([
      ["longest", addDays(today, -730), undefined],
      ...windows("2026-09-11", today).map(([from, to]) => ["default", from, to]),
    ]);
    const card = (await app.s.finance(app.adminId).listAccounts()).find((a) => a.externalId === "u-card")!;
    const days = (await app.db.all<{ d: string }>("SELECT booking_date AS d FROM transactions WHERE account_id = ? ORDER BY booking_date", [card.id])).map((r) => r.d);
    expect(days).toEqual(["2025-12-01", "2026-08-20", "2026-09-11", "2026-09-12", "2026-10-05", "2026-10-08"]);
  });

  it("takes the 90 days a bank gives without a fresh consent when it refuses the older window", async () => {
    const bank = mockBank();
    bank.cardLongestFrom = "2026-09-10";
    bank.cardOlder = [{ id: "o1", date: "2025-12-01" }, { id: "o2", date: "2026-08-20" }, { id: "o3", date: "2026-09-11" }];
    const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await app.admin.call("POST", "/api/connections/start", {});
    await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    const today = app.s.today();
    // days later the consent is no longer fresh: Nordea answers 90 days
    bank.cardOldest = addDays(today, -89);
    bank.calls.length = 0;
    const run = await syncUser(app.s, app.adminId, "manual", ATTENDED);
    expect(run.status).toBe("ok");
    const back = bank.calls.filter((c) => c.startsWith("GET /accounts/u-card/transactions")).map((c) => Object.fromEntries(new URLSearchParams(c.split("?")[1]))).filter((a) => a.date_to);
    // the refused year, then 360 days, then the 89 days; nothing is asked before them
    expect(back.map((a) => [a.date_from, a.date_to])).toEqual([
      [addDays("2026-09-11", -360), "2026-09-11"],
      [addDays(today, -360), "2026-09-11"],
      [addDays(today, -89), "2026-09-11"],
    ]);
    const card = (await app.s.finance(app.adminId).listAccounts()).find((a) => a.externalId === "u-card")!;
    const days = (await app.db.all<{ d: string }>("SELECT booking_date AS d FROM transactions WHERE account_id = ? ORDER BY booking_date", [card.id])).map((r) => r.d);
    expect(days[0]).toBe("2026-08-20");
  });

  it("is quiet when the bank refuses the older window, and asks again only after a month", async () => {
    const f = await linked();
    f.bank.cardOldest = addDays(f.s.today(), -300);
    f.bank.calls.length = 0;
    const run = await syncUser(f.s, f.adminId, "manual", ATTENDED);
    expect(run.status).toBe("ok");
    expect(f.asks().filter((a) => a.date_to)).toHaveLength(1);
    expect(await f.days()).toEqual(["2025-12-01", "2026-09-12", "2026-10-05", "2026-10-08"]);
    f.bank.calls.length = 0;
    await syncUser(f.s, f.adminId, "manual", ATTENDED);
    expect(f.asks().filter((a) => a.date_to)).toHaveLength(0);
  });

  it("backfills a card whose short longest answer holds only pending rows", async () => {
    const f = await linked();
    f.bank.cardLongestFrom = "2026-10-08"; // only the pending espresso
    f.bank.cardOlder = [{ id: "o1", date: "2026-03-01" }];
    await f.db.run("UPDATE connections SET last_synced_at = NULL");
    await f.db.run("DELETE FROM transactions WHERE account_id = ?", [(await f.card()).id]);
    await syncUser(f.s, f.adminId, "connect", ATTENDED);
    expect(await f.days()).toContain("2026-03-01");
  });

  it("goes on past an empty window: a purchase a year back is found though the months before it are empty", async () => {
    const f = await linked();
    const today = f.s.today();
    f.bank.cardLongestFrom = "2026-10-05";
    f.bank.cardOlder = [{ id: "o1", date: addDays(today, -365) }];
    await f.db.run("UPDATE connections SET last_synced_at = NULL");
    await f.db.run("DELETE FROM transactions WHERE account_id = ?", [(await f.card()).id]);
    await syncUser(f.s, f.adminId, "connect", ATTENDED);
    expect(await f.days()).toContain(addDays(today, -365));
  });

  it("reaches past the 730 days of the first fetch on an existing connection, up to five years, empty windows or not", async () => {
    const f = await linked();
    const today = f.s.today();
    const old = addDays(today, -1000);
    f.bank.cardOlder.push({ id: "o9", date: old });
    f.bank.calls.length = 0;
    await syncUser(f.s, f.adminId, "manual", ATTENDED);
    expect((await f.days())[0]).toBe(old);
    // found in the second window (720-1080 days); the empty ones after it do not end the walk before the five years
    const back = f.asks().filter((a) => a.date_to);
    expect(back.map((a) => a.date_to)).toEqual([addDays(today, -360), addDays(today, -720), addDays(today, -1080), addDays(today, -1440)]);
    expect(back.at(-1)!.date_from).toBe(addDays(today, -1800));
  });
});

describe("backfill on an install used at home", () => {
  const HOUR = 3600_000;
  /** The member is on the home network: the address the server sees is a private one, so no Psu header can be given (psu.ts). */
  const AT_HOME = { "X-Forwarded-For": "192.168.1.20", "User-Agent": "Mozilla/5.0 Esimerkki/1.0" };

  async function home() {
    const f = await linked({ TRUST_PROXY: "true" });
    // the link was made days ago: the day's count starts empty
    await f.db.run("DELETE FROM account_fetch");
    const key = accountKey(await f.card());
    // every Psu header any call to the bank carried
    const psu: string[] = [];
    const inner = f.bank.fetchMock;
    f.bank.fetchMock = ((input: string | URL | Request, init?: RequestInit) => {
      psu.push(...[...new Headers(init?.headers).keys()].filter((name) => name.startsWith("psu-")));
      return inner(input, init);
    }) as typeof fetch;
    const press = () => f.admin.call("POST", "/api/sync", undefined, AT_HOME);
    const back = () => f.asks().filter((a) => a.date_to);
    const notes = async () => (await f.db.all<{ trigger: string }>("SELECT trigger FROM account_fetch WHERE account_key = ? ORDER BY id", [key])).map((r) => r.trigger);
    const nextDay = () => f.db.run("UPDATE account_fetch SET at = ?", [new Date(NOW.getTime() - 25 * HOUR).toISOString()]);
    return { ...f, key, psu, press, back, notes, nextDay };
  }

  it("runs a window of the backfill when Hae nyt comes from a private address, noted and counted as an unattended call", async () => {
    const f = await home();
    const today = f.s.today();
    f.bank.calls.length = 0;
    const r = await f.press();
    expect(r.status).toBe(200);
    // the one window the day has room for: the 12 months before the card's first window
    expect(f.back().map((a) => [a.date_from, a.date_to])).toEqual([[addDays(today, -720), addDays(today, -360)]]);
    expect(await f.days()).toContain("2025-01-10");
    expect(await f.notes()).toEqual(["manual-bare", "backfill-bare"]);
    // the rest of the day is the schedule's: two calls so far, and the two scheduled fetches of 6 and 18 fit
    expect((await accountsAtLimit(f.s, [f.key], "schedule")).size).toBe(0);
    expect((await accountsAtLimit(f.s, [f.key], "backfill-bare")).size).toBe(1);
    // calls were made, and none carried a member header: none is invented for the home network
    expect(f.bank.calls.length).toBeGreaterThan(0);
    expect(f.psu).toEqual([]);
  });

  it("goes on at the next day's Hae nyt from the days already asked, to the reach of five years, and then rests", async () => {
    const f = await home();
    const today = f.s.today();
    const walked: string[] = [];
    for (let day = 0; day < 6; day++) {
      f.bank.calls.length = 0;
      await f.press();
      // a second press the same day makes no window: the day has no room left
      await f.press();
      walked.push(...f.back().map((a) => `${a.date_from}..${a.date_to}`));
      await f.nextDay();
    }
    expect(walked).toEqual([
      `${addDays(today, -720)}..${addDays(today, -360)}`,
      `${addDays(today, -1080)}..${addDays(today, -720)}`,
      `${addDays(today, -1440)}..${addDays(today, -1080)}`,
      `${addDays(today, -1800)}..${addDays(today, -1440)}`,
    ]);
    expect(await f.days()).toEqual(["2025-01-10", "2025-03-01", "2025-12-01", "2026-09-12", "2026-10-05", "2026-10-08"]);
    expect((await f.history())!.asked_from).toBe(addDays(today, -1800));
    // the walk is over: it is not asked again for a month
    expect(await f.s.settings.get(`backfill:${f.key}`)).not.toBeNull();
  });

  it("makes no window when the day's unattended calls leave no room, though Hae nyt itself is made", async () => {
    const f = await home();
    for (let i = 0; i < 3; i++) await f.s.finance(f.adminId).recordFetch(f.key, new Date(NOW.getTime() - HOUR), "schedule");
    f.bank.calls.length = 0;
    await f.press();
    expect(f.asks()).toHaveLength(1);
    expect(f.back()).toEqual([]);
    expect(await f.notes()).toEqual(["schedule", "schedule", "schedule", "manual-bare"]);
    // the walk was cut short by the day, not finished: no month's rest was noted, so the next day goes on
    expect(await f.s.settings.get(`backfill:${f.key}`)).toBeNull();
  });

  it("does not walk on the fetch right after a link, which has spent the new accounts' calls of the day", async () => {
    const f = await linked({ TRUST_PROXY: "true" });
    await f.db.run("DELETE FROM account_fetch");
    f.bank.calls.length = 0;
    await syncUser(f.s, f.adminId, "connect");
    expect(f.asks().filter((a) => a.date_to)).toEqual([]);
  });
});
