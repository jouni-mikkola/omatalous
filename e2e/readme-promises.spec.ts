import { expect, test } from "@playwright/test";
import { makeMember, removeMember } from "./helpers.ts";

// README's *What it does* promises Raportit pages (income against spending, fixed against variable costs, the same months a year
// earlier, CSV of long tables), an English interface and statement files. Each holds on the demo household, here with two years
// of rows so the year comparison has both sides.
test("what the README says about Lisää, English and statement files holds on the demo", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "lupaukset");
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  try {
    const demo = await context.request.post("/api/demo?months=26", { headers: { "X-Requested-With": "fetch" } });
    expect(demo.status()).toBe(200);
    const page = await context.newPage();

    // Lisää lists four reports on the demo; the fifth, Yhteiset, waits for an account two members share
    await page.goto("/#/reports?q=menot");
    const more = page.getByRole("navigation", { name: "Lisää" });
    await expect(more.getByRole("link")).toHaveText(["Vuosi", "Tilit ja saldot", "Lainat", "Verovuosi"]);
    await expect(page.getByRole("heading", { name: "Vuosivertailu" })).toBeVisible();
    await page.goto("/#/reports?q=tulot");
    await expect(page.getByRole("heading", { name: "Tulot ja menot" })).toBeVisible();
    await page.goto("/#/reports?q=kiinteat");
    await expect(page.getByRole("heading", { name: "Kiinteät ja muuttuvat" })).toBeVisible();
    // a table of more than ten rows downloads as CSV
    await page.goto("/#/reports?q=saldot");
    await expect(page.getByRole("button", { name: /csv/i }).first()).toBeVisible();

    // the statement files: one place on Pankit ja tilit takes CSV, camt.053 and PDF, read in the browser
    await page.goto("/#/settings");
    await expect(page.locator('input[data-kind="statement-file"]')).toHaveAttribute("accept", /\.csv.*\.xml.*\.pdf/);

    // the English interface
    await page.locator(".user-menu summary").click();
    await page.locator(".user-menu .menu").getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.goto("/#/reports?q=tulot");
    await expect(page.getByRole("heading", { name: "Income and spending" })).toBeVisible();
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});
