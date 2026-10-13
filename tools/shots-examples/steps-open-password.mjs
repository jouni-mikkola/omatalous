// A --steps module for `pnpm shots`: opens the card Salasana in Asetukset: the three fields, nothing typed or sent.
// Try it: pnpm shots settings --demo --fake-bank --steps tools/shots-examples/steps-open-password.mjs --name password --only Salasana
export default async (page) => {
  await page.locator("#salasana").getByRole("button", { name: "Vaihda salasana" }).click();
  await page.locator("#salasana form").waitFor();
};
