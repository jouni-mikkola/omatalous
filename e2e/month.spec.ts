import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, watch } from "./helpers.ts";

// Kuukausi, the second tab: the running month's categories against their usual to the same day, the largest gap first.
// A category's sum opens the rows it is made of, and they add up to it. The demo household of the administrator
// (e2e/run.mjs made it) is read and nothing is changed.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const width of [1280, 390]) {
  test(`Kuukausi is a tab at ${width} px: a category opens rows that add up to its sum`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/overview");
    await page.getByRole("navigation").getByRole("link", { name: "Kuukausi", exact: true }).first().click();
    await expect(page).toHaveURL(/#\/reports$/);
    await expect(page).toHaveTitle(/^Kuukausi/);
    const view = page.locator(".km");
    await expect(view.locator(".km-total")).toContainText(/Menot\s[\d\s]+€/, { timeout: 15_000 });
    // no question list, no period switch: the month has neither
    await expect(page.locator(".q-frame")).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Aikaväli" })).toHaveCount(0);

    // the list is in the order of the gap, the largest first (the rest row, which opens nothing, is last)
    const doors = view.getByRole("button", { name: /^Näytä tapahtumat: / });
    await expect(doors.first()).toBeVisible();
    const report = await (await context.request.get("/api/reports?reports=thisMonth")).json();
    const gaps = (report.thisMonth.categories as { category: string | null; gapCents: number }[]).filter((c) => c.category !== null).map((c) => c.gapCents);
    expect(gaps.length).toBeGreaterThan(0);
    await expect(doors).toHaveCount(gaps.length);
    const names = await view.locator("tbody th[scope=row]").allInnerTexts();
    const expected = (report.thisMonth.categories as { category: string | null; label: string; gapCents: number }[])
      .filter((c) => c.category !== null)
      .sort((a, b) => b.gapCents - a.gapCents)
      .map((c) => c.label);
    expect(names.slice(0, expected.length)).toEqual(expected);

    // each category's sum is its rows to the cent
    for (let i = 0; i < gaps.length; i++) {
      const door = doors.nth(i);
      const figure = cents(await door.innerText());
      if (figure === 0) continue;
      await door.click();
      const panel = page.getByRole("dialog");
      await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
      const more = panel.getByRole("button", { name: "Näytä kaikki" });
      if (await more.count()) await more.click();
      const rows = await panel.locator("tr[data-why-row] td.num").allInnerTexts();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.reduce((sum, text) => sum + cents(text), 0), `the rows of category ${i + 1}`).toBe(figure);
      await expect(panel.getByRole("status").filter({ hasText: "Täsmää" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
