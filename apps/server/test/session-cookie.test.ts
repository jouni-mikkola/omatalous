import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

describe("per-instance session cookie", () => {
  it("is named after INSTANCE_NAME, defaulting to banking-app", async () => {
    const a = await setupApp({ INSTANCE_NAME: "koti" });
    const b = await setupApp({ INSTANCE_NAME: "mokki" });
    const d = await setupApp();
    expect(a.admin.cookie).toMatch(/^talous_koti=/);
    expect(b.admin.cookie).toMatch(/^talous_mokki=/);
    expect(d.admin.cookie).toMatch(/^talous_banking-app=/);
  });

  it("accepts the legacy cookie and answers with the new name", async () => {
    const t = await setupApp({ INSTANCE_NAME: "koti" });
    const token = t.admin.cookie.split("=")[1]!;
    const c = t.client();
    c.cookie = `talous_session=${token}`;
    const r = await c.call("GET", "/api/auth/state");
    expect(r.body.user).not.toBeNull();
    expect(r.res.headers.get("set-cookie")).toMatch(/^talous_koti=/);
    expect(c.cookie).toBe(`talous_koti=${token}`);
  });

  it("ignores another instance's cookie", async () => {
    const t = await setupApp({ INSTANCE_NAME: "koti" });
    const c = t.client();
    c.cookie = t.admin.cookie.replace("talous_koti", "talous_mokki");
    expect((await c.call("GET", "/api/auth/state")).body.user).toBeNull();
  });

  it("logout deletes only the new cookie", async () => {
    const t = await setupApp({ INSTANCE_NAME: "koti" });
    const r = await t.admin.call("POST", "/api/auth/logout");
    const set = r.res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^talous_koti=;/);
    expect(set).not.toMatch(/talous_session/);
  });
});
