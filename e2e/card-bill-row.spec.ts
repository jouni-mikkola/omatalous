import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("a card bill row of Tapahtumat says its purchases are not shown, and a plain payment does not", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const row = (id: string, merchant: string, category: string, amountCents: number) => ({
    id, accountId: "acc-1", bookingDate: "2026-10-05", valueDate: null, amountCents, currency: "EUR", status: "booked", merchant, counterparty: null,
    description: null, reference: null, category, categorySource: "rule", isTransfer: false, source: "csv", own: true,
  });
  const items = [row("t1", "Esimerkki Korttilasku", "card_bill", -120000), row("t2", "Esimerkki Kauppa", "groceries", -2500)];
  await page.route("**/api/transactions?*", (route) => route.fulfill({ json: { total: 2, inCents: 0, outCents: 122500, items } }));
  await page.goto("/#/transactions");
  const label = page.getByText("Korttilasku: ostot eivät näy", { exact: true });
  await expect(label).toHaveCount(1);
  await expect(page.locator("tr", { hasText: "Esimerkki Korttilasku" }).getByText("Korttilasku: ostot eivät näy")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.locator(".tx-item", { hasText: "Esimerkki Korttilasku" }).getByText("Korttilasku: ostot eivät näy")).toHaveCount(1);
  expect(await overflow(page)).toBe(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});
