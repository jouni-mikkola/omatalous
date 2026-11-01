import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// The household's one monthly spending goal: set in Asetukset > Talous, shown on Yhteenveto on the chart and as a column of
// its table, changed there and removed. The spec removes the goal at the end, so the specs after it find the household as
// they expect.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("the goal is set in Asetukset, drawn on the chart, listed in the table, changed and removed", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const pace = page.getByRole("region", { name: "Kuukausi", exact: true });
  await expect(pace).toBeVisible({ timeout: 15_000 });
  await expect(pace.locator(".pace-goal-line")).toHaveCount(0);
  // with no goal the page has no button for one: the card in Asetukset is the place
  await expect(pace.getByRole("button", { name: /tavoit/i })).toHaveCount(0);

  await page.goto("/#/settings/household");
  const card = page.locator("#menotavoite");
  const form = page.getByRole("form", { name: "Kuukauden menotavoite" });
  await expect(form).toBeVisible({ timeout: 15_000 });
  // a text that is no amount and an amount under a euro are asked again, with nothing saved
  await form.getByRole("textbox").fill("abc");
  await form.getByRole("button", { name: "Tallenna" }).click();
  await expect(card.getByRole("status")).toContainText("Anna tavoite euroina");
  await form.getByRole("textbox").fill("50 000");
  await form.getByRole("button", { name: "Tallenna" }).click();
  await expect(card.getByRole("status")).toContainText("Tallensit tavoitteen 50 000 € kuussa");

  await page.goto("/#/overview");
  await expect(pace.locator(".pace-goal-line")).toHaveCount(1);
  await expect(pace.locator(".pace-goal-label")).toContainText("Tavoite 50 000 €");
  await expect(pace.locator(".pace-goal-answer")).toContainText("Tavoitteesta 50 000 €");
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  // the table under the chart has the goal left, a day at a time
  await expect(pace.getByRole("columnheader", { name: "Tavoitteesta jäljellä" })).toBeVisible();

  // the goal is the user's: it is still there after a reload, and the link goes to the card, changed in place
  await page.reload();
  await expect(pace.locator(".pace-goal-answer")).toContainText("Tavoitteesta 50 000 €");
  await pace.getByRole("link", { name: "Muuta tavoitetta" }).click();
  await expect(form.getByRole("textbox")).toHaveValue("50 000,00");
  await form.getByRole("textbox").fill("1 800");
  await form.getByRole("button", { name: "Tallenna" }).click();
  await expect(card.getByRole("status")).toContainText("Tallensit tavoitteen 1 800 € kuussa");

  await form.getByRole("button", { name: "Poista tavoite" }).click();
  await page.getByRole("dialog", { name: "Poista menotavoite?" }).getByRole("button", { name: "Poista tavoite" }).click();
  await expect(card.getByRole("status")).toContainText("Poistit tavoitteen");
  await page.goto("/#/overview");
  await expect(pace).toBeVisible();
  await expect(pace.locator(".pace-goal-line")).toHaveCount(0);

  expect(seen.problems).toEqual([]);
  await context.close();
});
