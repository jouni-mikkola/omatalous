import { expect, test } from "@playwright/test";
import { linkFakeBank, makeMember, removeMember, waitForSync, watch } from "./helpers.ts";

// A household with no account: the empty page names the two ways on, a bank is linked from the fake bank, the first fetch
// runs and the same page gives way to data. Made for a member of its own, so the administrator's demo data stays.
test("the empty page names both ways on to a member, then the data replaces it", async ({ browser }) => {
  test.setTimeout(150_000);
  const { state, id } = await makeMember(browser, "e2e-eka-kaytto");
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/transactions");
    await expect(page.locator(".empty-start")).toContainText("pyytää toista jäsentä jakamaan");

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
