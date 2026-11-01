import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// The demo's two Apple subscriptions (12,99 € and 0,99 €) are told apart by the same words on every page that lists
// series: Laskut and Raportit > Kiinteät. With E2E_SHOTS set each page is saved as a picture at both widths.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const SHOTS = process.env.E2E_SHOTS ?? "";
// money is written with a no-break space; the names are compared with plain ones
const NAMES = ["Apple 12,99 €", "Apple 0,99 €"];

for (const width of [390, 1440]) {
  test(`${width} px: two series of one payee read alike on Laskut and Kiinteät`, async ({ browser }) => {
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const seen = watch(page);

    await page.goto("/#/bills");
    const bills = page.locator("#laskut-taulukko .sub-merchant");
    await expect(bills.first()).toBeVisible();
    const onBills = (await bills.allTextContents()).map((s) => s.replace(/\s+/g, " ").trim());
    if (SHOTS) {
      await page.locator("#laskut-taulukko").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `series-bills-${width}.png`) });
    }

    await page.goto("/#/reports?q=kiinteat");
    const fixed = page.locator("#kiinteat-menot tbody a");
    await expect(fixed.first()).toBeVisible();
    const onFixed = (await fixed.allTextContents()).map((s) => s.replace(/\s+/g, " ").trim());
    if (SHOTS) {
      await page.locator("#kiinteat-menot").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `series-fixed-${width}.png`) });
    }

    for (const name of NAMES) {
      expect(onBills, `Laskut: ${name}`).toContain(name);
      expect(onFixed, `Kiinteät: ${name}`).toContain(name);
    }
    // a bare "Apple" is on neither page
    expect(onBills).not.toContain("Apple");
    expect(onFixed).not.toContain("Apple");
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
