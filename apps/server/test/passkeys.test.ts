import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";
import { Device } from "./webauthn-device.ts";

const PASSWORD = "aino-salasana-123";
const HTTPS = { APP_BASE_URL: "https://talous.example.com" };
const PARTY = { rpId: "talous.example.com", origin: "https://talous.example.com" };

type App = Awaited<ReturnType<typeof setupApp>>;

/** The recovery codes the first passkey made: later changes of the passkeys ask for a code. */
const codesOf = new WeakMap<App, string[]>();
const nextCode = (t: App) => codesOf.get(t)?.shift() ?? "";

/** Adds the device as a passkey of the signed-in admin. */
async function addPasskey(t: App, device: Device, label = "Puhelin", password = PASSWORD) {
  const started = await t.admin.call("POST", "/api/security/factor/passkey/start", { password, code: nextCode(t) });
  expect(started.status).toBe(200);
  const done = await t.admin.call("POST", "/api/security/factor/passkey/finish", { response: device.create(started.body.challenge, PARTY), label });
  if (done.body.recoveryCodes?.length) codesOf.set(t, done.body.recoveryCodes);
  return done;
}

async function events(t: App, kind: string) {
  return t.db.all<{ detail: string | null; user_id: string | null }>("SELECT detail, user_id FROM security_events WHERE kind = ? ORDER BY id", [kind]);
}

/** Password step of a sign-in; returns the client holding the half session. */
async function halfSignIn(t: App) {
  const c = t.client();
  const login = await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
  return { c, login };
}

describe("passkeys: adding", () => {
  it("stores the public key and credential, makes recovery codes for a first factor, and records the event", async () => {
    const t = await setupApp(HTTPS);
    const device = new Device();
    const added = await addPasskey(t, device);
    expect(added.status).toBe(200);
    expect(added.body.recoveryCodes).toHaveLength(10);
    const status = (await t.admin.call("GET", "/api/security/factor")).body;
    expect(status).toMatchObject({ enabled: false, usable: true, address: "https://talous.example.com", recoveryLeft: 10 });
    expect(status.passkeys).toHaveLength(1);
    expect(status.passkeys[0]).toMatchObject({ label: "Puhelin", lastUsedAt: null });
    expect(JSON.stringify(status)).not.toContain(Buffer.from(device.credentialId).toString("base64url"));
    expect(await events(t, "passkey_added")).toEqual([{ detail: "Puhelin", user_id: t.adminId }]);

    // a second passkey makes no new codes, and the same device twice is refused by the browser's exclude list or here
    const second = await addPasskey(t, new Device(), "Tabletti");
    expect(second.body.recoveryCodes).toEqual([]);
    expect((await addPasskey(t, device, "Sama")).status).toBe(400);
  });

  it("needs a code as well once a factor is on, and tells the owner of a new passkey", async () => {
    const t = await setupApp(HTTPS);
    await addPasskey(t, new Device());
    const refused = await t.admin.call("POST", "/api/security/factor/passkey/start", { password: PASSWORD });
    expect(refused.status).toBe(400);
    expect((await t.admin.call("POST", "/api/security/factor/passkey/start", { password: PASSWORD, code: "000000" })).status).toBe(400);
    expect((await t.admin.call("POST", "/api/security/factor/passkey/start", { password: PASSWORD, code: nextCode(t) })).status).toBe(200);
    expect(await t.db.all("SELECT notify FROM security_events WHERE kind = 'passkey_added'")).toEqual([{ notify: 1 }]);
  });

  it("needs the password, a started ceremony, a matching origin and a name", async () => {
    const t = await setupApp(HTTPS);
    expect((await t.admin.call("POST", "/api/security/factor/passkey/start", { password: "väärä" })).status).toBe(400);
    const device = new Device();
    expect((await t.admin.call("POST", "/api/security/factor/passkey/finish", { response: device.create("x", PARTY), label: "a" })).status).toBe(400);

    const started = await t.admin.call("POST", "/api/security/factor/passkey/start", { password: PASSWORD });
    const other = await t.admin.call("POST", "/api/security/factor/passkey/finish", { response: device.create(started.body.challenge, { rpId: PARTY.rpId, origin: "https://evil.example" }), label: "a" });
    expect(other.status).toBe(400);
    expect(other.body.error).toContain("https://talous.example.com");
    // the challenge is gone after one answer, right or wrong
    const again = await t.admin.call("POST", "/api/security/factor/passkey/finish", { response: device.create(started.body.challenge, PARTY), label: "a" });
    expect(again.status).toBe(400);
    const second = await t.admin.call("POST", "/api/security/factor/passkey/start", { password: PASSWORD });
    expect((await t.admin.call("POST", "/api/security/factor/passkey/finish", { response: device.create(second.body.challenge, PARTY), label: "" })).status).toBe(400);
    expect(await t.db.all("SELECT 1 FROM user_factor")).toHaveLength(0);
    expect((await events(t, "login_fail")).length).toBeGreaterThan(0);
  });

  it("is refused with a plain sentence on an address with no https, and works on localhost", async () => {
    const home = await setupApp({ APP_BASE_URL: "http://192.168.1.10:8080" });
    const refused = await home.admin.call("POST", "/api/security/factor/passkey/start", { password: PASSWORD });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain("https");
    expect(refused.body.error).toContain("http://192.168.1.10:8080");
    expect((await home.admin.call("GET", "/api/security/factor")).body.usable).toBe(false);
    const local = await setupApp();
    expect((await local.admin.call("POST", "/api/security/factor/passkey/start", { password: PASSWORD })).status).toBe(200);
  });
});

