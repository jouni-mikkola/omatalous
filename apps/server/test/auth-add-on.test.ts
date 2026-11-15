/** The answers of a signed-in request (sign-in, second factor, state) tell that an add-on module is loaded; no answer to a signed-out request does. */
import { describe, expect, it } from "vitest";
import type { StartState } from "../src/modules/load.ts";
import { stepOf, totpCode } from "../src/security/totp.ts";
import { NOW, setupApp } from "./helpers.ts";

const PASSWORD = "aino-salasana-123";
const STEP = stepOf(NOW.getTime());
const connected: StartState = { state: "connected", id: "example", version: "1.2.0", filesDir: "/tmp/none", css: false };

const withStart = (start: StartState) => ({ modules: { root: "/tmp/none", signersFile: null, start } });

describe("sign-in answers and the add-on module", () => {
  it("carries addOn after a sign-in while a module is loaded", async () => {
    const { client } = await setupApp({}, undefined, withStart(connected));
    const c = client();
    const res = await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.addOn).toBe(true);
  });

  it("carries nothing of it with no module, or one that did not start", async () => {
    for (const start of [{ state: "none" }, { state: "waiting", id: "example", version: "1.2.0" }] as StartState[]) {
      const { client } = await setupApp({}, undefined, withStart(start));
      const res = await client().call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
      expect(res.status, start.state).toBe(200);
      expect(res.body, start.state).not.toHaveProperty("addOn");
    }
    const bare = await setupApp();
    expect((await bare.client().call("POST", "/api/auth/login", { username: "aino", password: PASSWORD })).body).not.toHaveProperty("addOn");
  });

  it("carries addOn in the state answer of a signed-in request only", async () => {
    const { client } = await setupApp({}, undefined, withStart(connected));
    const c = client();
    await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    const state = await c.call("GET", "/api/auth/state");
    expect(state.body.user.username).toBe("aino");
    expect(state.body.addOn).toBe(true);
    const bare = await setupApp();
    const b = bare.client();
    await b.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    expect((await b.call("GET", "/api/auth/state")).body).not.toHaveProperty("addOn");
  });

  it("carries addOn when the code of the second factor completes the sign-in", async () => {
    const t = await setupApp({}, undefined, withStart(connected));
    const started = await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD });
    const confirmed = await t.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code: totpCode(started.body.secret, STEP) });
    expect(confirmed.status).toBe(200);
    const c = t.client();
    const first = await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    expect(first.body).toEqual({ needsFactor: true });
    // between the two steps there is no session: the state answer has no user and says nothing of the module
    expect(JSON.stringify((await c.call("GET", "/api/auth/state")).body)).not.toContain("addOn");
    const done = await c.call("POST", "/api/auth/factor", { code: totpCode(started.body.secret, STEP + 1) });
    expect(done.status).toBe(200);
    expect(done.body.addOn).toBe(true);
    expect((await c.call("GET", "/api/auth/state")).body.addOn).toBe(true);
  });

  it("says nothing of it to a request with no session, nor to a wrong password", async () => {
    const { client } = await setupApp({}, undefined, withStart(connected));
    const c = client();
    expect(JSON.stringify((await c.call("GET", "/api/auth/state")).body)).not.toContain("addOn");
    const wrong = await c.call("POST", "/api/auth/login", { username: "aino", password: "väärä-salasana-1" });
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toContain("addOn");
  });
});
