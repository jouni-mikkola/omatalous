/**
 * An add-on module's device tokens (`deviceTokens` in extensions.ts, auth/middleware.ts): a `Bearer <prefix>…` request
 * reaches only /api/<id>/device/ of the module that owns the prefix, a wrong one is 401 and counted with the wrong
 * service tokens, and only such a request skips the Origin part of the CSRF check. The module is made up here.
 */
import { type Context, Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { EXTENSIONS, type ServerExtension } from "../src/extensions.ts";
import { moduleHost } from "../src/modules/host.ts";
import type { AppEnv } from "../src/services/context.ts";
import { createServiceToken, deviceMayReach, devicePrefixValid } from "../src/services/service-tokens.ts";
import { setupApp } from "./helpers.ts";

afterEach(() => {
  EXTENSIONS.splice(0);
});

const bearer = (token: string, more: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...more });
const DEVICE = `exd_${"a".repeat(43)}`;
const OTHER_DEVICE = `oth_${"b".repeat(43)}`;
const DEVICE_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

/** A module whose one device token opens as the user `holder()` names, with device routes and other routes of its own. */
function deviceModule(id: string, prefix: string, token: string, holder: () => string | null): ServerExtension {
  return {
    id,
    routes: () => {
      const r = new Hono<AppEnv>();
      const who = (c: Context<AppEnv>) => ({ user: c.get("user").id, role: c.get("user").role });
      r.get("/device/state", (c) => c.json(who(c)));
      r.post("/device/push", (c) => c.json(who(c)));
      r.get("/device", (c) => c.json(who(c)));
      r.get("/settings", (c) => c.json(who(c)));
      r.post("/settings", (c) => c.json(who(c)));
      return r;
    },
    deviceTokens: {
      prefix,
      resolve: async (_s, given) => {
        const userId = holder();
        return given === token && userId ? { userId } : null;
      },
    },
  };
}

/** The app with the made-up module registered before it mounts its routes; `holder` is the admin unless changed. */
async function withModule() {
  let holder: string | null = null;
  EXTENSIONS.push(deviceModule("example", "exd_", DEVICE, () => holder));
  EXTENSIONS.push(deviceModule("other", "oth_", OTHER_DEVICE, () => holder));
  const app = await setupApp();
  holder = app.adminId;
  return { ...app, setHolder: (id: string | null) => (holder = id) };
}

