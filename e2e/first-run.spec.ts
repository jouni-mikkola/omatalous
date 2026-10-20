import { expect, test } from "@playwright/test";
import { linkFakeBank, makeMember, removeMember, waitForSync, watch } from "./helpers.ts";

// A household with no account: the empty page lists what is left, a bank is linked from the fake bank, the first fetch
// runs and the same page gives way to data. Made for a member of its own, so the administrator's demo data stays.
test("the empty page ticks app key, bank and first fetch as they happen, then the data replaces it", async ({ browser }) => {
  test.setTimeout(150_000);
  const { state, id } = await makeMember(browser, "e2e-eka-kaytto");
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/transactions");
    const steps = page.locator(".empty-start .empty-steps li");
    await expect(steps).toContainText(["Enable Banking -sovellus ja avain", "Pankki yhdistetty", "Ensimmäinen haku tehty"]);

    await page.close();
    const linking = await context.newPage();
    await linkFakeBank(linking);
    await waitForSync(context);
    await linking.goto("/#/transactions");
    await linking.reload();
    await expect(linking.locator(".empty-start")).toHaveCount(0);
    await expect(linking.locator("table tbody tr").first()).toBeVisible();
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});
