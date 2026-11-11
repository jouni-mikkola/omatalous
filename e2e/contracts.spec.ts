import { expect, test } from "@playwright/test";
import { linkFakeBank, makeMember, removeMember, waitForSync, watch } from "./helpers.ts";

// A car lease in the fake bank's history: a first rent of 3 000 €, nine rents of 399 €, and a refund of 1 500 € from the
// lessor about three weeks after the last rent. Tulossa tells it as an ended contract; the member is made here, so the
// demo household of the other specs stays as it was.
const USERNAME = "e2e-sopimus";

let member: { state: string; id: string };
test.beforeAll(async ({ browser }) => {
  member = await makeMember(browser, USERNAME);
});
test.afterAll(async ({ browser }) => removeMember(browser, member.id));

test("Tulossa lists a lease that ended as a Päättynyt row of the one table, and opens with no contract panel", async ({ browser }) => {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await linkFakeBank(page);
  await waitForSync(context);

  await page.goto("/#/bills");
  const table = page.locator("#laskut-taulukko");
  // what has ended waits in a folded group
  await table.getByText("Päättyneet", { exact: false }).first().click();
  const row = table.locator("tbody tr").filter({ has: page.locator("button.rt-drill") }).filter({ hasText: "ESIMERKKI LEASING OY" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Päättynyt");

  // the row opens with no contract panel (docs/design/README.md 1.3)
  await row.getByRole("button", { name: /^Tiedot: / }).click();
  await expect(table.locator(".sub-drill")).toBeVisible();
  await expect(table.locator(".sub-drill .st-rows")).toHaveCount(0);

  expect(seen.problems).toEqual([]);
  await context.close();
});
