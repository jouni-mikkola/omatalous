import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Asetukset > Tilit: accounts you can tell apart. Needs the administrator and the demo household that e2e/run.mjs
// makes.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Tilit shows the IBAN in groups of four behind Muokkaa, and an own name stays apart from the original and can be taken away", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  const tilit = page.locator("#tilit");
  const row = (name: string) => tilit.getByRole("row").filter({ hasText: name }).first();

  // the number is not on the row; the form shows it
  await expect(row("Käyttötili (esimerkki)")).not.toContainText("FI21 1234 5600 0007 85");
  await page.getByRole("button", { name: "Muokkaa tiliä Säästötili (esimerkki)" }).click();
  await expect(tilit.locator(".account-form")).toContainText("FI14 1009 3000 1234 58");
  await tilit.locator(".account-form").getByRole("button", { name: "Peruuta" }).click();
  // a card has no IBAN: its line is the card's last digits
  await page.getByRole("button", { name: "Muokkaa tiliä Nordea Gold (esimerkki)" }).click();
  await expect(tilit.locator(".account-form")).toContainText("4242");
  await tilit.locator(".account-form").getByRole("button", { name: "Peruuta" }).click();
  // the provider is not named after the number
  await expect(row("Nordea Gold (esimerkki)")).not.toContainText("demo");

  // any account can have a name of its own, bank-linked or not; the original is in the form
  await page.getByRole("button", { name: "Muokkaa tiliä Käyttötili (esimerkki)" }).click();
  await page.getByLabel("Tilin nimi").fill("Yhteinen tili");
  await page.getByRole("button", { name: "Tallenna", exact: true }).click();
  await expect(tilit.getByText("Tallennettu.").first()).toBeVisible();
  await expect(row("Yhteinen tili")).not.toContainText("Pankin nimi");
  await page.getByRole("button", { name: "Muokkaa tiliä Yhteinen tili" }).click();
  await expect(tilit.locator(".account-form")).toContainText("Pankin nimi: Käyttötili (esimerkki)");
  await expect(tilit.locator(".account-form")).toContainText("FI21 1234 5600 0007 85");
  await tilit.locator(".account-form").getByRole("button", { name: "Peruuta" }).click();

  // an empty name brings the original back
  await page.getByRole("button", { name: "Muokkaa tiliä Yhteinen tili" }).click();
  await expect(page.getByLabel("Tilin nimi")).toHaveValue("Yhteinen tili");
  // the type is chosen in the form, not on the row, and the name did not change it
  await expect(tilit.getByLabel("Tilin Yhteinen tili tyyppi")).toHaveValue("checking");
  await expect(row("Yhteinen tili").getByRole("combobox")).toHaveCount(0);
  await page.getByLabel("Tilin nimi").fill("");
  await page.getByRole("button", { name: "Tallenna", exact: true }).click();
  await expect(row("Käyttötili (esimerkki)")).toBeVisible();
  await expect(tilit.getByText("Pankin nimi:")).toHaveCount(0);

  // the page does not scroll sideways on a phone
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(row("Käyttötili (esimerkki)")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  expect(seen.problems).toEqual([]);
  await context.close();
});
