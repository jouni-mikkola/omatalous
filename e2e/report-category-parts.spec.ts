import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, unfold, watch } from "./helpers.ts";

// The parts of a category in the spending table of Raportit: the server's parts open under the row, in its order and to the
// cent. The shared build has none, so the answer is given a few here.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

type Row = { category: string; label: string; totalCents: number; count: number; parts?: unknown };

for (const width of [1280, 390]) {
  test(`a category row of the spending table opens to the parts the server gives at ${width}`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    const page = await context.newPage();
    const seen = watch(page);
    let label = "";
    await page.route("**/api/reports?**", async (route) => {
      const answer = await route.fetch();
      const json = await answer.json();
      const rows = json.spendingTable.rows as Row[];
      const row = rows.find((x) => x.count > 0 && x.totalCents > 1000)!;
      label = row.label;
      const first = Math.round(row.totalCents * 0.6);
      row.parts = [
        { id: "p1", label: "Osa yksi", cents: first, estimated: false },
        { id: "p2", label: "Osa kaksi", cents: row.totalCents - first, estimated: true },
      ];
      await route.fulfill({ response: answer, json });
    });
    await page.goto("/#/reports?q=menot");
    await unfold(page, "kategoriat");
    const drill = page.locator("#kategoriat").getByRole("button", { name: /^Tapahtumat: / }).first();
    await drill.scrollIntoViewIfNeeded({ timeout: 20_000 });
    await drill.click();
    const parts = page.getByRole("table", { name: `Menot osittain: ${label}` });
    await expect(parts).toBeVisible();
    await expect(parts.getByRole("rowheader")).toHaveText(["Osa yksi", "Osa kaksi"]);
    await expect(parts.locator(".fig-approx-sign")).toHaveCount(1);
    expect(await overflow(page)).toBe(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
