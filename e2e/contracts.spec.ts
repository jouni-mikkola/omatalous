import { expect, test } from "@playwright/test";
import { linkFakeBank, makeMember, plain, removeMember, waitForSync, watch } from "./helpers.ts";

// A car lease in the fake bank's history: a first rent of 3 000 €, nine rents of 399 €, and a refund of 1 500 € from the
// lessor about three weeks after the last rent. Laskut tells it as an ended contract; the member is made here, so the
// demo household of the other specs stays as it was.
const USERNAME = "e2e-sopimus";

let member: { state: string; id: string };
test.beforeAll(async ({ browser }) => {
  member = await makeMember(browser, USERNAME);
});
test.afterAll(async ({ browser }) => removeMember(browser, member.id));

test("Laskut lists a lease that ended as a Päättynyt row of the one table, with its start, first payment, refund and total, and not among what is coming", async ({ browser }) => {
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

  // the lines of the contract open under the row
  await row.getByRole("button", { name: /^Tiedot: / }).click();
  const lines = table.locator(".sub-drill .st-rows");
  const line = async (label: string) => plain(await lines.locator(".st-row", { has: page.getByText(label, { exact: true }) }).locator(".st-num").innerText());
  expect(await line("Ensimmäinen maksu")).toBe("3 000,00 €");
  expect(await line("Hinta kuussa")).toBe("399,00 €");
  expect(await line("Hyvitys sopimuksen päättyessä")).toBe("1 500,00 €");
  expect(await line("Yhteensä maksettu")).toBe("6 591,00 €");
  // the last line of the panel is the figure of the row
  expect(await line("Maksettu yhteensä hyvityksen jälkeen")).toBe("5 091,00 €");
  expect(plain(await lines.locator(".st-row").last().innerText())).toBe("Maksettu yhteensä hyvityksen jälkeen 5 091,00 €");
  for (const label of ["Alkoi", "Viimeinen maksu", "Päättyi"]) await expect(lines.getByText(label, { exact: true })).toBeVisible();

  // it is no part of what is coming now
  await expect(page.locator("#tulossa")).not.toContainText("ESIMERKKI LEASING OY");

  expect(seen.problems).toEqual([]);
  await context.close();
});
