import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// The card on Yhteenveto that answers "is there enough on the account until the pay comes", on the demo household of the
// administrator that e2e/run.mjs made. The demo's dates follow the day the spec runs, so the spec asserts the shape and
// the names the app itself reads from the demo's rows, never a date or a sum. The two states the demo does not have, no regular payer and a late pay, are
// proved by apps/web/test/next-days.test.ts (the sentences) and packages/core/test/ahead-payday.test.ts (the window).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

/** The names the window's rows carry, in the order the list shows them: payments first, other pay after. The API the page reads. */
async function listedNames(context: BrowserContext): Promise<string[]> {
  const rows: { name: string; cents: number }[] = (await (await context.request.get("/api/dashboard")).json()).ahead.rows;
  return [...rows.filter((r) => r.cents < 0), ...rows.filter((r) => r.cents > 0)].map((r) => r.name);
}

/** The merchants of the demo household's series, as the app reads them from the demo's rows: the only names a row can carry. */
async function demoNames(context: BrowserContext): Promise<Set<string>> {
  const series: { merchant: string }[] = (await (await context.request.get("/api/recurring")).json()).series;
  return new Set(series.map((s) => s.merchant));
}

/** "1 245 €" or "−120 €" in euros. */
const euros = (text: string): number => Number(text.replace(/[\s  €]/g, "").replace("−", "-").replace(",", "."));

async function open(browser: Browser, width: number) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const card = page.locator(".card", { has: page.getByRole("heading", { name: /^Palkkapäivä / }) });
  await expect(card).toBeVisible();
  return { context, page, seen, card };
}

test("the heading names the payday, the figures follow and the list holds the demo's payments", async ({ browser }) => {
  const { context, page, seen, card } = await open(browser, 1280);
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(/^Palkkapäivä (su|ma|ti|ke|to|pe|la) \d{1,2}\.\d{1,2}\.$/);
  await expect(card.locator(".card-sub")).toHaveText(/^(tänään|huomenna|\d+ päivän päästä)$/);

  // the three figures, the payments first, and the sum of the last day with the demo's checking balance
  const bills = card.locator(".ahead-figure", { hasText: "Maksut ennen palkkapäivää" });
  await expect(bills).toBeVisible();
  await expect(card.locator(".ahead-figure", { hasText: "Saldo ennen palkkapäivää" })).toBeVisible();
  const left = await card.locator(".ahead-figure", { hasText: "Saldo ennen palkkapäivää" }).locator("dd").innerText();
  expect(left).toMatch(/€$/);

  // the list is the window's rows and nothing else, each under a name the demo's rows give, and its sum is the figure of
  // the payments. A payday today or tomorrow leaves a window of one day with nothing due in it: no list, a figure of 0.
  const names = await listedNames(context);
  const known = await demoNames(context);
  for (const name of names) expect(known.has(name), `${name} is a name the demo's rows give`).toBe(true);
  const table = card.getByRole("table", { name: "Maksut ennen palkkapäivää" });
  await expect(table.locator("tbody tr td:first-child")).toHaveText(names);
  const amounts = await table.locator("tbody tr td:last-child").allInnerTexts();
  const total = euros(await bills.locator("dd").innerText());
  expect(Math.abs(amounts.map(euros).reduce((sum, x) => sum + x, 0) - total), "the list adds up to the figure").toBeLessThan(1);

  // the pay itself is the last line, apart from the list, with a sign
  const pay = card.locator(".ahead-pay");
  await expect(pay).toContainText(/acme/i);
  await expect(pay).toContainText("+");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("on a phone nothing scrolls sideways and the figures come before the list", async ({ browser }) => {
  const { context, page, seen, card } = await open(browser, 390);
  expect(await overflow(page), "the page scrolls sideways at 390 px").toBeLessThanOrEqual(1);
  const [head, figure] = [await card.getByRole("heading", { level: 2 }).boundingBox(), await card.locator(".ahead-figure").first().boundingBox()];
  expect(head!.y).toBeLessThan(figure!.y);
  // the list is there exactly when the window has rows
  const table = card.getByRole("table", { name: "Maksut ennen palkkapäivää" });
  const listed = (await listedNames(context)).length;
  await expect(table).toHaveCount(listed > 0 ? 1 : 0);
  if (listed > 0) expect(figure!.y, "the first figure is above the list").toBeLessThan((await table.boundingBox())!.y);
  const wide = await page.evaluate(() => Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > window.innerWidth + 1).length);
  expect(wide, "a table wider than the screen").toBe(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});
