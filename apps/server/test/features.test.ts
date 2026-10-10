import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { gated } from "../src/auth/middleware.ts";
import type { AppEnv } from "../src/services/context.ts";
import { setupApp } from "./helpers.ts";

const stored = async (s: Awaited<ReturnType<typeof setupApp>>["s"]) => JSON.parse((await s.settings.get("instance_settings")) ?? "null");

describe("feature flags", () => {
  it("every flag is at its default in /api/meta, and the optimise module is off", async () => {
    const { admin, member } = await setupApp();
    expect((await admin.call("GET", "/api/meta")).body.features).toEqual({ optimise: false });
    const eero = await member("eero");
    expect((await eero.call("GET", "/api/meta")).body.features).toEqual({ optimise: false });
  });

  it("an admin switches a flag, everyone sees it, and it is stored in the instance settings row", async () => {
    const { admin, member, s } = await setupApp();
    const eero = await member("eero");
    const on = await admin.call("PUT", "/api/admin/features", { optimise: true });
    expect(on.status).toBe(200);
    expect(on.body.features).toEqual({ optimise: true });
    expect((await eero.call("GET", "/api/meta")).body.features.optimise).toBe(true);
    expect((await stored(s)).features).toEqual({ optimise: true });

    // the settings shown in the server form do not carry the flags, and the other values are untouched
    const instance = (await admin.call("GET", "/api/admin/instance")).body;
    expect(instance.features).toEqual({ optimise: true });
    expect(instance.settings).not.toHaveProperty("features");
    expect(instance.settings.historyDays).toBe(730);

    expect((await admin.call("PUT", "/api/admin/features", { optimise: false })).body.features).toEqual({ optimise: false });
    expect((await eero.call("GET", "/api/meta")).body.features.optimise).toBe(false);
  });

  it("saving the other server settings keeps the flags", async () => {
    const { admin, s } = await setupApp();
    await admin.call("PUT", "/api/admin/features", { optimise: true });
    expect((await admin.call("PUT", "/api/admin/instance", { historyDays: 365 })).status).toBe(200);
    expect((await admin.call("POST", "/api/admin/instance/complete")).status).toBe(200);
    expect((await admin.call("GET", "/api/meta")).body.features.optimise).toBe(true);
    expect(await stored(s)).toMatchObject({ historyDays: 365, setupDone: true, features: { optimise: true } });
  });

  it("is read back from the database, and an old or damaged row does not break the start", async () => {
    const { admin, s } = await setupApp();
    await s.settings.set("instance_settings", JSON.stringify({ historyDays: 400, features: { optimise: true, retired: true } }));
    await s.instance.load(true);
    expect(s.instance.features()).toEqual({ optimise: true });
    expect((await admin.call("GET", "/api/meta")).body.features).toEqual({ optimise: true });

    for (const features of ["yes", 1, null, [true], { optimise: "true" }, { optimise: 1 }]) {
      await s.settings.set("instance_settings", JSON.stringify({ historyDays: 400, features }));
      await s.instance.load(true);
      expect(s.instance.features(), JSON.stringify(features)).toEqual({ optimise: false });
      expect(s.instance.current.historyDays).toBe(400);
    }

    // a row from before flags existed has none
    await s.settings.set("instance_settings", JSON.stringify({ historyDays: 400, industryLookup: false }));
    await s.instance.load(true);
    expect(s.instance.features()).toEqual({ optimise: false });
  });

  it("is for admins, and the body is checked against FEATURES", async () => {
    const { admin, member, s } = await setupApp();
    const eero = await member("eero");
    expect((await eero.call("PUT", "/api/admin/features", { optimise: true })).status).toBe(403);
    expect((await eero.call("GET", "/api/admin/instance")).status).toBe(403);

    for (const [what, body] of [
      ["an unknown flag", { nope: true }],
      ["a prototype key", JSON.parse('{"__proto__": true}')],
      ["a string for a boolean", { optimise: "true" }],
      ["a number for a boolean", { optimise: 1 }],
      ["null", null],
      ["a list", [true]],
      ["a flag next to a bad one", { optimise: true, nope: false }],
    ] as const) {
      const r = await admin.call("PUT", "/api/admin/features", body);
      expect(r.status, what).toBe(400);
    }
    // a refused request changes nothing
    expect(s.instance.features()).toEqual({ optimise: false });
    expect((await stored(s))?.features).toBeUndefined();
    // an empty map is accepted and leaves everything as it was
    expect((await admin.call("PUT", "/api/admin/features", {})).status).toBe(200);
  });

  it("a gated module answers 404 like an unknown path while the flag is off, and lets the request through when it is on", async () => {
    const { admin, s } = await setupApp();
    // the module's routes exist before the guard is added: route order cannot get past it
    const module = new Hono<AppEnv>().get("/ping", (c) => c.json({ ok: true }));
    const probe = new Hono<AppEnv>();
    probe.route("/module", gated(s, "optimise", module));
    probe.get("/other", (c) => c.json({ ok: true }));

    const off = await probe.request("/module/ping");
    expect(off.status).toBe(404);
    expect(await off.json()).toEqual({ error: "Ei löydy." });
    expect((await probe.request("/other")).status).toBe(200);

    await admin.call("PUT", "/api/admin/features", { optimise: true });
    expect((await probe.request("/module/ping")).status).toBe(200);
    await admin.call("PUT", "/api/admin/features", { optimise: false });
    expect((await probe.request("/module/ping")).status).toBe(404);
  });
});
