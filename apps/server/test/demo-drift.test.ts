import { describe, expect, it } from "vitest";
import { loadDemoData } from "../src/demo.ts";
import { setupApp } from "./helpers.ts";

// Nousseet menot and CP1's price split need a household whose spending stepped up: the demo has two, so the page can be
// seen and pictured without made-up answers (critic round 3)
describe("the demo household", () => {
  it("has two categories over their usual level the last three months, one of them split into prices and quantity", async () => {
    const { s, adminId, admin } = await setupApp();
    await loadDemoData(s.finance(adminId), s.settings, s.today());
    const res = await admin.call("GET", "/api/reports?reports=drift");
    const items = (res.body as { drift: { items: { category: string; prices: unknown }[] } }).drift.items;
    expect(items.map((i) => i.category).sort()).toEqual(["groceries", "personal_care"]);
    expect(items.some((i) => i.prices !== null)).toBe(true);
  });
});