describe("passkeys: sign-in", () => {
  it("signs in after the password, counts the counter up and records the use", async () => {
    const t = await setupApp(HTTPS);
    const device = new Device();
    await addPasskey(t, device);
    const { c, login } = await halfSignIn(t);
    expect(login.body).toEqual({ needsFactor: true, passkey: true, codes: true });
    expect((await c.call("GET", "/api/meta")).status).toBe(401);
    const options = await c.call("POST", "/api/auth/passkey/options", {});
    expect(options.status).toBe(200);
    expect(options.body.allowCredentials).toHaveLength(1);
    const done = await c.call("POST", "/api/auth/passkey", { response: device.get(options.body.challenge, PARTY) });
    expect(done.status).toBe(200);
    expect(done.body.user.username).toBe("aino");
    expect((await c.call("GET", "/api/meta")).status).toBe(200);
    expect(await events(t, "passkey_used")).toEqual([{ detail: "Puhelin", user_id: t.adminId }]);
    const row = await t.db.first<{ last_step: number; last_used_at: string }>("SELECT last_step, last_used_at FROM user_factor WHERE kind = 'passkey'");
    expect(row!.last_step).toBe(1);
  });

  it("refuses a wrong device, a wrong origin, a replayed answer and a missing half session, and records each", async () => {
    const t = await setupApp(HTTPS);
    const device = new Device();
    await addPasskey(t, device);
    expect((await t.client().call("POST", "/api/auth/passkey/options", {})).status).toBe(401);

    const { c } = await halfSignIn(t);
    const options = await c.call("POST", "/api/auth/passkey/options", {});
    const stranger = await c.call("POST", "/api/auth/passkey", { response: new Device().get(options.body.challenge, PARTY) });
    expect(stranger.status).toBe(401);
    // the challenge of that try is gone: a fresh one is needed even for the right device
    const late = await c.call("POST", "/api/auth/passkey", { response: device.get(options.body.challenge, PARTY) });
    expect(late.status).toBe(401);

    const second = await c.call("POST", "/api/auth/passkey/options", {});
    const wrongOrigin = await c.call("POST", "/api/auth/passkey", { response: device.get(second.body.challenge, { rpId: PARTY.rpId, origin: "https://evil.example" }) });
    expect(wrongOrigin.status).toBe(401);

    const third = await c.call("POST", "/api/auth/passkey/options", {});
    const answer = device.get(third.body.challenge, PARTY);
    expect((await c.call("POST", "/api/auth/passkey", { response: answer })).status).toBe(200);
    const replay = await halfSignIn(t);
    await replay.c.call("POST", "/api/auth/passkey/options", {});
    expect((await replay.c.call("POST", "/api/auth/passkey", { response: answer })).status).toBe(401);
    expect((await events(t, "login_fail")).filter((e) => e.detail?.startsWith("passkey")).length).toBe(4);
  });

  it("counts each try before it is checked: five wrong answers lock the next, even a right one", async () => {
    const t = await setupApp(HTTPS);
    const device = new Device();
    await addPasskey(t, device);
    const { c } = await halfSignIn(t);
    for (let i = 0; i < 5; i++) {
      const o = await c.call("POST", "/api/auth/passkey/options", {});
      expect((await c.call("POST", "/api/auth/passkey", { response: new Device().get(o.body.challenge, PARTY) })).status).toBe(401);
    }
    const o = await c.call("POST", "/api/auth/passkey/options", {});
    const locked = await c.call("POST", "/api/auth/passkey", { response: device.get(o.body.challenge, PARTY) });
    expect(locked.status).toBe(429);
    expect((await events(t, "lockout")).length).toBe(1);
  });

  it("a passkey of another user does not sign this one in", async () => {
    const t = await setupApp(HTTPS);
    const mine = new Device();
    await addPasskey(t, mine);
    const aino = await halfSignIn(t);
    const other = await t.member("pekka");
    const theirs = new Device();
    const started = await other.call("POST", "/api/security/factor/passkey/start", { password: "pekka-uusi-salasana" });
    expect((await other.call("POST", "/api/security/factor/passkey/finish", { response: theirs.create(started.body.challenge, PARTY), label: "Pekka" })).status).toBe(200);
    const o = await aino.c.call("POST", "/api/auth/passkey/options", {});
    expect((await aino.c.call("POST", "/api/auth/passkey", { response: theirs.get(o.body.challenge, PARTY) })).status).toBe(401);
  });
});

describe("passkeys: removing", () => {
  it("needs the password, takes the recovery codes with the last factor and records the event", async () => {
    const t = await setupApp(HTTPS);
    await addPasskey(t, new Device());
    const status = (await t.admin.call("GET", "/api/security/factor")).body;
    const id = status.passkeys[0].id as string;
    expect((await t.admin.call("POST", "/api/security/factor/passkey/remove", { password: "väärä", id })).status).toBe(400);
    expect((await t.admin.call("POST", "/api/security/factor/passkey/remove", { password: PASSWORD, id: "nope" })).status).toBe(400);
    // the password alone is not enough once a factor is on
    expect((await t.admin.call("POST", "/api/security/factor/passkey/remove", { password: PASSWORD, id })).status).toBe(400);
    expect((await t.admin.call("POST", "/api/security/factor/passkey/remove", { password: PASSWORD, code: "000000", id })).status).toBe(400);
    expect((await t.admin.call("POST", "/api/security/factor/passkey/remove", { password: PASSWORD, code: nextCode(t), id })).status).toBe(200);
    expect(await t.db.all("SELECT 1 FROM user_factor")).toHaveLength(0);
    expect(await events(t, "passkey_removed")).toEqual([{ detail: "Puhelin", user_id: t.adminId }]);
    // with no factor left the sign-in is the password alone again
    expect((await halfSignIn(t)).login.body.user.username).toBe("aino");
  });
});
