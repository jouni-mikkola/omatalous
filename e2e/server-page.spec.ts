import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { overflow, watch } from "./helpers.ts";

// Asetukset > Palvelin ja ylläpito: the version shows once, the fields of the form have one width and each fold has a
// summary line.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const SHOTS = process.env.E2E_SHOTS;

for (const width of [1440, 390]) {
  test(`at ${width} px the server page shows the version once, one field width and a summary line on each fold`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 844 } });
    try {
      const page = await context.newPage();
      const seen = watch(page);
      await page.goto("/#/settings/server");
      const form = page.locator("#palvelin form.setup-form");
      await expect(form).toBeVisible();
      await expect(page.getByRole("heading", { name: "Versio", exact: true })).toBeVisible();
      // the cards fade in; a shot waits for the last one
      if (SHOTS) {
        await expect(page.getByRole("heading", { name: "Tyhjennä kaikki tiedot" })).toBeVisible();
        await page.waitForTimeout(1000);
      }
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${process.env.E2E_SHOT_NAME ?? "after"}-server-${width}.png`), fullPage: true });

      // the status line has no version: the Versio card is the one place
      await expect(page.locator(".server-status dt", { hasText: "Versio" })).toHaveCount(0);
      const version = await page.locator(".card", { has: page.getByRole("heading", { name: "Versio", exact: true }) }).locator(".card-sub span").first().innerText();
      expect(version).not.toBe("");
      await expect(page.locator(".card").getByText(version, { exact: true })).toHaveCount(1);

      // the fields of a form are one width
      const widths = await form.locator("input:not([type=checkbox]):not([type=radio]), select").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
      expect(widths.length).toBeGreaterThanOrEqual(2);
      expect(new Set(widths).size, `field widths ${widths.join(", ")}`).toBe(1);

      // each fold says its state under its name
      const folds = page.locator("details.card");
      const count = await folds.count();
      expect(count).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < count; i++) {
        const sub = folds.nth(i).locator("> summary .card-sub");
        await expect(sub, `fold ${i}`).toHaveCount(1);
        await expect(sub).not.toHaveText("");
      }
      expect(await overflow(page), `Palvelin scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(seen.problems).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
