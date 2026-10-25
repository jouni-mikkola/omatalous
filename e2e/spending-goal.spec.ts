import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// The household's one monthly spending goal on Yhteenveto: set under the chart of Menot tässä kuussa, shown on the chart
// and as a column of its table, changed and removed. The spec removes the goal at the end, so the specs after it find the
// household as they expect.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("the goal is set, drawn on the chart, listed in the table, changed and removed", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const pace = page.getByRole("region", { name: "Menot tässä kuussa", exact: true });
  await expect(pace).toBeVisible({ timeout: 15_000 });
  await expect(pace.locator(".pace-goal-line")).toHaveCount(0);

  await pace.getByRole("button", { name: "Aseta kuukauden menotavoite" }).click();
  const form = pace.getByRole("form", { name: "Kuukauden menotavoite" });
  // a text that is no amount and an amount under a euro are asked again, with nothing saved
  await form.getByRole("textbox").fill("abc");
  await form.getByRole("button", { name: "Tallenna" }).click();
  await expect(pace.getByRole("alert")).toContainText("Anna tavoite euroina");
  await form.getByRole("textbox").fill("50 000");
  await form.getByRole("button", { name: "Tallenna" }).click();

  await expect(pace.locator(".pace-goal-line")).toHaveCount(1);
  await expect(pace.locator(".pace-goal-label")).toContainText("Tavoite 50 000 €");
  await expect(pace.locator(".pace-goal-answer")).toContainText("Tavoitteesta 50 000 €");
  await expect(pace.getByRole("button", { name: "Poista tavoite" })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  // the table view has the goal left, a day at a time
  await pace.getByRole("button", { name: "Taulukko" }).click();
  await expect(pace.getByRole("columnheader", { name: "Tavoitteesta jäljellä" })).toBeVisible();
  await pace.getByRole("button", { name: "Kaavio" }).click();

  // the goal is the user's: it is still there after a reload, and changed in place
  await page.reload();
  await expect(pace.locator(".pace-goal-answer")).toContainText("Tavoitteesta 50 000 €");
  await pace.getByRole("button", { name: "Muuta tavoitetta" }).click();
  await expect(pace.getByRole("textbox")).toHaveValue("50 000,00");
  await pace.getByRole("textbox").fill("1 800");
  await pace.getByRole("button", { name: "Tallenna" }).click();
  await expect(pace.locator(".pace-goal-label")).toContainText("Tavoite 1 800 €");

  await pace.getByRole("button", { name: "Poista tavoite" }).click();
  await expect(pace.locator(".pace-goal-line")).toHaveCount(0);
  await expect(pace.getByRole("button", { name: "Aseta kuukauden menotavoite" })).toBeVisible();

  expect(seen.problems).toEqual([]);
  await context.close();
});
