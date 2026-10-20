/**
 * The hooks of extensions.ts with a stand-in extension: the shared build ships none, so this is the test that notices a
 * hook coming loose. Its flag, routes, migration, export list, sealed value, event kind, hourly work and demo rows.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXTENSIONS } from "../src/extensions.ts";
import { SecretBox } from "../src/security/secretbox.ts";
import { leftOut } from "../src/services/data-export-stores.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { resealAll } from "../src/services/secret-rotation.ts";
import { recordEvent } from "../src/services/security.ts";
import { Hono } from "hono";
import type { AppEnv, Services } from "../src/services/context.ts";
import { gated } from "../src/auth/middleware.ts";
import { scratchDir, setupApp } from "./helpers.ts";

/**
 * Compiled, never run. test/ shares src's program (tsconfig include), so the stand-in's flag is declared nowhere: an
 * augmentation here would let `gated(s, "koe", ...)` compile in src too.
 */
function flagsAreTyped(s: Services, routes: Hono<AppEnv>): void {
  gated(s, "optimise", routes);
  // @ts-expect-error a typo'd flag does not compile
  gated(s, "optimize", routes);
  // @ts-expect-error the stand-in's id is no flag of the program
  gated(s, "koe", routes);
}
void flagsAreTyped;

const NEXT_SECRET = "the-next-app-secret-0123456789-abcdefghijklmnopq";

function standIn() {
  const calls: string[] = [];
  const dir = scratchDir("talous-ext-");
  writeFileSync(join(dir, "9899_koe_note.sql"), "-- migrate: compat 0.64.0\nCREATE TABLE koe_note (user_id TEXT NOT NULL, sealed TEXT NOT NULL);\n");
  EXTENSIONS.push({
    // not a declared flag (flagsAreTyped): cast for the stand-in alone
    id: "koe" as never,
    feature: { label: "Koe", stage: "dev", default: false },
    routes: () => new Hono<AppEnv>().get("/hello", (c) => c.json({ hello: true })),
    migrationsDir: dir,
    leftOut: { koe_note: "a stand-in's table" },
    sealed: async (db) =>
      (await db.all<{ user_id: string; sealed: string }>("SELECT user_id, sealed FROM koe_note")).map((r) => ({
        context: `koe:${r.user_id}`,
        sealed: r.sealed,
        reseal: (sealed) => ({ sql: "UPDATE koe_note SET sealed = ? WHERE user_id = ?", params: [sealed, r.user_id] }),
      })),
    securityEvents: ["koe_done"],
    hourly: async () => void calls.push("hourly"),
    demo: async (_s, _userId, today) => void calls.push(`demo ${today}`),
    removeDemo: async () => void calls.push("removeDemo"),
  });
  return calls;
}

afterEach(() => void EXTENSIONS.splice(0));

describe("an extension of the server", () => {
  it("is mounted behind its own flag, migrated, left out of the export and allowed its event kind", async () => {
    standIn();
    const t = await setupApp();
    expect((await t.admin.call("GET", "/api/koe/hello")).status).toBe(404);
    expect((await t.admin.call("GET", "/api/meta")).body.features).toMatchObject({ koe: false });
    expect((await t.admin.call("PUT", "/api/admin/features", { koe: true })).status).toBe(200);
    expect((await t.admin.call("GET", "/api/koe/hello")).body).toEqual({ hello: true });
    expect((await t.admin.call("PUT", "/api/admin/features", { koee: true })).status).toBe(400);
    expect(await t.db.all("SELECT name FROM _migrations WHERE name = '9899_koe_note.sql'")).toHaveLength(1);
    expect(leftOut()).toMatchObject({ koe_note: "a stand-in's table" });
    await recordEvent(t.s, { kind: "koe_done", userId: t.adminId });
    await expect(recordEvent(t.s, { kind: "koe_other", userId: t.adminId })).rejects.toThrow(/unknown security event kind/);
  });

  it("has its sealed values re-sealed by the rotation, its hourly work run while on, and its demo rows loaded and removed", async () => {
    const calls = standIn();
    const t = await setupApp();
    const old = await SecretBox.fromSecret(t.s.config.appSecret!);
    await t.db.run("INSERT INTO koe_note (user_id, sealed) VALUES (?, ?)", [t.adminId, await old.seal("salainen", `koe:${t.adminId}`)]);
    await resealAll(t.s, t.s.config.appSecret!, NEXT_SECRET);
    const row = await t.db.first<{ sealed: string }>("SELECT sealed FROM koe_note");
    expect(await (await SecretBox.fromSecret(NEXT_SECRET)).open(row!.sealed, `koe:${t.adminId}`)).toBe("salainen");

    await hourlyTick(t.s);
    expect(calls).toEqual([]);
    await t.admin.call("PUT", "/api/admin/features", { koe: true });
    await hourlyTick(t.s);
    await t.admin.call("POST", "/api/demo");
    await t.admin.call("DELETE", "/api/demo");
    expect(calls).toEqual(["hourly", `demo ${t.s.today()}`, "removeDemo"]);
  });
});
