import { describe, expect, it } from "vitest";
import { heldImportSessions, startImport } from "../src/services/data-import-session.ts";
import { IMPORT_FORMAT, IMPORT_VERSION } from "../src/services/data-import-stores.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { setupApp } from "./helpers.ts";

describe("abandoned import sessions", () => {
  it("are dropped by the hourly tick, not only by the next import call", async () => {
    const clock = { now: new Date("2026-10-09T10:00:00Z") };
    const { s, adminId } = await setupApp({}, undefined, { now: () => clock.now });
    startImport(s, { id: adminId, username: "aino", role: "admin" }, { format: IMPORT_FORMAT, version: IMPORT_VERSION });
    expect(heldImportSessions(s)).toBe(1);
    // within its 15 minutes the session stays
    clock.now = new Date("2026-10-09T10:05:00Z");
    await hourlyTick(s);
    expect(heldImportSessions(s)).toBe(1);
    // an hour later nobody has used it: the tick frees the staged rows with no import call at all
    clock.now = new Date("2026-10-09T11:05:00Z");
    await hourlyTick(s);
    expect(heldImportSessions(s)).toBe(0);
  });
});
