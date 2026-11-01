import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, unfold, watch } from "./helpers.ts";

// The goal per category: set by hand on Rahankäyttö, shown on the pace of the first page and removed. The spec
// removes the goal at the end, so the specs after it find the household as they expect.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("a goal is set by hand, read on the first page and removed", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=menot");
  const panel = page.locator("#kategoriatavoitteet");
  await unfold(page, "kategoriatavoitteet");
  await expect(panel).toContainText("Tavoite puuttuu");

  // set by hand: a slip is asked again, a goal is saved
  await panel.getByRole("button", { name: "Aseta oma" }).first().click();
  const form = panel.getByRole("form");
  await form.getByRole("textbox").fill("abc");
  await form.getByRole("button", { name: "Tallenna" }).click();
  await expect(panel.getByRole("alert")).toContainText("Anna tavoite euroina");
  await form.getByRole("textbox").fill("600");
  await form.getByRole("button", { name: "Tallenna" }).click();
  await expect(panel.getByRole("button", { name: /^Muuta tavoitetta/ })).toHaveCount(1);
  await expect(panel).toContainText("600");
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  // the first page reads it
  await page.goto("/#/overview");
  await expect(page.locator(".pace-category-goals li")).toHaveCount(1);

  await page.goto("/#/reports?q=menot");
  await unfold(page, "kategoriatavoitteet");
  await panel.getByRole("button", { name: /^Poista tavoite/ }).click();
  await expect(panel.getByRole("button", { name: /^Poista tavoite/ })).toHaveCount(0);
  await page.goto("/#/overview");
  await expect(page.locator(".pace-category-goals li")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});
