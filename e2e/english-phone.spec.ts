import { expect, test } from "@playwright/test";
import { linkFakeBank, makeMember, overflow, removeMember } from "./helpers.ts";

// English fits a phone: the English texts differ in length from the Finnish ones on every button and head, and the other
// width specs measure the pages in Finnish only. A member with a linked bank reads each page in English at 390 px, and no
// page scrolls sideways.
const PAGES = [
  "overview",
  "bills",
  "transactions",
  "transactions?view=merchants",
  // every question page of Raportit
  ...["kuukausi", "menot", "tulot", "velat", "saldot", "yhteiset"].map((q) => `reports?q=${q}`),
  "review",
  // the tabs of Asetukset a member sees
  ...["banks", "household", "security", "data"].map((tab) => `settings/${tab}`),
];

test("no page in English scrolls sideways at 390 px", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "puhelinen");
  const member = await browser.newContext({ storageState: state, viewport: { width: 390, height: 900 } });
  try {
    // a linked household, so the pages show their figures and not only their empty states (linking is done in Finnish)
    const first = await member.newPage();
    await linkFakeBank(first);
    await first.close();
    const setup = await member.request.put("/api/language", { headers: { "X-Requested-With": "fetch" }, data: { language: "en" } });
    expect(setup.ok()).toBe(true);
    const page = await member.newPage();
    const wide: string[] = [];
    for (const path of PAGES) {
      await page.goto(`/#/${path}`);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.locator("header.topbar")).toBeVisible();
      // the page has settled when the loading text is gone
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Loading…")).toHaveCount(0);
      await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
      const over = await overflow(page);
      if (over > 0) wide.push(`${path}: ${over} px`);
    }
    expect(wide, "pages in English wider than 390 px").toEqual([]);
  } finally {
    await member.close();
    await removeMember(browser, id);
  }
});
