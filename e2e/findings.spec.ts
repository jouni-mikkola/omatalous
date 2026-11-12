import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// Huomioitavaa on the first page is the head of the Tarkistettavat queue that needs the household and asks nothing itself, and Raportit has no list of findings of its own. The server has the administrator and the demo household already (e2e/run.mjs makes them).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Huomioitavaa opens Tarkistettavat, and Raportit has no Havainnot", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  // the demo's own alerts (which come with the date) would take the four rows Ilmoitukset has
  await page.route("**/api/dashboard**", async (route) => {
    const answer = await route.fetch();
    const json = await answer.json();
    await route.fulfill({ response: answer, json: { ...json, alerts: [] } });
  });
  {
    // the rows are links to their items in Tarkistettavat, at most three, with the count of all; no answer is given here
    await page.goto("/#/overview");
    await expect(page.locator(".home-answer-line")).toBeVisible();
    const notable = page.getByRole("region", { name: "Huomioitavaa", exact: true });
    await expect(notable).toBeVisible();
    expect(await notable.locator(".home-note").count()).toBeLessThanOrEqual(3);
    await expect(notable.getByRole("button")).toHaveCount(0);
    // a row opens Tarkistettavat at its own item, not at the head of the queue
    const title = await notable.locator(".home-note-title").first().innerText();
    await notable.locator(".home-note").first().click();
    await expect(page).toHaveURL(/#\/review\?item=/);
    await expect(page.locator(".review-name")).toHaveText(title);
    await page.goto("/#/reports?q=tulot");
    await expect(page.locator(".q-title")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Havainnot" })).toHaveCount(0);
    expect(seen.problems).toEqual([]);
  }
  await context.close();
});
