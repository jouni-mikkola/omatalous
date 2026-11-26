import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { cents } from "./helpers.ts";

// The three cards at the head of Laskut tell the kinds apart: Nyt is what is paid of the running month, Arvio what is still to come
// of it, Tavallinen the bills a month the series run at. Each figure is the server's, shown in whole euros. Runs on the demo household
// that e2e/run.mjs makes.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const euros = (c: number) => Math.round(c / 100) * 100;

test("the figure under the Arvio chip is what the server says is still to come, and Nyt with it is the month's bills", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const answer = await context.request.get("/api/reports?scope=own&reports=billCalendar,fixedCosts");
  expect(answer.ok()).toBe(true);
  const { billCalendar, fixedCosts } = (await answer.json()) as {
    billCalendar: { months: { paidCents: number; billsCents: number }[] };
    fixedCosts: { monthlyCents: number };
  };
  const open = billCalendar.months[0]!;
  const page = await context.newPage();
  await page.goto("/#/bills");
  const cards = page.locator(".kind-cards .kind-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.locator(".kind-chip")).toHaveText(["Nyt", "Arvio", "Tavallinen"]);
  await expect(cards.nth(0)).toHaveAttribute("data-kind", "now");
  await expect(cards.nth(1)).toHaveAttribute("data-kind", "estimate");
  await expect(cards.nth(2)).toHaveAttribute("data-kind", "usual");
  // Nyt and Arvio carry the day they are for
  await expect(cards.nth(0).locator(".kind-date")).toBeVisible();
  await expect(cards.nth(1).locator(".kind-date")).toBeVisible();

  const figure = async (kind: string) => cents(await page.locator(`.kind-${kind} .kind-figure`).innerText());
  const now = await figure("now");
  const estimate = await figure("estimate");
  expect(now, "Nyt: paid this month").toBe(euros(open.paidCents));
  expect(estimate, "Arvio: still to come this month").toBe(euros(open.billsCents));
  expect(await figure("usual"), "Tavallinen: the bills a month").toBe(euros(fixedCosts.monthlyCents));
  // each is rounded to a euro, so the two add up to the month's bills within a euro
  expect(Math.abs(now + estimate - (open.paidCents + open.billsCents)), "Nyt and Arvio against the month").toBeLessThanOrEqual(100);
  await context.close();
});
