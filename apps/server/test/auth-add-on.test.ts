/** The answer of a sign-in tells that an add-on module is loaded; no answer to a signed-out request does. */
import { describe, expect, it } from "vitest";
import type { StartState } from "../src/modules/load.ts";
import { setupApp } from "./helpers.ts";

const PASSWORD = "aino-salasana-123";
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

  it("says nothing of it to a request with no session, nor to a wrong password", async () => {
    const { client } = await setupApp({}, undefined, withStart(connected));
    const c = client();
    expect(JSON.stringify((await c.call("GET", "/api/auth/state")).body)).not.toContain("addOn");
    const wrong = await c.call("POST", "/api/auth/login", { username: "aino", password: "väärä-salasana-1" });
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toContain("addOn");
  });
});
