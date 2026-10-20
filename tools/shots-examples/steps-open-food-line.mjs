// A --steps module for `pnpm shots`: opens the line Ruokakauppa in Ruoka on Raportit.
// Try it: pnpm shots reports --demo --fake-bank --steps tools/shots-examples/steps-open-food-line.mjs --name food-open --only "#ruoka"
export default async (page) => {
  const card = page.locator("#ruoka");
  await card.getByRole("button", { name: "Ruokakauppa" }).click();
  await card.locator(".food-open").waitFor();
};
