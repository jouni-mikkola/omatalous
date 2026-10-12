import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Asetukset > Tilit: accounts you can tell apart. Needs the administrator and the demo household that app.spec.ts
// creates, so it runs after it (the name sorts after "app", which Playwright runs first by file name).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Tilit shows the IBAN in groups of four, and an own name stays apart from the original and can be taken away", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  const tilit = page.locator("#tilit");
  const row = (name: string) => tilit.getByRole("row").filter({ hasText: name }).first();

  await expect(row("Käyttötili (esimerkki)")).toContainText("FI21 1234 5600 0007 85");
  await expect(row("Säästötili (esimerkki)")).toContainText("FI14 1009 3000 1234 58");
  // no IBAN and no card number: a dash, as before
  await expect(row("Nordea Gold (esimerkki)")).toContainText("– · demo");

  // any account can have a name of its own, bank-linked or not; the original stays on a line of its own
  await page.getByRole("button", { name: "Muokkaa tiliä Käyttötili (esimerkki)" }).click();
  await page.getByLabel("Oma nimi").fill("Yhteinen tili");
  await page.getByRole("button", { name: "Tallenna", exact: true }).click();
  await expect(tilit.getByText("Tallennettu.").first()).toBeVisible();
  await expect(row("Yhteinen tili")).toContainText("Pankin nimi: Käyttötili (esimerkki)");
  await expect(row("Yhteinen tili")).toContainText("FI21 1234 5600 0007 85");
  await expect(tilit.getByLabel("Tilin Yhteinen tili tyyppi").first()).toHaveValue("checking");

  // an empty name brings the original back
  await page.getByRole("button", { name: "Muokkaa tiliä Yhteinen tili" }).click();
  await expect(page.getByLabel("Oma nimi")).toHaveValue("Yhteinen tili");
  await page.getByLabel("Oma nimi").fill("");
  await page.getByRole("button", { name: "Tallenna", exact: true }).click();
  await expect(row("Käyttötili (esimerkki)")).toBeVisible();
  await expect(tilit.getByText("Pankin nimi:")).toHaveCount(0);

  // the lines under a name wrap on a phone instead of scrolling the page sideways
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(row("Käyttötili (esimerkki)")).toContainText("FI21 1234 5600 0007 85");
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  expect(seen.problems).toEqual([]);
  await context.close();
});
