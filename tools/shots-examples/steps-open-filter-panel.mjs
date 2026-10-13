// A --steps module for `pnpm shots`: opens the panel behind Rajaa, the button that holds the filters on a phone (nothing happens where the filters are open already).
// Try it: pnpm shots transactions --demo --fake-bank --widths 390 --steps tools/shots-examples/steps-open-filter-panel.mjs --name filter-panel
export default async (page) => {
  const toggle = page.getByRole("button", { name: /^Rajaa/ });
  if (!(await toggle.isVisible())) return;
  await toggle.click();
  await page.getByRole("button", { name: /^Rajaa/, expanded: true }).waitFor();
};
