// A --steps module for `pnpm shots`: opens the fold Päättyneet maksut on Laskut.
// Try it: pnpm shots bills --demo --fake-bank --steps tools/shots-examples/steps-open-ended-payments.mjs --name ended-payments --only "details:has(h2:text('Päättyneet maksut'))"
export default async (page) => {
  await page.getByText("Päättyneet maksut", { exact: true }).click();
  await page.locator("details[open]").filter({ hasText: "Päättyneet maksut" }).waitFor();
};
