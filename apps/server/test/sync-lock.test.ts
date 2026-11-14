/** The lock of a user's fetch: renewed while the fetch works, taken over once it expires, released only by its owner. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncUser } from "../src/connectors/sync.ts";
import { LOCK_TTL_MS, takeSyncLock } from "../src/connectors/sync-lock.ts";
import { setupApp } from "./helpers.ts";

const KEY = "sync_lock:u1";
const MINUTE = 60_000;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the owner of a lock", () => {
  it("lets a lock that was not renewed expire and be taken over, and the old owner can neither renew nor release it", async () => {
    const { s } = await setupApp();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
    expect(await s.settings.tryLockAs(KEY, LOCK_TTL_MS, "old")).toBe(true);
    expect(await s.settings.tryLockAs(KEY, LOCK_TTL_MS, "other")).toBe(false);

    vi.setSystemTime(new Date("2026-10-09T10:16:00Z"));
    expect(await s.settings.tryLockAs(KEY, LOCK_TTL_MS, "new")).toBe(true);
    expect(await s.settings.renewLock(KEY, "old")).toBe(false);
    await s.settings.releaseLock(KEY, "old");
    expect((await s.settings.get(KEY))?.endsWith(":new")).toBe(true);

    await s.settings.releaseLock(KEY, "new");
    expect(await s.settings.get(KEY)).toBeNull();
  });

  it("keeps a lock that is renewed past its time to live", async () => {
    const { s } = await setupApp();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
    await s.settings.tryLockAs(KEY, LOCK_TTL_MS, "a");
    vi.setSystemTime(new Date("2026-10-09T10:10:00Z"));
    expect(await s.settings.renewLock(KEY, "a")).toBe(true);
    // 20 minutes after the start, 10 after the renewal
    vi.setSystemTime(new Date("2026-10-09T10:20:00Z"));
    expect(await s.settings.tryLockAs(KEY, LOCK_TTL_MS, "b")).toBe(false);
    vi.setSystemTime(new Date(Date.parse("2026-10-09T10:10:00Z") + LOCK_TTL_MS + MINUTE));
    expect(await s.settings.tryLockAs(KEY, LOCK_TTL_MS, "b")).toBe(true);
  });

  it("still sees a lock written by tryLock as held, and as expired when it is old", async () => {
    const { s } = await setupApp();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
    await s.settings.tryLock(KEY, LOCK_TTL_MS);
    expect(await s.settings.tryLockAs(KEY, LOCK_TTL_MS, "a")).toBe(false);
    vi.setSystemTime(new Date("2026-10-09T10:16:00Z"));
    expect(await s.settings.tryLockAs(KEY, LOCK_TTL_MS, "a")).toBe(true);
  });
});

describe("the heartbeat of a fetch", () => {
  it("renews the lock while the holder works, so a contender never gets it after the time to live", async () => {
    const { s } = await setupApp();
    const ttl = 400;
    const lock = await takeSyncLock(s.settings, KEY, ttl, 20);
    expect(lock).not.toBeNull();
    await new Promise((r) => setTimeout(r, ttl * 2));
    expect(await s.settings.tryLockAs(KEY, ttl, "contender")).toBe(false);
    await lock!.release();
    expect(await s.settings.get(KEY)).toBeNull();
    expect(await takeSyncLock(s.settings, KEY, ttl, 20)).not.toBeNull();
  });

  it("leaves the lock of the run that took it over when the old holder finishes", async () => {
    const { s } = await setupApp();
    const ttl = 100;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const old = await takeSyncLock(s.settings, KEY, ttl, 1_000_000);
    await new Promise((r) => setTimeout(r, ttl + 50));
    expect(await s.settings.tryLockAs(KEY, ttl, "new")).toBe(true);
    await old!.release();
    expect((await s.settings.get(KEY))?.endsWith(":new")).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });

  it("reports and stops renewing a lock another run has taken over", async () => {
    const { s } = await setupApp();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const lock = await takeSyncLock(s.settings, KEY, 1_000, 20);
    await s.settings.set(KEY, `${Date.now()}:new`);
    await new Promise((r) => setTimeout(r, 120));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]![0]).toContain("taken over");
    await lock!.release();
    expect((await s.settings.get(KEY))?.endsWith(":new")).toBe(true);
  });
});

describe("a fetch of a user", () => {
  it("does not remove the lock of a run that took the lock over while it was working", async () => {
    const { s, adminId } = await setupApp();
    const key = `sync_lock:${adminId}`;
    const takeOver = `${Date.now()}:new`;
    const get = s.settings.get.bind(s.settings);
    vi.spyOn(s.settings, "get").mockImplementation(async (k) => {
      // the first read of the fetch: the lock has expired meanwhile and another run holds it
      if (k.startsWith("fetch_problems:")) await s.settings.set(key, takeOver);
      return get(k);
    });
    expect((await syncUser(s, adminId, "manual")).status).toBe("ok");
    expect(await s.settings.get(key)).toBe(takeOver);
  });

  it("releases its own lock when it finishes, and skips while another run holds it", async () => {
    const { s, adminId } = await setupApp();
    expect((await syncUser(s, adminId, "manual")).status).toBe("ok");
    expect(await s.settings.get(`sync_lock:${adminId}`)).toBeNull();
    await s.settings.tryLockAs(`sync_lock:${adminId}`, LOCK_TTL_MS, "other");
    expect((await syncUser(s, adminId, "manual")).status).toBe("skipped");
  });
});
