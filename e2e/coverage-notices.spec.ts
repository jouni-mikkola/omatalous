import { expect, test } from "@playwright/test";
import { fakeBank, linkFakeBank, makeMember, overflow, removeMember, waitForSync, watch } from "./helpers.ts";

// Coverage notices: a household with a short history, the bills of a card that is not connected and one row in dollars
// (fake-bank/coverage-household.mjs). Every page of Raportit that uses a figure those leave out says so, with the amount
// core counted; a page whose period holds none of it says nothing.
const squeezed = (text: string) => text.replace(/[\s\u00a0\u202f]/g, "");

test("each page that uses the figure tells what it leaves out, with the sum", async ({ browser }) => {
  const member = await makeMember(browser, "coveragenotes");
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const seen = watch(page);
    await linkFakeBank(page, { coverage: true });
    await waitForSync(context);
    const expected = (await (await fetch(`${fakeBank().url}/fake/coverage-expected`)).json()) as { bills: { cents: number }[]; dollars: { cents: number }; firstDay: string };
    const billEuros = expected.bills.reduce((s, b) => s + b.cents, 0) / 100;
    const notices = page.locator(".coverage-notices");

    // spending and fixed costs: all three notices
    for (const q of ["menot", "kiinteat"]) {
      await page.goto(`/#/reports?q=${q}&period=12m`);
      await expect(notices).toBeVisible();
      await expect(notices.locator("[data-notice=cards]")).toContainText("Korttiostoja ei näy");
      expect(squeezed((await notices.locator("[data-notice=cards]").textContent()) ?? "")).toContain(`korttilaskuja${billEuros}€`);
      await expect(notices.locator("[data-notice=currency]")).toContainText("1 rivi, −20,00 USD");
      await expect(notices.locator("[data-notice=history]")).toContainText("Pankin historia alkaa vasta");
    }

    // income: no card purchases in it, the other two stay
    await page.goto("/#/reports?q=tulot&period=12m");
    await expect(notices.locator("[data-notice=currency]")).toBeVisible();
    await expect(notices.locator("[data-notice=history]")).toBeVisible();
    await expect(notices.locator("[data-notice=cards]")).toHaveCount(0);

    // this month holds none of the three rows: it says nothing
    await page.goto("/#/reports?q=kuukausi&period=12m");
    await expect(page.getByRole("heading", { name: "Kuukausi", level: 2 })).toBeVisible();
    await expect(notices).toHaveCount(0);

    // a phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/reports?q=menot&period=12m");
    await expect(notices.locator("[data-notice=cards]")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await removeMember(browser, member.id);
  }
});
