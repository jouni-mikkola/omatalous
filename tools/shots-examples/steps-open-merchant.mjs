// A --steps module for `pnpm shots`: opens the first merchant of the merchants view: its link leads to the rows of that merchant.
// Try it: pnpm shots "categories?tab=merchants" --demo --fake-bank --steps tools/shots-examples/steps-open-merchant.mjs --name merchant
export default async (page) => {
  await page.locator("td.m-name a, .m-name a").first().click();
  await page.waitForLoadState("networkidle");
};
