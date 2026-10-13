// A --steps module for `pnpm shots`: switches Menot kuukausittain to Taulukko and opens the first row of the month list, which a narrow screen draws instead of the wide table (nothing more happens where the table is drawn).
// Try it: pnpm shots reports --demo --fake-bank --widths 700 --steps tools/shots-examples/steps-open-month-list.mjs --name month-list
export default async (page) => {
  await page.locator("#kuukaudet").getByRole("button", { name: "Taulukko" }).click();
  const first = page.locator(".pivot-list summary").first();
  if (!(await first.isVisible())) return;
  await first.click();
  await page.locator(".pivot-list details[open]").first().waitFor();
};
