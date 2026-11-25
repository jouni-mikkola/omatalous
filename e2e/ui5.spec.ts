import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// 0.69 UI5: the header holds one row only where everything fits, on every page.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const width of [1000, 1099]) {
  for (const route of ["overview", "review"]) {
    // Tarkistettavat does not read the scope, so its header has no switch; the shared account is there all the same
    test(`#/${route} at ${width} px ${route === "review" ? "without" : "with"} the view switch: the header wraps and nothing scrolls sideways`, async ({ browser }) => {
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
      await expect(page.locator(".user-menu summary")).toBeVisible({ timeout: 15_000 });
      if (route === "review") await expect(page.locator(".scope-toggle")).toHaveCount(0);
      else await expect(page.locator(".scope-toggle")).toBeVisible();
      const summary = (await page.locator(".user-menu summary").boundingBox())!;
      expect(summary.x + summary.width, "the user menu is inside the band").toBeLessThanOrEqual(width);
      expect(await overflow(page), "the page scrolls sideways").toBeLessThanOrEqual(1);
      expect(seen.problems).toEqual([]);
      await context.close();
    });
  }
}

// Between a phone and 1100 px the pages take a row under the first; the first holds the mark, the switch, Tarkistettavat and the user, and a long name is cut, not moved to a row of its own.
for (const width of [641, 700, 768]) {
  test(`${width} px: with the view switch and a 40-character name the mark and the user menu share one row`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 800 } });
    await context.route(/\/api\/meta(\?|$)/, async (r) => {
      const response = await r.fetch();
      const json = await response.json();
      if (!json.sharedAccounts.length && json.accounts.length) json.sharedAccounts = [{ ...json.accounts[0], id: "shared-ui5", ownerName: "Eero" }];
      await r.fulfill({ response, json });
    });
    await context.route(/\/api\/auth\/state$/, async (r) => {
      const response = await r.fetch();
      const json = await response.json();
      if (json.user) json.user.displayName = "Liisa Meikäläinen-Virtanen von Pitkänimi";
      await r.fulfill({ response, json });
    });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/overview");
    await expect(page.locator(".scope-toggle")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".user-menu summary .user-name")).toContainText("Pitkänimi");
    const [brand, toggle, menu] = await Promise.all([".topbar .brand", ".scope-toggle", ".user-menu"].map((s) => page.locator(s).boundingBox()));
    const centres = [brand!, toggle!, menu!].map((b) => b.y + b.height / 2);
    expect(Math.max(...centres) - Math.min(...centres), "the mark, the switch and the user menu are on one row").toBeLessThan(8);
    expect(menu!.x + menu!.width, "the user menu is inside the screen").toBeLessThanOrEqual(width);
    expect(await overflow(page), "the page scrolls sideways").toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

// A payee whose category the rows only suggest, answered on a phone: the badge stays inside its button.
const ROW = { id: "r0", date: "2026-09-20", cents: -8450, name: "Esimerkki Kauppa Oy", text: "KORTTIOSTO ESIMERKKI KAUPPA" };
const PAYEE = {
  kind: "payee_out", id: "payee_out:Esimerkki Kauppa Oy", cents: 8450, merchant: "Esimerkki Kauppa Oy", count: 1, lastDate: "2026-09-20",
  picks: ["pets", "groceries", "restaurants", "car"], rows: [ROW], rowCount: 1, guess: { category: "pets", reason: "Sama kategoria kuin Esimerkki Kauppa Oy" },
};

test(`390 px: Ehdotus fits inside the guessed choice`, async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  await context.route(/\/api\/review(\?|$)/, (r) => r.fulfill({ json: { items: [PAYEE] } }));
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
