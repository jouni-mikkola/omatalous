import { afterEach, describe, expect, it, vi } from "vitest";
import { setupApp } from "./helpers.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/health", () => {
  it("is ok on a healthy database and caches the integrity check for an hour", async () => {
    const clock = { now: new Date("2026-10-09T10:00:00Z") };
    const t = await setupApp({}, undefined, { now: () => clock.now });
    const all = vi.spyOn(t.s.db, "all");
    const res = await t.app.request("http://localhost:8080/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await t.app.request("http://localhost:8080/api/health");
    expect(all.mock.calls.filter((c) => String(c[0]).includes("quick_check"))).toHaveLength(1);
    clock.now = new Date("2026-10-09T11:00:01Z");
    await t.app.request("http://localhost:8080/api/health");
    expect(all.mock.calls.filter((c) => String(c[0]).includes("quick_check"))).toHaveLength(2);
  });

  it("answers 503 with a reason when the database cannot be read or fails quick_check, and recovers", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const clock = { now: new Date("2026-10-09T10:00:00Z") };
    const t = await setupApp({}, undefined, { now: () => clock.now });
    const get = () => t.app.request("http://localhost:8080/api/health");

    const first = vi.spyOn(t.s.db, "first").mockRejectedValue(new Error("database disk image is malformed"));
    let res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "database unreadable" });
    expect(errors.mock.calls.flat().join(" ")).toMatch(/health: the database cannot be read: database disk image is malformed/);
    first.mockRestore();

    clock.now = new Date("2026-10-09T10:01:01Z");
    const all = vi.spyOn(t.s.db, "all").mockResolvedValue([{ quick_check: "*** in database main ***\nPage 3: btreeInitPage() returns error code 11" }]);
    res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "database damaged" });
    // a failure is not re-checked within a minute
    const calls = all.mock.calls.length;
    await get();
    expect(all.mock.calls.length).toBe(calls);
    all.mockRestore();

    clock.now = new Date("2026-10-09T10:03:00Z");
    expect((await get()).status).toBe(200);
    // the public answer never carries details
    expect(JSON.stringify(await (await get()).json())).not.toMatch(/malformed|Page 3/);
  });
});
