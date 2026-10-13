// A --steps module for `pnpm shots`: opens the first row of the month list of Kuukausitaulukko, which a narrow screen draws instead of the wide table (nothing happens where the table is drawn).
// Try it: pnpm shots reports --demo --fake-bank --widths 700 --steps tools/shots-examples/steps-open-month-list.mjs --name month-list
export default async (page) => {
  const first = page.locator(".pivot-list summary").first();
  if (!(await first.isVisible())) return;
  await first.click();
  await page.locator(".pivot-list details[open]").first().waitFor();
};
