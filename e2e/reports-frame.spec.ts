import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// The frame of Raportit: one report open at a time beside the list of them all, and the month's own page.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("a report in the list opens its page and keeps the period; a phone folds the list behind a button that names the open report", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?period=6m");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("link")).toHaveCount(0);
  // the button says which report is open
  await expect(list.getByRole("button")).not.toHaveText("Raportit");
  await list.getByRole("button").click();
  await list.getByRole("link", { name: "Tilit ja saldot" }).click();
  await expect(page.getByRole("heading", { name: "Tilit ja saldot", level: 2 })).toBeVisible();
  expect(new URL(page.url()).hash).toMatch(/q=saldot/);
  expect(new URL(page.url()).hash).toContain("period=6m");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll at 390 px").toBe(true);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a household with no shared account has no Yhteiset menot question and no such page", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=kuukausi");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("link").first()).toBeVisible();
  await expect(list.getByRole("link", { name: /yhteiset/i })).toHaveCount(0);
  await page.goto("/#/reports?q=yhteiset");
  await expect(page.getByRole("heading", { name: "Yhteiset menot", level: 2, exact: true })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  test(`this month shows the gap, the estimate and the rows that explain it at ${width} px`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height } });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/reports?q=kuukausi");
    const card = page.locator("#kuukausi");
    // the estimate is of the days left: on the month's last day there are none, and the card says no estimate (core this-month.ts)
    const today = ((await (await page.request.get("/api/meta")).json()) as { today: string }).today;
    const [y, m, d] = today.split("-").map(Number) as [number, number, number];
    const lastDay = d === new Date(Date.UTC(y, m, 0)).getUTCDate();
    await expect(card.getByText("Kuun lopun arvio")).toHaveCount(lastDay ? 0 : 1);
    if (!lastDay) await expect(card.getByText("Kuun lopun arvio")).toBeVisible();
    await expect(card.getByRole("table", { name: "Päivät, jotka selittävät eron" })).toBeVisible();
    await expect(card.getByRole("table", { name: "Kategoriat, jotka selittävät eron" })).toBeVisible();
    // every table of the page shows its heading, not only a screen reader's name
    for (const name of ["Päivät, jotka selittävät eron", "Kategoriat, jotka selittävät eron", "Laskut, joita kuun loppuun on vielä tulossa"]) {
      const caption = card.locator("caption.month-cap", { hasText: name });
      if (await caption.count()) await expect(caption).toBeVisible();
      else expect(name, "only the bills table may be missing").toContain("Laskut");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no sideways scroll at ${width} px`).toBe(true);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
