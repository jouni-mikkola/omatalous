import { expect, test } from "@playwright/test";
import { makeMember, overflow, removeMember, watch } from "./helpers.ts";

// The page of a household with no account: a heading and two buttons under it in one row, and no paragraph. Both buttons
// are made here for a member of their own, who has not linked a bank and has not loaded the example data.
test("the empty start is a heading and two buttons in one row, with no paragraph, and fits a phone", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "e2e-tyhja");
  const context = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/transactions");
    const start = page.locator(".empty-start");
    const heading = start.getByRole("heading", { name: "Ei vielä tietoja" });
    await expect(heading).toBeVisible();
    await expect(start.getByRole("button")).toHaveText(["Yhdistä pankki", "Lataa esimerkkitiedot"]);
    await expect(start.locator("p")).toHaveCount(0);
    const [head, connect, demo] = [await heading.boundingBox(), await start.getByRole("button").nth(0).boundingBox(), await start.getByRole("button").nth(1).boundingBox()];
    expect(Math.abs(connect!.y - demo!.y), "the two buttons stand in one row").toBeLessThan(2);
    expect(connect!.y, "the buttons stand under the heading").toBeGreaterThan(head!.y + head!.height);
    expect(await overflow(page), "the empty start scrolls sideways at 390px").toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});
