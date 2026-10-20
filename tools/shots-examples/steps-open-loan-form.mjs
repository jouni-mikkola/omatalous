// A --steps module for `pnpm shots`: opens the form of a new loan in Asetukset (Lisää käsin); nothing is saved.
// Try it: pnpm shots settings --demo --fake-bank --steps tools/shots-examples/steps-open-loan-form.mjs --name loan-form
export default async (page) => {
  await page.getByRole("button", { name: "Lisää käsin" }).click();
  await page.getByText("Uusi laina").first().waitFor();
};
