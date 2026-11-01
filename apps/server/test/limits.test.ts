import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/open.ts";
import { SettingsRepo } from "../src/db/settings-repo.ts";
import { envLimits, LIMIT_SCHEMA, type LimitField } from "../src/platform/limits.ts";
import { LimitStore } from "../src/services/limits.ts";
import { setupApp } from "./helpers.ts";

/** The values the code had before the schema existed, and the Argon2id cost that replaced the PBKDF2 rounds. */
const BEFORE: Record<string, number> = {
  loginIp: 50, loginUser: 10, loginName: 30, authWindowMinutes: 15, accessFailures: 10, passwordChange: 5, factorUser: 5, factorName: 15,
  setup: 10, serviceToken: 20, ops: 5, opsDownload: 5, opsDownloadWindowMinutes: 60, keyTest: 8, keyTestWindowMinutes: 10,
  requestKb: 256, hashSlots: 4, passwordMemoryKib: 19_456, passwordPasses: 2, consentDays: 180, historyDays: 730,
};

describe("limits schema", () => {
  it("every default is the value before the schema", () => {
    expect(Object.fromEntries(LIMIT_SCHEMA.map((f) => [f.key, f.default]))).toEqual(BEFORE);
    for (const f of LIMIT_SCHEMA) expect(f.default >= f.min && f.default <= f.max, f.key).toBe(true);
  });

  it("the environment lays over the defaults, and a value outside the schema is dropped", () => {
    expect(envLimits({}).loginUser).toBe(10);
    expect(envLimits({ LOGIN_USER_LIMIT: "3" }).loginUser).toBe(3);
    expect(envLimits({ LOGIN_USER_LIMIT: "0" }).loginUser).toBe(10);
    expect(envLimits({ LOGIN_USER_LIMIT: "abc" }).loginUser).toBe(10);
    expect(envLimits({ REQUEST_MAX_KB: "99999999" }).requestKb).toBe(256);
    // the environment may seed a fast hash for tests, the database may not
    expect(envLimits({ PASSWORD_MEMORY_KIB: "8", PASSWORD_PASSES: "1" })).toMatchObject({ passwordMemoryKib: 8, passwordPasses: 1 });
    expect(envLimits({ PASSWORD_MEMORY_KIB: "4", PASSWORD_PASSES: "0" })).toMatchObject({ passwordMemoryKib: 19_456, passwordPasses: 2 });
  });
});

describe("limit store", () => {
  const make = async (env: Record<string, number> = {}, schema?: readonly LimitField[]) => {
    const { db } = await openDatabase(":memory:");
    return new LimitStore(new SettingsRepo(db), { ...envLimits({}, schema), ...env }, schema);
  };

  it("layers: default, environment, database, and null gives a value back", async () => {
    const store = await make({ loginUser: 3 });
    await store.load();
    expect(store.get("loginUser")).toBe(3);
    expect(store.view().find((v) => v.key === "loginUser")?.source).toBe("environment");
    expect(store.view().find((v) => v.key === "loginIp")?.source).toBe("default");
    const r = await store.save({ loginUser: 7 });
    expect(r.changed).toEqual([{ key: "loginUser", from: 3, to: 7 }]);
    expect(store.view().find((v) => v.key === "loginUser")).toMatchObject({ value: 7, source: "database" });
    await store.save({ loginUser: null });
    expect(store.get("loginUser")).toBe(3);
  });

  it("refuses a field or a value outside the schema and stores nothing", async () => {
    const store = await make();
    await expect(store.save({ nope: 1 })).rejects.toThrow();
    await expect(store.save({ loginUser: 0 })).rejects.toThrow();
    await expect(store.save({ loginUser: 1.5 })).rejects.toThrow();
    await expect(store.save({ loginUser: "5" })).rejects.toThrow();
    await expect(store.save({ passwordMemoryKib: 8 })).rejects.toThrow();
    await expect(store.save({ passwordPasses: 1 })).rejects.toThrow();
    await expect(store.save({ passwordMemoryKib: 1_000_000 })).rejects.toThrow();
    await expect(store.save({ historyDays: 100 })).rejects.toThrow();
    await expect(store.save({ loginIp: 20, loginUser: 99_999 })).rejects.toThrow();
    expect(store.get("loginIp")).toBe(50);
  });

  it("two saves at once both hold", async () => {
    const store = await make();
    await Promise.all([store.save({ loginIp: 7 }), store.save({ loginUser: 3 })]);
    await store.load(true);
    expect([store.get("loginIp"), store.get("loginUser")]).toEqual([7, 3]);
  });

  it("names the changes that need a restart, and a schema can hold the parameters of another password hash", async () => {
    const argon: LimitField[] = [
      { key: "memoryKib", type: "int", default: 19_456, min: 8_192, max: 1_048_576, restart: false, env: "ARGON_MEMORY_KIB", label: "Muisti" },
      { key: "passes", type: "int", default: 2, min: 1, max: 10, restart: true, env: "ARGON_PASSES", label: "Kierrokset" },
    ];
    const store = await make({}, argon);
    expect(await store.save({ memoryKib: 65_536, passes: 3 })).toEqual({
      changed: [{ key: "memoryKib", from: 19_456, to: 65_536 }, { key: "passes", from: 2, to: 3 }],
      restart: ["passes"],
    });
  });

  it("a row edited by hand with a value outside the schema is ignored", async () => {
    const { db } = await openDatabase(":memory:");
    const settings = new SettingsRepo(db);
    await settings.set("limits", JSON.stringify({ loginUser: -4, loginIp: 12 }));
    const store = new LimitStore(settings, envLimits({}));
    await store.load();
    expect([store.get("loginUser"), store.get("loginIp")]).toEqual([10, 12]);
  });
});

