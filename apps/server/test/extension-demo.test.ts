/** The demo hooks of an added module (extensions.ts): its rows load while its flag is on and go with the demo whatever the flag. */
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { EXTENSIONS } from "../src/extensions.ts";
import type { AppEnv } from "../src/services/context.ts";
import { setupApp } from "./helpers.ts";

const calls: string[] = [];
const example: (typeof EXTENSIONS)[number] = {
  // not a declared flag: test/ shares src's program, so a declaration here would make "koe" a flag in src (extensions.test.ts)
  id: "koe" as never,
  feature: { label: "Esimerkki", stage: "dev", default: false },
  routes: () => new Hono<AppEnv>(),
  demo: async (_s, userId) => void calls.push(`load ${userId}`),
  removeDemo: async (_s, userId) => void calls.push(`remove ${userId}`),
};

afterEach(() => {
  EXTENSIONS.splice(0);
  calls.splice(0);
});

describe("an extension's demo", () => {
  it("loads with the demo only while its flag is on, and is removed with the demo also after its flag went off", async () => {
    EXTENSIONS.push(example);
    const t = await setupApp();
    await t.admin.call("POST", "/api/demo");
    expect(calls).toEqual([]);
    await t.admin.call("PUT", "/api/admin/features", { koe: true });
    await t.admin.call("POST", "/api/demo");
    expect(calls).toEqual([`load ${t.adminId}`]);
    await t.admin.call("PUT", "/api/admin/features", { koe: false });
    expect((await t.admin.call("DELETE", "/api/demo")).status).toBe(200);
    expect(calls).toEqual([`load ${t.adminId}`, `remove ${t.adminId}`]);
  });

  it("the shared build has none, and removing the demo still works", async () => {
    const t = await setupApp();
    expect((await t.admin.call("DELETE", "/api/demo")).status).toBe(200);
  });
});
