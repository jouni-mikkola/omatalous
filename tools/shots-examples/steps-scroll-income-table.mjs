// A --steps module for `pnpm shots`: turns the chart of Tulot ja menot into its table, says how many columns stand whole in sight, then moves the table to its end.
// Try it: pnpm shots reports --demo --fake-bank --widths 390 --steps tools/shots-examples/steps-scroll-income-table.mjs --name income-table-end
export default async (page) => {
  const card = page.locator("#kassavirta");
  await card.getByRole("button", { name: "Taulukko" }).first().click();
  const wrap = card.locator(".table-wrap").first();
  await wrap.locator("table.ruled").waitFor();
  const count = () =>
    wrap.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const heads = [...el.querySelectorAll("thead th")];
      const whole = heads.filter((th) => {
        const r = th.getBoundingClientRect();
        return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
      });
      return `${whole.length} of ${heads.length} columns whole in sight (${whole.map((th) => th.textContent).join(", ")}), table ${Math.round(el.scrollWidth)} px in ${Math.round(el.clientWidth)} px`;
    });
  console.log(`start: ${await count()}`);
  await wrap.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await page.waitForTimeout(200);
  console.log(`end: ${await count()}`);
  await wrap.scrollIntoViewIfNeeded();
};