describe("an add-on module's device tokens", () => {
  it("reach the module's device routes as their user with a member's rights, any method", async () => {
    const { client, adminId } = await withModule();
    const device = client();
    const state = await device.call("GET", "/api/example/device/state", undefined, bearer(DEVICE));
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ user: adminId, role: "member" });
    const push = await device.call("POST", "/api/example/device/push", {}, bearer(DEVICE));
    expect(push.status).toBe(200);
    expect(push.body).toEqual({ user: adminId, role: "member" });
  });

  it("reach nothing else: the module's other routes, another module's device routes and every shared route are 403", async () => {
    const { client } = await withModule();
    const device = client();
    for (const [method, path] of [
      ["GET", "/api/example/device"],
      ["GET", "/api/example/settings"],
      ["POST", "/api/example/settings"],
      ["GET", "/api/other/device/state"],
      ["POST", "/api/other/device/push"],
      ["GET", "/api/meta"],
      ["GET", "/api/dashboard"],
      ["GET", "/api/auth/state"],
      ["GET", "/api/security/notices"],
      ["GET", "/api/admin/instance"],
      ["POST", "/api/auth/logout"],
      ["GET", "/api/example/device/%2e%2e/settings"],
    ] as const) {
      const res = await device.call(method, path, method === "POST" ? {} : undefined, bearer(DEVICE));
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.code, `${method} ${path}`).toBe("forbidden");
    }
    // the other module's token opens its own routes only
    expect((await device.call("GET", "/api/other/device/state", undefined, bearer(OTHER_DEVICE))).status).toBe(200);
    expect((await device.call("GET", "/api/example/device/state", undefined, bearer(OTHER_DEVICE))).status).toBe(403);
  });

  it("are answered by the token alone: an admin's cookie beside it gives no more", async () => {
    const { admin } = await withModule();
    expect((await admin.call("GET", "/api/admin/instance")).status).toBe(200);
    expect((await admin.call("GET", "/api/admin/instance", undefined, bearer(DEVICE))).status).toBe(403);
    expect((await admin.call("GET", "/api/example/device/state", undefined, bearer(DEVICE))).body.role).toBe("member");
  });

  it("are 401 when the module does not open them or their user is gone, and a service token's word is not used", async () => {
    const { client, setHolder } = await withModule();
    const device = client();
    const wrong = await device.call("GET", "/api/example/device/state", undefined, bearer(`exd_${"x".repeat(43)}`));
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ code: "unauthenticated", error: "Laitteen tunnus ei kelpaa." });
    // a token of another module's prefix on this module's path is that module's to open, and it does not
    expect((await device.call("GET", "/api/example/device/state", undefined, bearer(`oth_${"x".repeat(43)}`))).status).toBe(401);
    setHolder("no-such-user");
    expect((await device.call("GET", "/api/example/device/state", undefined, bearer(DEVICE))).status).toBe(401);
  });

  it("count a wrong one with the wrong service tokens: after 20 from an address both kinds wait", async () => {
    const { s, client } = await withModule();
    const { token } = await createServiceToken(s, { username: "aino", name: "agent" });
    const device = client();
    for (let i = 0; i < 10; i++) expect((await device.call("GET", "/api/example/device/state", undefined, bearer(`exd_${"x".repeat(43)}`))).status).toBe(401);
    for (let i = 0; i < 10; i++) expect((await device.call("GET", "/api/meta", undefined, bearer(`omt_${"x".repeat(43)}`))).status).toBe(401);
    const waiting = await device.call("GET", "/api/example/device/state", undefined, bearer(DEVICE));
    expect(waiting.status).toBe(429);
    expect(waiting.res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await device.call("GET", "/api/meta", undefined, bearer(token))).status).toBe(429);
    expect(await s.security.list({ kind: "service_token_refused", limit: 5 })).toHaveLength(1);
  });

  it("skip the Origin part of the CSRF check, and only they do", async () => {
    const { admin, client, s } = await withModule();
    const device = client();
    // a device sends its own origin
    expect((await device.call("POST", "/api/example/device/push", {}, bearer(DEVICE, { Origin: DEVICE_ORIGIN }))).status).toBe(200);
    // the header part still holds for it
    const noHeader = await device.call("POST", "/api/example/device/push", {}, bearer(DEVICE, { Origin: DEVICE_ORIGIN, "X-Requested-With": "" }));
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.code).toBe("csrf");
    // a signed-in browser's request from that origin is refused as before, on the module's routes and the shared ones
    for (const path of ["/api/example/settings", "/api/example/device/push", "/api/demo"]) {
      const forged = await admin.call("POST", path, {}, { Origin: DEVICE_ORIGIN });
      expect(forged.status, path).toBe(403);
      expect(forged.body.code, path).toBe("csrf");
    }
    // the same request from the app's own address goes through
    expect((await admin.call("POST", "/api/example/settings", {}, { Origin: "http://localhost:8080" })).status).toBe(200);
    // a service token still only reads, whatever its origin
    const { token } = await createServiceToken(s, { username: "aino", name: "agent" });
    expect((await client().call("POST", "/api/example/device/push", {}, bearer(token, { Origin: DEVICE_ORIGIN }))).status).toBe(403);
  });

  it("leave service tokens and sessions as they were", async () => {
    const { s, admin, client } = await withModule();
    const { token } = await createServiceToken(s, { username: "aino", name: "agent" });
    const agent = client();
    expect((await agent.call("GET", "/api/meta", undefined, bearer(token))).status).toBe(200);
    // the module did not say its GETs only read, so a service token reads none of them, its device routes included
    expect((await agent.call("GET", "/api/example/device/state", undefined, bearer(token))).status).toBe(403);
    expect((await agent.call("GET", "/api/meta", undefined, bearer(`omt_${"x".repeat(43)}`))).body.error).toBe("Palvelutunnus ei kelpaa.");
    // a signed-in member reaches the module's routes by the cookie, device routes too, with their own role
    expect((await admin.call("GET", "/api/example/device/state")).body.role).toBe("admin");
    expect((await admin.call("GET", "/api/example/settings")).status).toBe(200);
    expect((await client().call("GET", "/api/example/device/state")).status).toBe(401);
  });

  it("are taken from a module only with a prefix of their own shape", () => {
    expect(devicePrefixValid("exd_")).toBe(true);
    expect(devicePrefixValid("abcdefgh_")).toBe(true);
    for (const bad of ["", "omt_", "abcdefghi_", "e_", "Exd_", "exd", "ex-d_", "exd_x", undefined, 4]) expect(devicePrefixValid(bad), String(bad)).toBe(false);
    const entry = (prefix: string) => ({ ...deviceModule("example", prefix, DEVICE, () => null) });
    expect(() => moduleHost({ id: "example", version: "1.0.0", dir: "." }).host.addExtension(entry("omt_"))).toThrow(/prefix/);
    expect(() => moduleHost({ id: "example", version: "1.0.0", dir: "." }).host.addExtension(entry(""))).toThrow(/prefix/);
    expect(() =>
      moduleHost({ id: "example", version: "1.0.0", dir: "." }).host.addExtension({ ...entry("exd_"), deviceTokens: { prefix: "exd_" } as never }),
    ).toThrow(/prefix/);
    expect(EXTENSIONS).toHaveLength(0);
    moduleHost({ id: "example", version: "1.0.0", dir: "." }).host.addExtension(entry("exd_"));
    expect(EXTENSIONS.map((e) => e.id)).toEqual(["example"]);
  });

  it("name their routes: plain segments under /api/<id>/device/", () => {
    const e = deviceModule("example", "exd_", DEVICE, () => null);
    expect(deviceMayReach(e, "/api/example/device/state")).toBe(true);
    expect(deviceMayReach(e, "/api/example/device/k/link")).toBe(true);
    for (const path of ["/api/example/device", "/api/example/device/", "/api/example/devices/x", "/api/example/x/device/y", "/api/other/device/x", "/api/example/device/../x", "/api/example/device/./x", "/api/example/device//x"]) {
      expect(deviceMayReach(e, path), path).toBe(false);
    }
  });
});
