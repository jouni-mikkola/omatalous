// A --steps module for `pnpm shots`: turns the chart of Tulot ja menot on Raportit into its table.
// Try it: pnpm shots reports --demo --fake-bank --steps tools/shots-examples/steps-open-income-table.mjs --name income-table
export default async (page) => {
  // the first toggle of the section is the one of Tulot ja menot; the bridge below has its own
  const card = page.locator("#kassavirta");
  await card.getByRole("button", { name: "Taulukko" }).first().click();
  await card.locator("table.ruled").waitFor();
};
