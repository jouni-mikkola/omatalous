import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// The frame of Raportit: one report open at a time under the tabs of them all.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("a report in the list opens its page and keeps the period; a phone shows the tabs in one row with targets of 44 px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?period=6m");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("button")).toHaveCount(0);
  await expect(list.getByRole("link", { name: "Menot kategorioittain" })).toBeVisible();
  for (const link of await list.getByRole("link").all()) {
    const box = (await link.boundingBox())!;
    expect(box.height, "a target of 44 px").toBeGreaterThanOrEqual(44);
    expect(box.x, "the first tab starts inside the screen").toBeGreaterThanOrEqual(0);
  }
  const first = list.getByRole("link").first();
  await first.focus();
  expect(await first.evaluate((el) => Number.parseFloat(getComputedStyle(el).outlineOffset)), "the ring of a tab sits inside it, where the scrolling row does not clip it").toBeLessThan(0);
  await expect(list.getByRole("link", { name: "Tulot ja menot" })).toHaveAttribute("aria-current", "true");
  await list.getByRole("link", { name: "Menot kategorioittain" }).click();
  await expect(page.locator("h2.q-title", { hasText: "Menot kategorioittain" })).toBeVisible();
  await expect(list.getByRole("link", { name: "Menot kategorioittain" })).toHaveAttribute("aria-current", "true");
  expect(new URL(page.url()).hash).toMatch(/q=menot/);
  expect(new URL(page.url()).hash).toContain("period=6m");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll at 390 px").toBe(true);
  expect(seen.problems).toEqual([]);
  await context.close();
});

// The demo has two reports, which fit a phone. Copies of the last tab make the row longer than the screen, as the shared household's third tab and a longer wording would.
test("tabs that do not fit a phone scroll sideways inside their row and the last one can be reached", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?period=6m");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("link").first()).toBeVisible();
  await list.evaluate((nav) => {
    const items = nav.querySelectorAll("li");
    const last = items[items.length - 1]!;
    for (let i = 0; i < 3; i++) {
      const copy = last.cloneNode(true) as HTMLElement;
      copy.querySelector("a")!.textContent = `Pitkä raportin nimi ${i + 1}`;
      last.parentElement!.append(copy);
    }
  });
  const widths = await list.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(widths.scroll, "the row is longer than its box").toBeGreaterThan(widths.client);
  expect(await list.evaluate((el) => el.scrollLeft), "it starts at the left").toBe(0);
  const end = list.getByRole("link").last();
  await end.focus();
  expect(await list.evaluate((el) => el.scrollLeft), "focusing the last tab scrolls the row").toBeGreaterThan(0);
  const box = (await end.boundingBox())!;
  expect(box.x, "the last tab is inside the screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "the last tab is inside the screen").toBeLessThanOrEqual(390 + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the page does not scroll sideways").toBe(true);
  expect(seen.problems).toEqual([]);
  await context.close();
});

// Twelve months share a phone's width, so a column cannot be 44 px wide there: the least it keeps is the floor of a target (WCAG 2.5.8)
test("a month of the chart on Tulot ja menot is a column as high as a thumb and as wide as the floor of a target on a phone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=tulot");
  const months = page.locator("a.mb-link");
  await expect(months.first()).toBeAttached();
  const { tapMin, tapFloor } = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { tapMin: Number.parseFloat(style.getPropertyValue("--tap-min")), tapFloor: Number.parseFloat(style.getPropertyValue("--tap-floor")) };
  });
  expect([tapMin, tapFloor], "the tokens of the target rule").toEqual([44, 24]);
  const columns = await page.locator("a.mb-link rect").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  expect(columns.length, "the months of the chart").toBeGreaterThan(0);
  for (const box of columns) {
    expect(box.height, "a month's column is as high as a thumb (--tap-min)").toBeGreaterThanOrEqual(tapMin);
    expect(box.width, "a month's column is as wide as the floor of a target (--tap-floor)").toBeGreaterThanOrEqual(tapFloor);
  }
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a household with no shared account has no Yhteiset menot report and no such page", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=menot");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("link").first()).toBeVisible();
  await expect(list.getByRole("link", { name: /yhteiset/i })).toHaveCount(0);
  await expect(list.locator("[aria-current]")).toHaveText("Menot kategorioittain");
  await page.goto("/#/reports?q=yhteiset");
  await expect(page.getByRole("heading", { name: "Yhteiset menot", level: 2, exact: true })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});
