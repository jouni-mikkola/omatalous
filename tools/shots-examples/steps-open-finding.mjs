// A --steps module for `pnpm shots`: opens Avaa laskelma of the first finding on Säästövinkit.
// Try it: pnpm shots optimise --demo --fake-bank --steps tools/shots-examples/steps-open-finding.mjs --name finding --only "[aria-expanded=true]"
export default async (page) => {
  await page.getByRole("button", { name: "Avaa laskelma" }).first().click();
  await page.getByRole("button", { name: "Sulje laskelma" }).first().waitFor();
};
