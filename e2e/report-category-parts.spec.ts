import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, unfold, watch } from "./helpers.ts";

// The parts of a category in Menot osittain of Raportit: the server's parts of a category (`categories`) stand under its name,
// in its order and to the cent. The shared build has none, so the answer is given a few here.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

type Stat = { category: string; totalCents: number; parts?: unknown };
type Answer = { categories: { groups: { categories: Stat[] }[] } };

for (const width of [1280, 390]) {
  test(`a category row of the spending table opens to the parts the server gives at ${width}`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    const page = await context.newPage();
    const seen = watch(page);
    await page.route("**/api/reports?**", async (route) => {
      const answer = await route.fetch();
      const json = (await answer.json()) as Answer;
      const row = json.categories?.groups.flatMap((g) => g.categories).find((x) => x.totalCents > 1000);
      if (!row) return route.fulfill({ response: answer, json });
      const first = Math.round(row.totalCents * 0.6);
      row.parts = [
        { id: "p1", label: "Osa yksi", cents: first, estimated: false },
        { id: "p2", label: "Osa kaksi", cents: row.totalCents - first, estimated: true },
      ];
      await route.fulfill({ response: answer, json });
    });
    await page.goto("/#/reports?q=menot");
    await unfold(page, "osittain");
    const parts = page.locator("#osittain").getByRole("table", { name: "Menot osittain" });
    await parts.scrollIntoViewIfNeeded({ timeout: 20_000 });
    await expect(parts).toBeVisible();
    await expect(parts.locator("tbody tr:not(.rt-group) th")).toHaveText(["Osa yksi", "Osa kaksi"]);
    await expect(parts.locator(".fig-approx-sign")).toHaveCount(1);
    expect(await overflow(page)).toBe(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
