import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// Nyt is the answer alone, with no list of findings, and Raportit has no list of findings of its own. The server has the administrator and the demo household already (e2e/run.mjs makes them).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Nyt has no Huomioitavaa, and Raportit has no Havainnot", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  // the demo's own alerts and its row for an unconnected account (which come with the date) would take the four rows Ilmoitukset has
  await page.route("**/api/dashboard**", async (route) => {
    const answer = await route.fetch();
    const json = await answer.json();
    await route.fulfill({ response: answer, json: { ...json, connectNotice: null, alerts: [] } });
  });
  {
    // Nyt shows no findings (they are asked on Tarkistettavat); Raportit has no Havainnot section of its own
    await page.goto("/#/overview");
    await expect(page.locator(".home-answer-line")).toBeVisible();
    await expect(page.getByRole("region", { name: "Huomioitavaa", exact: true })).toHaveCount(0);
    await page.goto("/#/reports?q=tulot");
    await expect(page.getByRole("heading", { name: "Tulot ja menot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Havainnot" })).toHaveCount(0);
    expect(seen.problems).toEqual([]);
  }
  await context.close();
});
