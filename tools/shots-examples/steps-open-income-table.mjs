// A --steps module for `pnpm shots`: waits for the table under the chart of Tulot ja menot on Raportit.
// Try it: pnpm shots reports --demo --fake-bank --steps tools/shots-examples/steps-open-income-table.mjs --name income-table
export default async (page) => {
  const card = page.locator("#kassavirta");
  await card.locator("table.ruled").waitFor();
};
