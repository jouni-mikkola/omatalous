import { afterEach, describe, expect, it, vi } from "vitest";
import { LINK_STATE_PREFIX } from "../src/connectors/link-state.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { setupApp } from "./helpers.ts";

afterEach(() => vi.restoreAllMocks());

const CHORES = ["sweeping the offsite request", "deleting expired sessions", "pruning events", "expiring stale requests", "cleaning bank link states"];

describe("hourlyTick when one chore throws", () => {
  for (const [failing, name] of CHORES.entries()) {
    it(`survives: ${name}`, async () => {
      const t = await setupApp({}, (async () => new Response("{}", { status: 503 })) as typeof fetch);
      const s = t.s;
      const boom = new Error("secret-user-data");
      const spies = [
        vi.spyOn(s.ops, "recent"),
        vi.spyOn(s.users, "deleteExpiredSessions"),
        vi.spyOn(s.security, "prune"),
        vi.spyOn(s.ops, "queuedBefore"),
        vi.spyOn(s.settings, "deleteOlder"),
      ];
      spies[failing]!.mockRejectedValue(boom);
      const err = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(hourlyTick(s)).resolves.toBeDefined();

      spies.forEach((spy, i) => {
        if (i !== failing) expect(spy).toHaveBeenCalled();
      });
      expect(spies[4]!.mock.calls.length > 0 || failing === 4).toBe(true);
      if (failing !== 4) expect(spies[4]!.mock.calls.some((c) => c[0] === LINK_STATE_PREFIX)).toBe(true);
      const lines = err.mock.calls.filter((c) => String(c[0]).includes("hourly chore failed"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toHaveLength(1);
      expect(String(lines[0]![0])).toContain(name);
      expect(JSON.stringify(err.mock.calls)).not.toContain("secret-user-data");
    });
  }
});