describe("limits in the app", () => {
  it("is admin only, answers 400 outside the schema and writes a security event", async () => {
    const { admin, member } = await setupApp();
    const eero = await member("eero");
    expect((await eero.call("GET", "/api/admin/limits")).status).toBe(403);
    expect((await eero.call("PUT", "/api/admin/limits", { loginUser: 3 })).status).toBe(403);
    expect((await admin.call("PUT", "/api/admin/limits", { loginUser: 0 })).status).toBe(400);
    expect((await admin.call("PUT", "/api/admin/limits", { unknown: 1 })).status).toBe(400);
    expect((await admin.call("PUT", "/api/admin/limits", [1])).status).toBe(400);
    const ok = await admin.call("PUT", "/api/admin/limits", { loginUser: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body.restart).toEqual([]);
    const events = (await admin.call("GET", "/api/security/events?kind=limits_changed")).body.events;
    expect(events).toHaveLength(1);
    expect(events[0].detail).toBe("loginUser 10 > 3");
  });

  it("a changed sign-in limit holds from the next attempt, with no restart", async () => {
    const { admin, client } = await setupApp();
    const wrong = () => client().call("POST", "/api/auth/login", { username: "aino", password: "wrong-password-1" });
    await admin.call("PUT", "/api/admin/limits", { loginUser: 2 });
    expect((await wrong()).status).toBe(401);
    expect((await wrong()).status).toBe(401);
    expect((await wrong()).status).toBe(429);
  });

  it("a changed request size holds from the next request", async () => {
    const { admin } = await setupApp();
    const big = { username: "x", displayName: "x".repeat(40 * 1024) };
    expect((await admin.call("POST", "/api/users", big)).status).not.toBe(413);
    await admin.call("PUT", "/api/admin/limits", { requestKb: 16 });
    expect((await admin.call("POST", "/api/users", big)).status).toBe(413);
  });
});

describe("hash memory budget", () => {
  it("refuses slots times memory over 128 MiB in a save, and drops such a pair from the environment", async () => {
    const { db } = await openDatabase(":memory:");
    const store = new LimitStore(new SettingsRepo(db), envLimits({}), undefined);
    await expect(store.save({ hashSlots: 64 })).rejects.toThrow(/enintään 128 Mt/);
    await expect(store.save({ passwordMemoryKib: 32_768, hashSlots: 5 })).rejects.toThrow(/enintään 128 Mt/);
    await expect(store.save({ hashSlots: 4, passwordMemoryKib: 32_768 })).resolves.toBeTruthy();
    expect(envLimits({ HASH_SLOTS: "64" })).toMatchObject({ hashSlots: 4, passwordMemoryKib: 19_456 });
  });
});
