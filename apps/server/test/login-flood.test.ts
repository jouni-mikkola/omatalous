import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import type { Services } from "../src/services/context.ts";
import { NOW, setupApp } from "./helpers.ts";

/**
 * A flood of made-up names from many addresses fills a login limiter with locked keys, and a full limiter refuses
 * every new key. These tests fill the limiters the way the flood would, then send real login requests.
 */
const LOGIN = { username: "aino", password: "aino-salasana-123" };
const WRONG = { username: "aino", password: "wrong-password-123" };
const HOME = "192.0.2.10";
const STRANGER = "198.51.100.7";
const from = (address: string) => ({ "CF-Connecting-IP": address });

const LIMIT = { ip: 50, user: 10, name: 30 } as const;
type Which = keyof typeof LIMIT;

/** 10 000 made-up keys, each over its limit, counted the way the route counts an address nobody signed in from. */
function flood(s: Services, which: Which) {
  const limiter = s.loginLimiter[which];
  for (let n = 0; n < 10_000; n++) for (let i = 0; i < LIMIT[which]; i++) limiter.consume(`made-up-${n}`, false);
  // full of locked keys: one more made-up key is refused
  expect(limiter.consume("one-more", false)).toMatchObject({ full: true });
}

function floodAll(s: Services) {
  for (const which of ["ip", "user", "name"] as const) flood(s, which);
}

async function app() {
  const made = await setupApp({ TRUST_PROXY: "true" });
  const login = (address: string, body: { username: string; password: string } = LOGIN) => made.client().call("POST", "/api/auth/login", body, from(address));
  return { ...made, login };
}

describe("a flood of made-up names and the household's own addresses", () => {
  it.each(["ip", "user", "name"] as const)("with the %s limiter full, an address nobody signed in from is refused and a remembered one signs in", async (which) => {
    const { s, login } = await app();
    expect((await login(HOME)).status).toBe(200);
    flood(s, which);
    const stranger = await login(STRANGER);
    expect(stranger.status).toBe(429);
    expect(Number(stranger.res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await login(HOME)).status).toBe(200);
    // the successful login gave its attempts back: nothing of the household's stays in the spares
    expect([s.loginLimiter.ip.spareSize, s.loginLimiter.user.spareSize, s.loginLimiter.name.spareSize]).toEqual([0, 0, 0]);
    // and the stranger is still refused, with the right password
    expect((await login(STRANGER)).status).toBe(429);
  });

  it("with all three full, a remembered address is still limited: 10 wrong passwords for a name, 50 attempts from the address", async () => {
    const { s, login, member } = await app();
    await member("eero");
    const eero = { username: "eero", password: "eero-uusi-salasana" };
    expect((await login(HOME)).status).toBe(200);
    floodAll(s);
    for (let i = 0; i < 10; i++) expect((await login(HOME, WRONG)).status).toBe(401);
    // the 11th is refused before the password is looked at
    expect((await login(HOME)).status).toBe(429);
    // another name from the same address is not locked
    expect((await login(HOME, eero)).status).toBe(200);
    // 10 failures are counted for the address so far. Junk names cost no hash and still count: 40 more reach 50.
    for (let i = 0; i < 40; i++) expect((await login(HOME, { username: `${"x".repeat(65)}${i}`, password: "x" })).status).toBe(401);
    expect((await login(HOME, eero)).status).toBe(429);
    const lockouts = await s.db.all<{ detail: string; ip: string }>("SELECT detail, ip FROM security_events WHERE kind = 'lockout' ORDER BY rowid");
    expect(lockouts).toEqual([
      { detail: "aino", ip: HOME },
      { detail: "osoite", ip: HOME },
    ]);
  });

  it("with all three full, guesses at one name from remembered addresses stop at 30 together", async () => {
    const { s, login } = await app();
    const homes = ["192.0.2.11", "192.0.2.12", "192.0.2.13", "192.0.2.14"];
    for (const h of homes) expect((await login(h)).status).toBe(200);
    floodAll(s);
    for (const h of homes.slice(0, 3)) for (let i = 0; i < 10; i++) expect((await login(h, WRONG)).status).toBe(401);
    expect((await login(homes[3]!)).status).toBe(429);
    const lockouts = await s.db.all<{ detail: string }>("SELECT detail FROM security_events WHERE kind = 'lockout'");
    expect(lockouts).toEqual([{ detail: "aino, kaikista osoitteista" }]);
  });

  it("remembering ends no lockout: a name locked from an address before the flood stays locked there", async () => {
    const { s, login } = await app();
    expect((await login(HOME)).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await login(HOME, WRONG)).status).toBe(401);
    expect((await login(HOME)).status).toBe(429);
    floodAll(s);
    expect((await login(HOME)).status).toBe(429);
    expect(s.loginLimiter.user.spareSize).toBe(0);
  });

  it("only a correct password gets an address remembered", async () => {
    const { s, login } = await app();
    // the first-run setup and its session do not count as a login
    expect(s.loginLimiter.remembered.size).toBe(0);
    expect((await login(STRANGER, WRONG)).status).toBe(401);
    expect((await login(STRANGER, { username: "nobody", password: "wrong-password-123" })).status).toBe(401);
    expect((await login(STRANGER, { username: "x".repeat(65), password: "x" })).status).toBe(401);
    expect(s.loginLimiter.remembered.size).toBe(0);
    floodAll(s);
    // refused attempts add nothing either, whatever the password
    expect((await login(STRANGER)).status).toBe(429);
    expect(s.loginLimiter.remembered.size).toBe(0);
    expect(s.loginLimiter.remembered.has(STRANGER)).toBe(false);
  });

  it("remembers an IPv6 client by its /64, like the limits count it", async () => {
    const { s, login } = await app();
    expect((await login("2001:db8:aa:bb::1")).status).toBe(200);
    floodAll(s);
    expect((await login("2001:db8:aa:bb:ffff:ffff:ffff:2")).status).toBe(200);
    expect((await login("2001:db8:aa:bc::1")).status).toBe(429);
    expect(s.loginLimiter.remembered.size).toBe(1);
  });

  it("keeps nothing over a restart: the new process has no remembered address", async () => {
    const { s, db, login } = await app();
    expect((await login(HOME)).status).toBe(200);
    const restarted = createApp({ db, config: s.config, now: () => NOW });
    expect(restarted.services.loginLimiter.remembered.size).toBe(0);
    floodAll(restarted.services);
    const res = await restarted.request("http://localhost:8080/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...from(HOME) },
      body: JSON.stringify(LOGIN),
    });
    expect(res.status).toBe(429);
  });
});
