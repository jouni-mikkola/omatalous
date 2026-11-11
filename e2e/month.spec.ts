import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, plain, watch } from "./helpers.ts";

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

  // The arrows step a month: the month before is in the address and read whole, each category against its usual, and the
  // step forward is today's answer again with no month in the address.
  test(`Kuukausi steps back a month and forward again at ${width} px`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/reports");
    const view = page.locator(".km");
    const total = view.locator(".km-total");
    await expect(total).toContainText(/Menot\s[\d\s]+€/, { timeout: 15_000 });
    const forward = view.getByRole("button", { name: "Seuraava kuukausi", exact: true });
    await expect(forward).toBeDisabled();
    const today = { title: await view.locator(".km-title").innerText(), total: await total.innerText(), names: await view.locator("tbody th[scope=row]").allInnerTexts() };

    const { today: day } = (await (await context.request.get("/api/meta")).json()) as { today: string };
    const [y, m] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
    const month = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

    await view.getByRole("button", { name: "Edellinen kuukausi", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/reports\\?month=${month}$`));
    // the whole month, its first day to its last
    await expect(view.locator(".km-title")).toHaveText(new RegExp(`^1\\.[–-]${last}\\.${Number(month.slice(5, 7))}\\.`), { timeout: 15_000 });
    const report = await (await context.request.get(`/api/reports?from=${month}-01&to=${month}-${last}&reports=spendingChange`)).json();
    type Row = { category: string | null; label: string; nowCents: number; baseCents: number; changeCents: number };
    const change = (report.spendingChange.views as { view: string; change: { nowCents: number; baseCents: number; changeCents: number; categories: Row[] } }[]).find((v) => v.view === "expected")?.change;
    expect(change, "the month before has a usual level").toBeTruthy();
    const named = change!.categories.filter((c) => c.category !== null);
    expect(named.length).toBeGreaterThan(0);
    // every category's sum and its usual, the largest gap first; the gaps add up to the month's
    const lines = view.locator("tbody tr");
    await expect(lines).toHaveCount(change!.categories.length);
    // the sort is stable, as the page's is: two categories with the same gap stay in the server's order in both
    const sorted = [...named].sort((a, b) => b.changeCents - a.changeCents);
    for (const [i, c] of sorted.entries()) {
      const line = lines.nth(i);
      await expect(line.locator("th[scope=row]")).toHaveText(c.label);
      expect(cents(await line.getByRole("button", { name: /^Näytä tapahtumat: / }).innerText()), `${c.label}, spent`).toBe(c.nowCents);
      expect(cents(await line.locator(".km-usual").innerText()), `${c.label}, usual`).toBe(c.baseCents);
    }
    expect(change!.categories.reduce((sum, c) => sum + c.changeCents, 0)).toBe(change!.changeCents);
    expect(change!.changeCents).toBe(change!.nowCents - change!.baseCents);
    // the total line says both in whole euros
    const [spent, usual] = [...plain(await total.innerText()).split("(")[0]!.matchAll(/([\d ]+) €/g)].map((found) => Number(found[1]!.replace(/ /g, "")));
    expect(Math.abs(spent! - change!.nowCents / 100)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(usual! - change!.baseCents / 100)).toBeLessThanOrEqual(0.5);

    // a category of the month before opens the rows of that whole month, and they add up to its sum
    const door = lines.first().getByRole("button", { name: /^Näytä tapahtumat: / });
    const figure = cents(await door.innerText());
    await door.click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    const more = panel.getByRole("button", { name: "Näytä kaikki" });
    if (await more.count()) await more.click();
    const sums = await panel.locator("tr[data-why-row] td.num").allInnerTexts();
    expect(sums.reduce((sum, text) => sum + cents(text), 0)).toBe(figure);
    await expect(panel.getByRole("status").filter({ hasText: "Täsmää" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // the address alone opens the same month
    await page.reload();
    await expect(view.locator(".km-title")).toHaveText(new RegExp(`^1\\.[–-]${last}\\.${Number(month.slice(5, 7))}\\.`), { timeout: 15_000 });

    // forward again: today's answer, no month in the address
    await forward.click();
    await expect(page).toHaveURL(/#\/reports$/);
    await expect(view.locator(".km-title")).toHaveText(today.title, { timeout: 15_000 });
    await expect(total).toHaveText(today.total);
    expect(await view.locator("tbody th[scope=row]").allInnerTexts()).toEqual(today.names);
    await expect(forward).toBeDisabled();
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
