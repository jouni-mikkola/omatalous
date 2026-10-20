import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// VT5: the basis of a figure opens from the figure. Every door (Why) on Yhteenveto and Laskut opens its panel by Enter, by
// Space and by a tap; Escape and Sulje close it and give the focus back to the figure; on a phone the panel is a sheet at the
// foot of the screen. No page shows link text to a basis. The page builders add their figures as they land; the walk finds
// them by the door's class. Reads the administrator's demo household and changes nothing.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const PAGES = [
  { route: "/#/overview?period=last-month", name: "Yhteenveto", doors: true },
  { route: "/#/bills", name: "Laskut", doors: true },
];

/** The words of a link to a basis, as apps/web/test/why.test.ts refuses them. */
const LINK_TEXT = /mistä (luku|summa|tämä|arvio) tulee|^miksi\?$|mihin (luku|summa|arvio) perustuu|näin (luku|summa) (syntyy|lasketaan)/i;

async function open(browser: Browser, route: string, phone: boolean): Promise<{ page: Page; close: () => Promise<void>; seen: { problems: string[] } }> {
  const context = await browser.newContext({ storageState: STATE, viewport: phone ? { width: 390, height: 800 } : { width: 1280, height: 900 }, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(route);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return { page, seen, close: () => context.close() };
}

/** What a door on these pages opens: the rows of a sum, or the calculation of a loan figure (once the household has a loan). */
const OPENS = /^Näytä (tapahtumat|laskelma): /;

/** The panel a door opened, loaded: its title is the door's figure and its days stand under it. */
async function opened(page: Page, door: Locator): Promise<Locator> {
  const name = (await door.getAttribute("aria-label"))!;
  expect(name).toMatch(OPENS);
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(panel.locator(".why-period")).toHaveText(/^\d{1,2}\.\d{1,2}\./);
  // the panel stands under body, so nothing of the figure's cell reaches it: no underline, no right alignment, no capitals
  expect(await panel.evaluate((d) => d.parentElement === document.body)).toBe(true);
  expect(await panel.evaluate((d) => [getComputedStyle(d).textAlign, getComputedStyle(d.querySelector("h2")!).textTransform])).toEqual(["left", "none"]);
  const amount = panel.locator("tr[data-why-row] td.num").first();
  if (await amount.count()) expect(await amount.evaluate((td) => getComputedStyle(td).textDecorationLine)).toBe("none");
  expect(name.replace(OPENS, "")).toContain((await panel.locator("h2").textContent())!.trim());
  return panel;
}

for (const p of PAGES) {
  test(`${p.name}: no link text to a basis, and each figure opens its basis by Enter and Space and closes by Escape`, async ({ browser }) => {
    const { page, seen, close } = await open(browser, p.route, false);
    await expect(page.locator("main").getByText(LINK_TEXT)).toHaveCount(0);
    const doors = page.locator("main button.why-door:visible");
    // the page's parts draw after the first answer: the first door stands before the walk counts them
    if (p.doors) await expect(doors.first()).toBeVisible({ timeout: 15_000 });
    const n = await doors.count();
    for (let i = 0; i < n; i++) {
      const door = doors.nth(i);
      await door.focus();
      await page.keyboard.press(i % 2 ? "Space" : "Enter");
      await opened(page, door);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(door).toBeFocused();
    }
    // a door shows its focus ring when the keyboard reaches it
    if (n) {
      await doors.first().focus();
      expect(await doors.first().evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
      expect(await doors.first().evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
    }
    expect(seen.problems).toEqual([]);
    await close();
  });

  test(`${p.name} at 390 px: a tap on each figure opens its basis as a sheet at the foot, Sulje closes it`, async ({ browser }) => {
    const { page, seen, close } = await open(browser, p.route, true);
    const doors = page.locator("main button.why-door:visible");
    // the page's parts draw after the first answer: the first door stands before the walk counts them
    if (p.doors) await expect(doors.first()).toBeVisible({ timeout: 15_000 });
    const n = await doors.count();
    for (let i = 0; i < n; i++) {
      const door = doors.nth(i);
      await door.scrollIntoViewIfNeeded();
      await door.tap();
      const panel = await opened(page, door);
      const box = (await panel.boundingBox())!;
      expect(Math.round(box.width)).toBe(390);
      expect(Math.round(box.y + box.height)).toBe(800);
      await panel.getByRole("button", { name: "Sulje" }).tap();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(door).toBeFocused();
    }
    expect(seen.problems).toEqual([]);
    await close();
  });
}

test("Raportit > Menot: the total's basis shows its first row below the head, not under it, and a category column only when the rows differ", async ({ browser }) => {
  const { page, seen, close } = await open(browser, "/#/reports?period=12m&tab=menot", false);
  const total = page.locator("tfoot tr.foot-row", { hasText: "Yhteensä" }).first();
  await total.getByRole("button", { name: /Näytä tapahtumat/ }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const head = (await panel.locator("table.why-rows thead").first().boundingBox())!;
  const first = (await panel.locator("tr[data-why-row]").first().boundingBox())!;
  expect(first.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
  // the month's spending runs over many categories, so here they stand in a column
  await expect(panel.locator("table.why-rows").first().locator("thead th")).toHaveText(["Päivä", "Saaja", "Kategoria", "Summa"]);
  await page.keyboard.press("Escape");
  expect(seen.problems).toEqual([]);
  await close();
});

test("Yhteenveto: Käytettävissä, Tileillä and the coming pay open their basis; the pay is an estimate and says so", async ({ browser }) => {
  const { page, seen, close } = await open(browser, "/#/overview", false);
  for (const name of [/^Näytä tapahtumat: Käytettävissä /, /^Näytä tapahtumat: Tileillä /]) {
    await page.getByRole("button", { name }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await expect(panel.getByRole("status").filter({ hasText: "Täsmää" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  const pay = page.getByRole("button", { name: /^Näytä tapahtumat: Palkka, .+ arvio / });
  await expect(pay).toContainText("≈");
  await pay.click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  expect(await panel.locator("tr[data-why-row], table.why-rows tbody tr").count()).toBeGreaterThan(2);
  await expect(panel.locator(".why-reason").last()).toContainText("viimeisimmän palkan");
  await page.keyboard.press("Escape");
  expect(seen.problems).toEqual([]);
  await close();
});

test("Raportit > Menot at 390 px: the total's basis fits the screen, each row's category under its name", async ({ browser }) => {
  const { page, seen, close } = await open(browser, "/#/reports?period=12m&tab=menot", true);
  const total = page.locator("tfoot tr.foot-row", { hasText: "Yhteensä" }).first();
  await total.getByRole("button", { name: /Näytä tapahtumat/ }).tap();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const right = await panel.evaluate((d) => Math.max(...Array.from(d.querySelectorAll("table"), (t) => t.getBoundingClientRect().right)));
  expect(right).toBeLessThanOrEqual(390);
  await expect(panel.locator("tr[data-why-row] .why-cat-sub").first()).toBeVisible();
  await expect(panel.locator("thead th.why-cat").first()).toBeHidden();
  expect(seen.problems).toEqual([]);
  await close();
});
