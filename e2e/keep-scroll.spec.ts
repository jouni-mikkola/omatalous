import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// A drill stored in the address and a period chip change the address without changing the page: the reader stays where
// they are. The router put such a change at the top of the page, so the opened row ended up far below the view.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

for (const width of [1440, 390]) {
  test(`${width} px: opening and closing a row of Kategoriat keeps the scroll and the row in view`, async ({ browser }) => {
    const context = await browser.newContext({
      storageState: STATE,
      viewport: { width, height: 900 },
      ...(width < 600 ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/reports?q=menot");
    const table = page.getByRole("table", { name: "Kategoriat" });
    await expect(table).toBeVisible();
    const first = table.locator('button.rt-drill[aria-expanded="false"]:visible').first();
    await expect(first).toBeVisible();
    // the same row once it is open: the first closed one is another row then
    const button = table.locator(`button.rt-drill[data-drill="${await first.getAttribute("data-drill")}"]`);
    // the row a little under the top of the window, far below the first screen
    await button.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 250));
    const before = await scrollY(page);
    expect(before, "the page is scrolled down").toBeGreaterThan(200);

    const inView = async () => {
      const box = (await button.boundingBox())!;
      return box.y >= 0 && box.y + box.height <= (await page.evaluate(() => window.innerHeight));
    };
    expect(await inView(), "the row is in view before it opens").toBe(true);

    // the button's own click: the page is not scrolled to it first, so the position is the one set above
    await button.dispatchEvent("click");
    await expect.poll(() => new URL(page.url()).hash).toContain("drill=");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.waitForLoadState("networkidle");
    expect(Math.abs((await scrollY(page)) - before), "the page stays where it was when the row opens").toBeLessThanOrEqual(60);
    expect(await scrollY(page)).toBeGreaterThan(0);
    expect(await inView(), "the opened row is in view").toBe(true);

    await button.dispatchEvent("click");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => new URL(page.url()).hash).not.toContain("drill=");
    expect(Math.abs((await scrollY(page)) - before), "the page stays where it was when the row closes").toBeLessThanOrEqual(60);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("1440 px: a period chip of Raportit keeps the scroll", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=tulot");
  const chip = page.getByRole("toolbar", { name: "Aikaväli" }).getByRole("button", { name: "3 kk" });
  await expect(chip).toBeVisible();
  await expect(page.locator("#tulot-ja-menot")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 400));
  const before = await scrollY(page);
  expect(before).toBeGreaterThan(200);
  await chip.dispatchEvent("click");
  await expect.poll(() => new URL(page.url()).hash).toContain("period=3m");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await page.waitForLoadState("networkidle");
  expect(Math.abs((await scrollY(page)) - before), "the page stays where it was when the period changes").toBeLessThanOrEqual(60);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("another page still opens at the top", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/#/reports?q=tulot");
  await expect(page.locator("#tulot-ja-menot")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 400));
  expect(await scrollY(page)).toBeGreaterThan(200);
  await page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name: "Laskut" }).click();
  await expect(page).toHaveURL(/#\/bills/);
  await expect.poll(() => scrollY(page)).toBe(0);
  await context.close();
});
