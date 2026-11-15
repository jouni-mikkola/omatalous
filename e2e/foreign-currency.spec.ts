import { expect, test } from "@playwright/test";
import { linkFakeBank, makeMember, overflow, removeMember, waitForSync, watch } from "./helpers.ts";

// Rows in another currency: the fake bank lists a fifth account with one dollar purchase to a link that asks for it. Asetukset > Tilit lists it under
// the account in the bank's own figure, and the first page counts in euros only. A member links the fake bank, as the
// other specs of a fetch do.
test("Tilit lists the dollar row under its account, outside the euro figures, on both widths", async ({ browser }) => {
  const member = await makeMember(browser, "dollarrows");
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 800 } });
  try {
    const page = await context.newPage();
    const seen = watch(page);
    await linkFakeBank(page, { dollars: true });
    await waitForSync(context);
    await page.goto("/#/settings");
    const tilit = page.locator("#tilit");
    const row = tilit.getByRole("row").filter({ hasText: "ei mukana euromäärissä" });

    // only that account has such rows
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("USD");
    await expect(row).toContainText("1 tapahtuma");
    await expect(row).toContainText("−20,00 USD");
    await expect(row).toContainText("ESIMERKKI INC");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(row).toContainText("−20,00 USD");
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // the first page counts in euros only
    await page.goto("/#/");
    await expect(page.locator("main")).not.toContainText("USD");
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await removeMember(browser, member.id);
  }
});
