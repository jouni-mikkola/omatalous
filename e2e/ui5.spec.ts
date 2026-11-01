import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// 0.69 UI5: the header holds one row only where everything fits, on every page.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const width of [1000, 1099]) {
  for (const route of ["overview", "review"]) {
    test(`#/${route} at ${width} px with the view switch: the header wraps and nothing scrolls sideways`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 800 } });
      // a shared account brings the switch Oma / Koko talous, the widest state of the header row
      await context.route(/\/api\/meta(\?|$)/, async (r) => {
        const response = await r.fetch();
        const json = await response.json();
        if (!json.sharedAccounts.length && json.accounts.length) json.sharedAccounts = [{ ...json.accounts[0], id: "shared-ui5", ownerName: "Eero" }];
        await r.fulfill({ response, json });
      });
      const page = await context.newPage();
      const seen = watch(page);
      await page.goto(`/#/${route}`);
      await expect(page.locator(".scope-toggle")).toBeVisible({ timeout: 15_000 });
      const avatar = (await page.locator(".user-menu .avatar").boundingBox())!;
      expect(avatar.x + avatar.width, "the avatar is inside the band").toBeLessThanOrEqual(width);
      expect(await overflow(page), "the page scrolls sideways").toBeLessThanOrEqual(1);
      expect(seen.problems).toEqual([]);
      await context.close();
    });
  }
}

// A loan question whose guess is the long "Asuntolaina", answered on a phone: the badge stays inside its button.
const LOAN = { kind: "loan", id: "loan:ui5", cents: 120_000, key: "ui5", payee: "Pankki Oyj", paymentCents: 10_000, months: 12, firstDate: "2025-01-02", lastDate: "2025-12-02", guess: "mortgage", placed: true, rows: [], rowCount: 12 };

test(`390 px: Ehdotus fits inside the guessed choice`, async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  await context.route(/\/api\/review(\?|$)/, (r) => r.fulfill({ json: { items: [LOAN] } }));
  const page = await context.newPage();
  await page.goto("/#/review");
  const badge = page.locator(".review-guess").first();
  await expect(badge).toBeVisible({ timeout: 15_000 });
  const button = badge.locator("xpath=ancestor::button[1]");
  const [b, c] = [(await badge.boundingBox())!, (await button.boundingBox())!];
  expect(b.x).toBeGreaterThanOrEqual(c.x);
  expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width);
  expect(await badge.evaluate((e) => e.scrollWidth <= e.clientWidth), "the word is not cut").toBe(true);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await context.close();
});
