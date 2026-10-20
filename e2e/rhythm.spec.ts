import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// VC3: the calendar of days, the slope of the year comparison, Mikä muuttui and the heat map of months under their
// questions, read by the keyboard, and fit a phone.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Menot päivittäin reads a day by the arrow keys and names the usual day the shade is set against", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?tab=menot#paivat");
  const card = page.locator("#paivat");
  await expect(card.getByRole("heading", { name: "Minä päivinä rahaa menee?" })).toBeVisible();
  const grid = card.locator(".calendar-grid");
  await grid.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(card.locator(".tooltip")).toContainText("Menot");
  await expect(card.locator(".calendar-day.active")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(card.locator(".tooltip")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("at 390 px Mikä muuttui ranks whole names, the heat map opens on its answer with one ring, and the calendar names its window", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?tab=menot");
  const heat = page.locator("#kuukaudet");
  await expect(heat.locator(".heat-grid rect.heat-cell").first()).toBeVisible();
  const shift = page.locator("#siirtymat");
  if (await shift.count()) {
    // a ranked table of whole names, no slope beside it
    await expect(shift.locator(".slope-chart")).toHaveCount(0);
    expect((await shift.locator(".shift-table tbody td:first-child").allInnerTexts()).some((t) => t.includes("…"))).toBe(false);
    expect(await shift.evaluate((c) => c.scrollWidth <= c.clientWidth + 1), "the table fits its card at 390px").toBe(true);
  }
  const years = page.locator("#vuodet");
  if (await years.locator(".slope-chart").count()) {
    await years.locator(".slope-chart g[role=group]").focus();
    await expect(years.locator(".tooltip")).toContainText("Muutos");
    expect(await years.evaluate((c) => c.scrollWidth <= c.clientWidth + 1), "the slope fits its card at 390px").toBe(true);
  }
  // the heat map rings the one cell its answer names, and opens on the months that hold it
  const answer = await heat.locator(".qc-a").innerText();
  expect(await heat.locator(".heat-peak").count()).toBeLessThanOrEqual(1);
  if (await heat.locator(".heat-peak").count()) {
    await expect(heat.locator(".heat-peak")).toBeVisible();
    expect(answer).toMatch(/tavallisesti/);
  }
  const older = heat.getByRole("button", { name: "← Aiemmat" });
  if (await older.isEnabled().catch(() => false)) {
    await older.click();
    await expect(heat.getByRole("button", { name: "Uudemmat →" })).toBeEnabled();
  }
  expect(await heat.evaluate((c) => c.scrollWidth <= c.clientWidth + 1), "the heat map fits its card at 390px").toBe(true);
  // the calendar's head names its window; the top days listed are the ones the phone's 13 weeks ring, numbered as ringed
  const days = page.locator("#paivat");
  await expect(days.locator(".calendar-day").first()).toBeVisible();
  await expect(days.locator(".card-datum")).toContainText(/(viikon|päivän) menot/);
  await expect(days.locator(".calendar-cut")).toBeVisible();
  const ringed = await days.locator(".calendar-top text").allTextContents();
  const listed = await days.locator(".calendar-notes .badge-n").allTextContents();
  expect(listed).toEqual(ringed);
  expect(seen.problems).toEqual([]);
  await context.close();
});
