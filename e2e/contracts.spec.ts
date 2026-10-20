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

test("Laskut lists a lease that ended in Päättyneet sopimukset, with its start, first payment, refund and total, and not among what is coming", async ({ browser }) => {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await linkFakeBank(page);
  await waitForSync(context);

  await page.goto("/#/bills");
  const block = page.locator(".card", { has: page.getByRole("heading", { name: "Päättyneet sopimukset", exact: true }) });
  await expect(block).toBeVisible();
  const row = block.locator(".st-row", { has: page.getByRole("link", { name: "ESIMERKKI LEASING OY" }) });
  await expect(row).toHaveCount(1);
  // the days it ran, and what was paid: the first rent and nine of 399 €
  await expect(row.getByRole("button", { name: /^\d+\.\d+\.\d{4}–\d+\.\d+\.\d{4}$/ })).toBeVisible();
  // the row says what it cost in the end: 6 591 € paid less the refund of 1 500 €
  expect(plain(await row.locator(".st-num").first().innerText())).toBe("Yhteensä 5 091,00 €");

  // the lines of the contract open under the row
  await row.getByRole("button", { name: /–/ }).click();
  const lines = row.locator(".contract-panel");
  const line = async (label: string) => plain(await lines.locator(".st-row", { has: page.getByText(label, { exact: true }) }).locator(".st-num").innerText());
  expect(await line("Ensimmäinen maksu")).toBe("3 000,00 €");
  expect(await line("Hinta kuussa")).toBe("399,00 €");
  expect(await line("Hyvitys sopimuksen päättyessä")).toBe("1 500,00 €");
  expect(await line("Yhteensä maksettu")).toBe("6 591,00 €");
  // the last line of the panel is the figure of the row
  expect(await line("Maksettu yhteensä hyvityksen jälkeen")).toBe("5 091,00 €");
  expect(plain(await lines.locator(".st-row").last().innerText())).toBe("Maksettu yhteensä hyvityksen jälkeen 5 091,00 €");
  for (const label of ["Alkoi", "Viimeinen maksu", "Päättyi"]) await expect(lines.getByText(label, { exact: true })).toBeVisible();

  // it is no part of what is paid now: not in Sopimukset ja laskut, not in the list of what is coming
  const contracts = page.locator(".card", { has: page.getByRole("heading", { name: "Sopimukset ja laskut", exact: true }) });
  await expect(contracts).not.toContainText("ESIMERKKI LEASING OY");
  await expect(page.locator("#tulossa")).not.toContainText("ESIMERKKI LEASING OY");
  // the contracts that run show their start under the name
  await expect(contracts.getByRole("button", { name: /^\d\d\/\d{4} alkaen$/ }).first()).toBeVisible();

  expect(seen.problems).toEqual([]);
  await context.close();
});
