import { expect, type Locator, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Asetukset > Tilit: how much of a card's credit limit is in use. Needs the administrator and the demo household that
// app.spec.ts creates, so the name sorts after "app" (Playwright runs the files in name order). The demo card has no
// limit, so the limit and the balance a bank would give are put into the answer of /api/meta.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

/** How much of the bar its fill covers, 0 to 1. */
const filled = (bar: Locator) => bar.evaluate((el) => el.firstElementChild!.getBoundingClientRect().width / el.getBoundingClientRect().width);

test("Tilit shows how much of a card's limit is in use, as a line and a thin bar", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  let bank: { creditLimitCents: number | null; balanceCents: number | null } = { creditLimitCents: 300000, balanceCents: -124000 };
  await page.route("**/api/meta", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.accounts = json.accounts.map((a: { type: string }) => (a.type === "credit_card" ? { ...a, ...bank } : a));
    await route.fulfill({ response, json });
  });
  const row = page.locator("#tilit").getByRole("row").filter({ hasText: "Nordea Gold (demo)" }).first();
  const bar = row.locator(".credit-bar");

  // 1 240 € of 3 000 €: the line says both and the bar is 41 % full
  await page.goto("/#/settings");
  await expect(row).toContainText(/Luottoraja 3\s000\s€, käytössä 1\s240\s€/);
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveClass(/over/);
  expect(await filled(bar)).toBeCloseTo(0.41, 2);
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(4);
  // an account without a limit has no bar
  await expect(page.locator("#tilit .credit-bar")).toHaveCount(1);

  // over the limit: the line says it in words, and a full bar in the warning colour
  bank = { creditLimitCents: 300000, balanceCents: -320000 };
  await page.reload();
  await expect(row).toContainText(/Luottoraja 3\s000\s€, käytössä 3\s200\s€, yli luottorajan 200\s€/);
  await expect(bar).toHaveClass(/over/);
  expect(await filled(bar)).toBeCloseTo(1, 2);

  // nothing owed: the limit alone
  bank = { creditLimitCents: 300000, balanceCents: 0 };
  await page.reload();
  await expect(row).toContainText(/Luottoraja 3\s000\s€/);
  await expect(row).not.toContainText("käytössä");
  await expect(bar).toHaveCount(0);

  // the bank gave no limit: no line and no bar, whatever is owed
  bank = { creditLimitCents: null, balanceCents: -124000 };
  await page.reload();
  await expect(row).toContainText("– · demo");
  await expect(row).not.toContainText("Luottoraja");
  await expect(bar).toHaveCount(0);

  // on a phone the line and the bar fit without a sideways scroll
  bank = { creditLimitCents: 300000, balanceCents: -124000 };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(row).toContainText(/käytössä 1\s240\s€/);
  await expect(bar).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  // a read of /api/meta still on its way would be cut off by closing the context
  await page.unrouteAll({ behavior: "wait" });
  expect(seen.problems).toEqual([]);
  await context.close();
});
