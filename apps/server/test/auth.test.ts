import { describe, expect, it } from "vitest";
import { SETUP_CODE, setupApp } from "./helpers.ts";

describe("first-run setup", () => {
  it("creates the first admin only with the setup code, and only once", async () => {
    const { client } = await setupApp();
    const other = client();
    expect((await other.call("GET", "/api/auth/state")).body).toMatchObject({ needsSetup: false, user: null, timezone: "Europe/Helsinki" });
    const again = await other.call("POST", "/api/auth/setup", { code: SETUP_CODE, username: "hyokkaaja", displayName: "x", password: "pitka-salasana-123" });
    expect(again.status).toBe(400);
  });

  it("rejects a wrong setup code", async () => {
    const { openDatabase } = await import("../src/db/open.ts");
    const { createApp } = await import("../src/app.ts");
    const { loadConfig } = await import("../src/platform/config.ts");
    const { db } = await openDatabase(":memory:");
    const app = createApp({ db, config: loadConfig({ SETUP_CODE: "oikea-asennuskoodi", PASSWORD_ITERATIONS: "1000" }) });
    const res = await app.request("http://localhost:8080/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ code: "vaara-asennuskoodi", username: "aino", displayName: "Aino", password: "aino-salasana-123" }),
    });
    expect(res.status).toBe(400);
    expect(await app.services.users.count()).toBe(0);
  });
});

describe("sessions and login", () => {
  it("requires a session for the API but not for health", async () => {
    const { client, admin } = await setupApp();
    const anonymous = client();
    expect((await anonymous.call("GET", "/api/meta")).status).toBe(401);
    expect((await anonymous.call("GET", "/api/health")).status).toBe(200);
    expect((await admin.call("GET", "/api/meta")).status).toBe(200);
  });

  it("sets an HttpOnly, SameSite=Lax session cookie and logs out", async () => {
    const { client } = await setupApp();
    const c = client();
    const r = await c.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" });
    expect(r.status).toBe(200);
    expect(r.res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(r.res.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
    expect(r.body.user).not.toHaveProperty("passwordHash");
    await c.call("POST", "/api/auth/logout");
    expect((await c.call("GET", "/api/meta")).status).toBe(401);
  });

  it("rejects wrong passwords and rate-limits guessing", async () => {
    const { client } = await setupApp();
    const c = client();
    for (let i = 0; i < 10; i++) expect((await c.call("POST", "/api/auth/login", { username: "aino", password: `vaara-${i}` })).status).toBe(401);
    const blocked = await c.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" });
    expect(blocked.status).toBe(429);
    expect(blocked.res.headers.get("retry-after")).toBeTruthy();
  });

  it("one member's wrong passwords do not lock out another member at the same address", async () => {
    const { client, member } = await setupApp();
    await member("eero");
    await member("maija");
    const c = client(); // every test client comes from the same address
    for (let i = 0; i < 10; i++) expect((await c.call("POST", "/api/auth/login", { username: "eero", password: `vaara-${i}` })).status).toBe(401);
    expect((await c.call("POST", "/api/auth/login", { username: "EERO", password: "eero-uusi-salasana" })).status).toBe(429);
    expect((await c.call("POST", "/api/auth/login", { username: "maija", password: "maija-uusi-salasana" })).status).toBe(200);
  });

  it("a correct password clears the user name's failures", async () => {
    const { client } = await setupApp();
    const c = client();
    const login = (password: string) => c.call("POST", "/api/auth/login", { username: "aino", password });
    for (let i = 0; i < 9; i++) await login(`vaara-${i}`);
    expect((await login("aino-salasana-123")).status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await login(`vaara-${i}`)).status).toBe(401);
    expect((await login("aino-salasana-123")).status).toBe(200);
  });

  it("blocks an address after 50 failures, whatever the user names", async () => {
    const { client } = await setupApp();
    const c = client();
    // a wrong password for a real user, and junk that is refused before any hashing (an unknown
    // name is checked against a full-strength dummy hash, too slow for 50 rounds here)
    for (let i = 0; i < 5; i++) expect((await c.call("POST", "/api/auth/login", { username: "aino", password: `vaara-${i}` })).status).toBe(401);
    for (let i = 0; i < 45; i++) expect((await c.call("POST", "/api/auth/login", { username: `${"x".repeat(65)}${i}`, password: "x" })).status).toBe(401);
    const blocked = await c.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" });
    expect(blocked.status).toBe(429);
    expect(blocked.res.headers.get("retry-after")).toBeTruthy();
  });

  it("blocks state-changing requests without the CSRF header or from another origin", async () => {
    const { admin } = await setupApp();
    expect((await admin.call("POST", "/api/demo", undefined, { "X-Requested-With": "" })).status).toBe(403);
    expect((await admin.call("POST", "/api/demo", undefined, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await admin.call("POST", "/api/demo")).status).toBe(200);
  });

  it("sends security headers", async () => {
    const { admin } = await setupApp();
    const r = await admin.call("GET", "/api/meta");
    // the whole policy, so a source added later (a CDN, blob:, 'unsafe-eval') fails here; 'wasm-unsafe-eval' is the loan reader's
    expect(r.res.headers.get("content-security-policy")).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'",
    );
    expect(r.res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(r.res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("household members", () => {
  it("forces a temporary password to be changed before anything else", async () => {
    const { admin, client } = await setupApp();
    const created = await admin.call("POST", "/api/users", { username: "eero", displayName: "Eero" });
    expect(created.status).toBe(201);
    const eero = client();
    await eero.call("POST", "/api/auth/login", { username: "eero", password: created.body.temporaryPassword });
    const blocked = await eero.call("GET", "/api/meta");
    expect(blocked).toMatchObject({ status: 403, body: { code: "password_change_required" } });
    expect((await eero.call("POST", "/api/auth/password", { current: created.body.temporaryPassword, next: "lyhyt" })).status).toBe(400);
    expect((await eero.call("POST", "/api/auth/password", { current: created.body.temporaryPassword, next: "eeron-oma-salasana" })).status).toBe(200);
    expect((await eero.call("GET", "/api/meta")).status).toBe(200);
  });

  it("only admins manage users; the last admin cannot be removed", async () => {
    const { admin, adminId, member } = await setupApp();
    const eero = await member("eero");
    expect((await eero.call("GET", "/api/users")).status).toBe(403);
    expect((await admin.call("DELETE", `/api/users/${adminId}`)).status).toBe(400);
    expect((await admin.call("PATCH", `/api/users/${adminId}`, { role: "member" })).status).toBe(400);
    expect((await admin.call("DELETE", `/api/users/${eero.id}`)).status).toBe(200);
    expect((await eero.call("GET", "/api/meta")).status).toBe(401);
  });
});
