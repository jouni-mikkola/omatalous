/** "Tuo tiedot" on a household of PB1's size. Its own file, so that the check's parts can share it out apart from data-roundtrip.test.ts. */
import { describe, expect, it } from "vitest";
import { exportOf, importFile } from "./data-import-kit.ts";
import { perfHousehold } from "./perf-household.ts";
import { setupApp } from "./helpers.ts";

// the time of the import is in data-roundtrip.perf.test.ts
describe("a household of PB1's size", () => {
  it("imports into an empty instance, and a second time adds nothing", async () => {
    const w = await perfHousehold();
    // the administrator is aino whichever of the two ids sorts first; the empty instance has the same username
    const file = await exportOf(w.admin);
    expect(file.transactions.length).toBeGreaterThan(5000);
    const empty = await setupApp();
    expect((await empty.member("ville", "Ville")).id).toBeTruthy();
    const first = await importFile(empty.admin, file);
    expect(first.done.total.add).toBeGreaterThan(5000);
    const again = await importFile(empty.admin, file);
    expect(again.dry.total.add).toBe(0);
  }, 180_000);
});
