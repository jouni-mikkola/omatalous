import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// The print flow of a sheet: Tulosta marks the sheet and the page, the print look shows the sheet alone, and the marks
// leave when the browser says the printing is over.
declare global {
  interface Window {
    /** how many times the stub of `window.print` was called */
    printed: number;
  }
}

const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("the tax sheet prints alone and the page comes back after", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  // the browser's print dialog would hold the page: the stub counts the calls and leaves the page as the dialog would find it
  await page.addInitScript(() => {
    window.printed = 0;
    window.print = () => {
      window.printed += 1;
    };
  });
  await page.goto("/#/reports?q=tulot#verovuosi");
  const root = page.locator("html");
  const sheet = page.locator("#verovuosi");
  const table = sheet.locator("table").first();
  const header = page.locator("header.topbar");
  const menu = page.locator("header.topbar nav.nav");
  const rail = page.locator("nav.q-rail");
  const footer = page.getByRole("contentinfo");
  await expect(table).toBeVisible();
  // Tulot holds the tax sheet alone, so the card a page with more reports would have next to it is put there by hand
  await sheet.evaluate((card) => {
    const next = document.createElement("section");
    next.className = "card";
    next.id = "toinen-kortti";
    const title = document.createElement("h2");
    title.textContent = "Toinen kortti";
    const line = document.createElement("p");
    line.textContent = "Tämä ei kuulu paperille.";
    next.append(title, line);
    card.after(next);
  });
  const other = page.locator(".card:not(#verovuosi)").first();
  await expect(rail).toBeVisible();
  await expect(footer).toBeVisible();
  await expect(header).toBeVisible();
  await expect(menu).toBeVisible();
  await expect(other).toBeVisible();

  await sheet.getByRole("button", { name: "Tulosta" }).click();
  await expect(root).toHaveClass(/(^|\s)printing-sheet(\s|$)/);
  expect(await page.evaluate(() => window.printed)).toBe(1);

  await page.emulateMedia({ media: "print" });
  await expect(table).toBeVisible();
  await expect(sheet.getByRole("heading", { level: 2 })).toBeVisible();
  await expect(header).toBeHidden();
  await expect(menu).toBeHidden();
  await expect(other).toBeHidden();
  await expect(other.getByRole("heading")).toBeHidden();
  await expect(rail).toBeHidden();
  await expect(footer).toBeHidden();
  // the buttons of the sheet are not part of the paper
  await expect(sheet.getByRole("button", { name: "Tulosta" })).toBeHidden();

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(root).not.toHaveClass(/(^|\s)printing-sheet(\s|$)/);
  await expect(sheet).not.toHaveClass(/(^|\s)print-sheet(\s|$)/);
  await page.emulateMedia({ media: null });
  await expect(header).toBeVisible();
  await expect(menu).toBeVisible();
  await expect(other).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});
