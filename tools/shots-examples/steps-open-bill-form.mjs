// A --steps module for `pnpm shots`: opens the form of Lisää lasku on Laskut (nothing is sent).
// Try it: pnpm shots bills --demo --fake-bank --steps tools/shots-examples/steps-open-bill-form.mjs --name bill-form --only "form[aria-label='Lisää lasku']"
export default async (page) => {
  await page.getByRole("button", { name: "Lisää lasku", exact: true }).click();
  await page.getByRole("form", { name: "Lisää lasku" }).waitFor();
};
