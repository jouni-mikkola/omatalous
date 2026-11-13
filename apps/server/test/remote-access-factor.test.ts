/**
 * A second factor before the address is public (services/remote-access.ts): no publishing while an admin has none, the
 * refusal is a security event, and the last factor stays while the address is public.
 */
import { describe, expect, it } from "vitest";
import { stepOf, totpCode } from "../src/security/totp.ts";
import { PASSWORD, LAN, TUNNEL, useWorlds, world } from "./remote-access-kit.ts";

useWorlds();

/** Turns on the admin's authenticator app through the API and returns its recovery codes. */
async function enrolAdmin(w: Awaited<ReturnType<typeof world>>): Promise<string[]> {
  const started = await w.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD });
  const confirmed = await w.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code: totpCode(started.body.secret, stepOf(w.now().getTime())) });
  expect(confirmed.status).toBe(200);
  return confirmed.body.recoveryCodes as string[];
}

describe("remote access: a second factor first", () => {
  it("refuses to turn on while an admin has none, writes nothing and records the refusal", async () => {
    const w = await world({}, { withoutFactor: true });
    await w.host(LAN);
    expect((await w.saveToken()).status).toBe(200);
    const refused = await w.on();
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain("toisen tekijän");
    expect(refused.body.error).toContain("aino");
    expect(await w.events("remote_access_failed")).toEqual([expect.stringContaining("toinen tekijä puuttuu")]);
    expect((await w.state()).access.on).toBe(false);
  });

  it("turns on once the admin has an authenticator app, and keeps the last factor while public", async () => {
    const w = await world({}, { withoutFactor: true });
    await w.host(LAN);
    expect((await w.saveToken()).status).toBe(200);
    const codes = await enrolAdmin(w);

    expect((await w.on()).status).toBe(200);
    await w.helper("ok", TUNNEL);
    w.later();
    const kept = await w.admin.call("POST", "/api/security/factor/remove", { password: PASSWORD, code: codes[0] });
    expect(kept.status).toBe(400);
    expect(kept.body.error).toContain("Osoite on julkinen");
    expect((await w.admin.call("GET", "/api/security/factor")).body.enabled).toBe(true);
  });

  it("refuses a new admin and a promoted member without a factor while the address is public, and ends the other sessions at the first factor", async () => {
    const w = await world({}, { withoutFactor: true });
    await w.host(LAN);
    expect((await w.saveToken()).status).toBe(200);
    const other = w.client();
    expect((await other.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD })).status).toBe(200);
    const codes = await enrolAdmin(w);
    expect((await other.call("GET", "/api/meta")).status).toBe(401);

    const member = await w.member("pekka");
    const before = await w.admin.call("GET", "/api/users");
    const pekka = (before.body.users as { id: string; username: string }[]).find((u) => u.username === "pekka")!;
    expect((await w.admin.call("PATCH", `/api/users/${pekka.id}`, { role: "admin" })).status).toBe(200);
    expect((await w.admin.call("PATCH", `/api/users/${pekka.id}`, { role: "member" })).status).toBe(200);

    expect((await w.on()).status).toBe(200); // pending: the helper has not applied it yet
    const created = await w.admin.call("POST", "/api/users", { username: "uusiadmin", displayName: "Uusi", role: "admin" });
    expect(created.status).toBe(400);
    expect(created.body.error).toContain("Osoite on julkinen");
    expect((await w.admin.call("PATCH", `/api/users/${pekka.id}`, { role: "admin" })).status).toBe(400);
    // the last factor stays while the turning on waits
    expect((await w.admin.call("POST", "/api/security/factor/remove", { password: PASSWORD, code: codes[0] })).status).toBe(400);
    void member;
  });
});
