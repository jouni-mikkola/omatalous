import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// Asetukset > Palvelin > Ilmoitukset selaimen ulkopuolelle: off by default, saved sealed, and the address never comes back.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
// a name that cannot resolve: if an hourly tick came while it is on, nothing real is called
const ADDRESS = "https://hooks.example.invalid/in/e2e-secret";

test("the notices card saves a webhook address, shows only its host and turns off again", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings/server");
  const card = page.locator("#ilmoitukset");
  await expect(card.getByRole("heading", { name: "Ilmoitukset selaimen ulkopuolelle" })).toBeVisible();
  // off by default, so the card is folded until the reader opens it
  await expect(card).not.toHaveAttribute("open", "");
  await card.locator("summary").click();
  const box = card.getByRole("checkbox", { name: /Lähetä ilmoitukset/ });
  await expect(box).not.toBeChecked();

  await box.check();
  await card.locator('input[name="notices-address"]').fill(ADDRESS);
  await card.getByRole("button", { name: "Tallenna" }).click();
  await expect(card.getByText("Tallennettu.")).toBeVisible();
  await expect(card.getByText("osoite palvelimella hooks.example.invalid")).toBeVisible();

  const answer = JSON.stringify(await (await page.request.get("/api/admin/notices")).json());
  expect(answer).toContain('"enabled":true');
  expect(answer).not.toContain("e2e-secret");

  // off again, so no later spec's hourly tick has anywhere to send
  await box.uncheck();
  await card.getByRole("button", { name: "Tallenna" }).click();
  await expect(card.getByText("Tallennettu.")).toBeVisible();
  expect((await (await page.request.put("/api/admin/notices", { headers: FETCH, data: { enabled: false } })).json()).enabled).toBe(false);
  expect(seen.problems).toEqual([]);
  await context.close();
});
