import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// One line separates the header or the tabs from the first card (Asetukset drew two, 26 px apart).
// With E2E_SHOTS set each page is saved as a picture.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const SHOTS = process.env.E2E_SHOTS ?? "";
const PAGES = ["settings/banks", "overview", "transactions", "bills", "review", "reports?q=menot", "balances", "settings/security", "settings/server"];

for (const width of [390, 1440]) {
  test(`${width} px: one rule above the first card`, async ({ browser }) => {
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const seen = watch(page);
    for (const id of PAGES) {
      await page.goto(`/#/${id}`);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      // Varat ja velat can still be drawing its first card when the network is idle
      await expect(page.locator("main .card").first()).toBeVisible();
      if (SHOTS && id === "settings/banks") {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: join(SHOTS, `rules-top-${width}.png`) });
      }
      // the lines at the top: the bottom border of the tabs (or of the header) and the top border of the first card
      // under it, which are one line when the card has its rule only where nothing else has drawn one
      const lines = await page.evaluate(() => {
        const first = document.querySelector("main .card");
        if (!first) return [];
        const above = [...document.querySelectorAll(".tabs")].filter((t) => t.getBoundingClientRect().bottom <= first.getBoundingClientRect().top + 2);
        const rule = (el: Element, side: "Top" | "Bottom") => parseFloat(getComputedStyle(el)[`border${side}Width` as "borderTopWidth"]) > 0 && getComputedStyle(el)[`border${side}Style` as "borderTopStyle"] !== "none";
        const ys: number[] = [];
        for (const t of above) {
          const r = t.getBoundingClientRect();
          if (first.getBoundingClientRect().top - r.bottom < 80 && rule(t, "Bottom")) ys.push(Math.round(r.bottom));
        }
        if (rule(first, "Top")) ys.push(Math.round(first.getBoundingClientRect().top));
        return ys;
      });
      expect(lines.length, `${id}: lines above the first card at ${lines.join(", ")}`).toBe(1);
    }
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
