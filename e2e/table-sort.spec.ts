import { expect, test } from "@playwright/test";
import { join } from "node:path";

// Raportit > Menot, Kategoriat: a head sorts by the keyboard, `aria-sort` follows the press and a polite sentence says the order.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Enter on the Yhteensä head sorts the categories, aria-sort changes and the new order is said", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: STATE,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/#/reports?period=12m&tab=menot");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const head = page.getByRole("columnheader", { name: /^Yhteensä/ }).first();
  await expect(head).toHaveAttribute("aria-sort", "none");
  const button = head.getByRole("button");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByRole("status").filter({ hasText: "Järjestetty: Yhteensä, suurin ensin" })).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-sort", "ascending");
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-sort", "none");
  await expect(page.getByRole("status").filter({ hasText: "Alkuperäinen järjestys" })).toHaveCount(1);
  await context.close();
});
