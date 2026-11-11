import { afterEach, describe, expect, it, vi } from "vitest";
import { LINK_STATE_PREFIX } from "../src/connectors/link-state.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { setupApp } from "./helpers.ts";

afterEach(() => vi.restoreAllMocks());

describe("hourlyTick when the fetch throws", () => {
  it("still does the rest of the tick and logs one line", async () => {
    const calls: string[] = [];
    const fetchMock = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
    const t = await setupApp({}, fetchMock);
    const s = t.s;
    await s.instance.save({ syncHours: [13], priceIndex: true }); // 10:00 UTC is 13:00 in Helsinki
    const now = s.now();
    await s.users.createSession("old-session", t.adminId, new Date(now.getTime() - 3600_000).toISOString(), null, new Date(now.getTime() - 86_400_000));
    await s.settings.set(`${LINK_STATE_PREFIX}old`, "x");
    const old = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    await s.db.run("UPDATE settings SET updated_at = ? WHERE key = ?", [old, `${LINK_STATE_PREFIX}old`]);
    // the list of members cannot be read, so syncEveryone throws (a module mock does not hold in files that share modules)
    vi.spyOn(s.users, "usersWithActiveConnections").mockRejectedValue(new Error("members cannot be read"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const tick = await hourlyTick(s);

    expect(tick.synced).toBeNull();
    expect(tick.lookup).not.toBeNull();
    expect(calls.some((u) => u.includes("statfin"))).toBe(true);
    expect(await s.users.getSession("old-session")).toBeNull();
    expect(await s.settings.get(`${LINK_STATE_PREFIX}old`)).toBeNull();
    expect(err.mock.calls.filter((c) => String(c[0]).includes("scheduled fetch"))).toHaveLength(1);
  });
});
