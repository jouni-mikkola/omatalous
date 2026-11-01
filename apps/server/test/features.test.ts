import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { gated } from "../src/auth/middleware.ts";
import { EXTENSIONS } from "../src/extensions.ts";
import type { AppEnv } from "../src/services/context.ts";
import { setupApp } from "./helpers.ts";

const stored = async (s: Awaited<ReturnType<typeof setupApp>>["s"]) => JSON.parse((await s.settings.get("instance_settings")) ?? "null");

/** The shared build has no flag of its own, so a stand-in extension carries one; `id` is no declared flag, hence the casts. */
function standIn(id = "koe") {
  EXTENSIONS.push({ id: id as never, feature: { label: "Koe", stage: "dev", default: false }, routes: () => new Hono<AppEnv>().get("/ping", (c) => c.json({ ok: true })) });
}
afterEach(() => void EXTENSIONS.splice(0));

describe("feature flags", () => {
  it("the shared build has none: Säästövinkit is always on and its old switch is refused", async () => {
    const { admin, member } = await setupApp();
    expect((await admin.call("GET", "/api/meta")).body.features).toEqual({});
    const eero = await member("eero");
    expect((await eero.call("GET", "/api/meta")).body.features).toEqual({});
    expect((await admin.call("GET", "/api/optimise")).status).toBe(200);
    expect((await admin.call("PUT", "/api/admin/features", { optimise: false })).status).toBe(400);
    expect((await admin.call("GET", "/api/optimise")).status).toBe(200);
  });

  it("an admin switches an extension's flag, everyone sees it, and it is stored in the instance settings row", async () => {
    standIn();
    const { admin, member, s } = await setupApp();
    const eero = await member("eero");
    expect((await admin.call("GET", "/api/meta")).body.features).toEqual({ koe: false });
    const on = await admin.call("PUT", "/api/admin/features", { koe: true });
    expect(on.status).toBe(200);
    expect(on.body.features).toEqual({ koe: true });
    expect((await eero.call("GET", "/api/meta")).body.features.koe).toBe(true);
    expect((await stored(s)).features).toEqual({ koe: true });

    // the settings shown in the server form do not carry the flags, and the other values are untouched
    const instance = (await admin.call("GET", "/api/admin/instance")).body;
    expect(instance.features).toEqual({ koe: true });
    expect(instance.settings).not.toHaveProperty("features");
    expect(instance.settings.historyDays).toBe(730);

    expect((await admin.call("PUT", "/api/admin/features", { koe: false })).body.features).toEqual({ koe: false });
    expect((await eero.call("GET", "/api/meta")).body.features.koe).toBe(false);
  });

  it("saving the other server settings keeps the flags", async () => {
    standIn();
    const { admin, s } = await setupApp();
    await admin.call("PUT", "/api/admin/features", { koe: true });
    expect((await admin.call("PUT", "/api/admin/instance", { historyDays: 365 })).status).toBe(200);
    expect((await admin.call("POST", "/api/admin/instance/complete")).status).toBe(200);
    expect((await admin.call("GET", "/api/meta")).body.features.koe).toBe(true);
    expect(await stored(s)).toMatchObject({ historyDays: 365, setupDone: true, features: { koe: true } });
  });

  it("is read back from the database, and an old or damaged row does not break the start", async () => {
    standIn();
    const { admin, s } = await setupApp();
    // a flag that no longer exists (optimise was one) is dropped
    await s.settings.set("instance_settings", JSON.stringify({ historyDays: 400, features: { koe: true, optimise: false, retired: true } }));
    await s.instance.load(true);
    expect(s.instance.features()).toEqual({ koe: true });
    expect((await admin.call("GET", "/api/meta")).body.features).toEqual({ koe: true });

    // a damaged value falls back to the default
    for (const features of ["yes", 1, null, [true], { koe: "true" }, { koe: 1 }]) {
      await s.settings.set("instance_settings", JSON.stringify({ historyDays: 400, features }));
      await s.instance.load(true);
      expect(s.instance.features(), JSON.stringify(features)).toEqual({ koe: false });
      expect(s.instance.current.historyDays).toBe(400);
    }

    // a row from before flags existed has none
    await s.settings.set("instance_settings", JSON.stringify({ historyDays: 400, industryLookup: false }));
    await s.instance.load(true);
    expect(s.instance.features()).toEqual({ koe: false });
  });

  it("is for admins, and the body is checked against the flags that exist", async () => {
    standIn();
    const { admin, member, s } = await setupApp();
    const eero = await member("eero");
    expect((await eero.call("PUT", "/api/admin/features", { koe: true })).status).toBe(403);
    expect((await eero.call("GET", "/api/admin/instance")).status).toBe(403);

    for (const [what, body] of [
      ["an unknown flag", { nope: true }],
      ["the flag Säästövinkit had", { optimise: true }],
      ["a prototype key", JSON.parse('{"__proto__": true}')],
      ["a string for a boolean", { koe: "true" }],
      ["a number for a boolean", { koe: 1 }],
      ["null", null],
      ["a list", [true]],
      ["a flag next to a bad one", { koe: true, nope: false }],
    ] as const) {
      const r = await admin.call("PUT", "/api/admin/features", body);
      expect(r.status, what).toBe(400);
    }
    // a refused request changes nothing
    expect(s.instance.features()).toEqual({ koe: false });
    expect((await stored(s))?.features).toBeUndefined();
    // an empty map is accepted and leaves everything as it was
    expect((await admin.call("PUT", "/api/admin/features", {})).status).toBe(200);
  });

  it("a gated module answers 404 like an unknown path while the flag is off, and lets the request through when it is on", async () => {
    standIn();
    const { admin, s } = await setupApp();
    // the module's routes exist before the guard is added: route order cannot get past it
    const module = new Hono<AppEnv>().get("/ping", (c) => c.json({ ok: true }));
    const probe = new Hono<AppEnv>();
    probe.route("/module", gated(s, "koe" as never, module));
    probe.get("/other", (c) => c.json({ ok: true }));

    const off = await probe.request("/module/ping");
    expect(off.status).toBe(404);
    expect(await off.json()).toMatchObject({ error: "Ei löydy.", messageCode: "app.not_found" });
    expect((await probe.request("/other")).status).toBe(200);

    await admin.call("PUT", "/api/admin/features", { koe: true });
    expect((await probe.request("/module/ping")).status).toBe(200);
    await admin.call("PUT", "/api/admin/features", { koe: false });
    expect((await probe.request("/module/ping")).status).toBe(404);
  });
});
